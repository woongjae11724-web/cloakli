#!/usr/bin/env node
// 출시(production) 빌드 출력 폴더를 검증한다. manifest 유효성, Developer Pro/디버그가
// 강제로 꺼져 있는지, 외부 통신·금지 파일이 없는지를 자동으로 확인하고, 문제가 있으면
// { ok: false, errors: [...] }를 돌려준다(CLI로 실행하면 오류 코드로 종료한다).
"use strict";

const fs = require("fs");
const path = require("path");
const { listFilesRecursive } = require("./fs-utils");

const ROOT_DIR = path.join(__dirname, "..");
const DEFAULT_DIST_DIR = path.join(ROOT_DIR, "dist", "production");

const EXPECTED_PERMISSIONS = ["activeTab", "alarms", "scripting", "storage"];

// 실제 코드로 Developer Pro를 켜거나, 개발/테스트 전용 코드가 남아 있음을 나타내는 패턴.
// 사용자에게 보여주는 일반 문구("Developer Pro" 라벨 자체)는 popup UI에 정상적으로
// 존재하므로 여기서 금지하지 않는다 — 오직 "실제로 켜는 코드/설정값"만 검사한다.
const DEVELOPER_PRO_LEAK_PATTERNS = [
  { pattern: /developerPro\s*:\s*true/, label: "developerPro: true" },
  { pattern: /developerPro\s*=\s*true/, label: "developerPro = true" },
  { pattern: /CLOAKLI_DEVELOPER_MODE\s*=\s*true/, label: "CLOAKLI_DEVELOPER_MODE = true" },
  { pattern: /CLOAKLI_BUILD_MODE\s*=\s*["']development["']/, label: 'CLOAKLI_BUILD_MODE = "development"' },
  { pattern: /entitlementOverride/, label: "entitlementOverride(테스트 전용 훅)" },
];

const DEBUG_HARD_FAIL_PATTERNS = [
  { pattern: /\bdebugger\b\s*;?/, label: "debugger 문" },
  { pattern: /CLOAKLI_DEBUG\s*=\s*true\s*;/, label: "CLOAKLI_DEBUG = true (하드코딩)" },
  { pattern: /\binstallFakeChrome\b/, label: "테스트 전용 함수(installFakeChrome)" },
  { pattern: /\bFakeElement\b|\bFakeDocument\b|\bFakeMutationObserver\b/, label: "테스트 전용 fake DOM 참조" },
  { pattern: /\bwaitUntil\s*\(/, label: "테스트 전용 waitUntil 참조" },
];

// 개발 빌드 전용 사용자 노출 표시(제품명/배지/배너)가 출시 빌드에 남아 있으면 실패시킨다.
// entitlement.js 안의 "Developer Pro" 같은 내부 문자열 상수는 여기서 검사하지 않는다
// (실제로 켜질 수 없는 죽은 코드이며, DEVELOPER_PRO_LEAK_PATTERNS가 "실제로 켜는 값"만
// 별도로 검사한다) — 여기서는 scripts/build.js가 빌드 시점에 반드시 제거해야 하는,
// 사용자에게 직접 보이는 개발 전용 문구/마크업만 검사한다.
const DEV_BUILD_LEAK_PATTERNS = [
  { pattern: /Cloakli DEV/, label: '"Cloakli DEV" (개발 빌드 전용 확장 이름)' },
  { pattern: /\[개발 빌드\]/, label: '"[개발 빌드]" 문구' },
  { pattern: /id="cloakli-dev-badge"/, label: "DEV BUILD 배지 마크업" },
  { pattern: /id="cloakli-dev-banner"/, label: "개발 빌드 안내 배너 마크업" },
  { pattern: /CLOAKLI_DEV_ONLY_START/, label: "개발 전용 블록 마커(제거되지 않음)" },
];

// console.log는 무조건 실패시키지 않고 경고만 남긴다(예: background.js의 설치 로그처럼
// 개인정보가 없는 정상적인 로그가 있을 수 있다). console.error/console.warn은 검사하지 않는다.
const DEBUG_WARN_PATTERNS = [{ pattern: /console\.log\s*\(/, label: "console.log(...)" }];

const NETWORK_PATTERNS = [
  { pattern: /new\s+XMLHttpRequest/, label: "XMLHttpRequest" },
  { pattern: /new\s+WebSocket/, label: "WebSocket" },
  { pattern: /\bgtag\s*\(/, label: "gtag(...) (Google Analytics)" },
  { pattern: /google-analytics\.com|googletagmanager\.com/, label: "Google Analytics 스크립트 URL" },
  { pattern: /\bsentry\b/i, label: "Sentry(외부 오류 수집)" },
  { pattern: /\bbugsnag\b/i, label: "Bugsnag(외부 오류 수집)" },
  { pattern: /\bmixpanel\b|\bamplitude\b|\bsegment\.io\b/i, label: "분석/추적 SDK" },
  { pattern: /api\.lemonsqueezy\.com/i, label: "Lemon Squeezy API 직접 호출(반드시 라이선스 서버를 거쳐야 함)" },
];

// fetch(...)는 license-client.js가 "우리 라이선스 서버"(build-config.js의 licenseServerUrl)를
// 호출하는 데에만 정당하게 사용한다. 그 외 파일에서는 여전히 금지한다.
const FETCH_PATTERN = { pattern: /\bfetch\s*\(/, label: "fetch(...)" };
const FILES_ALLOWED_TO_FETCH = ["license-client.js"];

const FORBIDDEN_PATH_PATTERNS = [
  { pattern: /^tests\//, label: "tests/ 폴더" },
  { pattern: /(^|\/)node_modules\//, label: "node_modules/" },
  { pattern: /^package(-lock)?\.json$/, label: "package.json/package-lock.json" },
  { pattern: /(^|\/)\.git($|\/)/, label: ".git" },
  { pattern: /fixture/i, label: "fixture 파일" },
  { pattern: /(^|\/)coverage(\/|$)/, label: "coverage 결과" },
  { pattern: /\.map$/, label: "소스맵(.map)" },
  { pattern: /\.log$/, label: "로그 파일" },
  { pattern: /^README/i, label: "README(개발 문서)" },
  { pattern: /(^|\/)\.DS_Store$|(^|\/)Thumbs\.db$/, label: "숨김 시스템 파일" },
];

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function scanFilesForPatterns(distDir, relFiles, patterns) {
  const hits = [];
  relFiles.forEach((relPath) => {
    if (!/\.(js|html|json|css)$/i.test(relPath)) return;
    const text = readText(path.join(distDir, relPath));
    patterns.forEach(({ pattern, label }) => {
      const match = text.match(pattern);
      if (match) {
        const line = text.slice(0, match.index).split("\n").length;
        hits.push({ file: relPath, line, label });
      }
    });
  });
  return hits;
}

function validateManifest(distDir, errors) {
  const manifestPath = path.join(distDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    errors.push("manifest.json이 없습니다.");
    return null;
  }

  let manifest;
  try {
    manifest = JSON.parse(readText(manifestPath));
  } catch (err) {
    errors.push("manifest.json이 유효한 JSON이 아닙니다: " + err.message);
    return null;
  }

  if (manifest.manifest_version !== 3) errors.push("manifest_version이 3이 아닙니다.");
  if (!manifest.name) errors.push("manifest.json에 name이 없습니다.");
  if (!manifest.version) errors.push("manifest.json에 version이 없습니다.");
  else if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
    errors.push('manifest.json의 version 형식이 올바르지 않습니다: "' + manifest.version + '" (예: 1.0.0)');
  }
  if (!manifest.description) errors.push("manifest.json에 description이 없습니다.");

  // validate-release.js는 출시(production) 빌드 검증 전용이므로, 개발 빌드 전용 표시가
  // 이름/설명에 남아 있으면 항상 실패시킨다.
  if (manifest.name === "Cloakli DEV" || /\bDEV\b/.test(manifest.name || "")) {
    errors.push('manifest.json의 name이 개발 빌드 표시("' + manifest.name + '")로 되어 있습니다. 출시 빌드는 "Cloakli"여야 합니다.');
  }
  if (/\[개발 빌드\]/.test(manifest.description || "")) {
    errors.push("manifest.json의 description에 개발 빌드 표시(\"[개발 빌드]\")가 남아 있습니다.");
  }

  if (!manifest.action || !manifest.action.default_popup) {
    errors.push("manifest.json에 action.default_popup이 없습니다.");
  } else if (!fs.existsSync(path.join(distDir, manifest.action.default_popup))) {
    errors.push("action.default_popup이 가리키는 파일이 없습니다: " + manifest.action.default_popup);
  }

  if (manifest.background) {
    if (!manifest.background.service_worker) {
      errors.push("manifest.json의 background에 service_worker가 없습니다.");
    } else if (!fs.existsSync(path.join(distDir, manifest.background.service_worker))) {
      errors.push("background.service_worker가 가리키는 파일이 없습니다: " + manifest.background.service_worker);
    }
  }

  if (!manifest.options_ui || !manifest.options_ui.page) {
    errors.push("manifest.json에 options_ui.page(또는 options_page)가 없습니다.");
  } else if (!fs.existsSync(path.join(distDir, manifest.options_ui.page))) {
    errors.push("options_ui.page가 가리키는 파일이 없습니다: " + manifest.options_ui.page);
  }

  (manifest.content_scripts || []).forEach((entry, idx) => {
    (entry.js || []).forEach((f) => {
      if (!fs.existsSync(path.join(distDir, f))) errors.push("content_scripts[" + idx + "].js 파일이 없습니다: " + f);
    });
    (entry.css || []).forEach((f) => {
      if (!fs.existsSync(path.join(distDir, f))) errors.push("content_scripts[" + idx + "].css 파일이 없습니다: " + f);
    });
  });

  if (manifest.icons) {
    Object.values(manifest.icons).forEach((iconPath) => {
      if (!fs.existsSync(path.join(distDir, iconPath))) errors.push("icons가 가리키는 파일이 없습니다: " + iconPath);
    });
  }

  const perms = (manifest.permissions || []).slice().sort();
  const expected = EXPECTED_PERMISSIONS.slice().sort();
  if (JSON.stringify(perms) !== JSON.stringify(expected)) {
    errors.push("permissions가 예상과 다릅니다. 예상: " + expected.join(", ") + " / 실제: " + perms.join(", "));
  }
  if (manifest.host_permissions) {
    errors.push("host_permissions가 선언되어 있습니다 (필요하지 않아야 합니다).");
  }
  const manifestJson = JSON.stringify(manifest);
  if (manifestJson.includes("<all_urls>")) {
    errors.push("manifest.json에 <all_urls>가 포함되어 있습니다.");
  }

  if (manifest.commands) {
    const backgroundSrc = manifest.background && manifest.background.service_worker
      ? readText(path.join(distDir, manifest.background.service_worker))
      : "";
    Object.keys(manifest.commands).forEach((name) => {
      const cmd = manifest.commands[name];
      if (!cmd.description) errors.push("commands." + name + "에 description이 없습니다.");
      if (!cmd.suggested_key || !cmd.suggested_key.default) {
        errors.push("commands." + name + "에 suggested_key.default가 없습니다.");
      }
      if (backgroundSrc && !backgroundSrc.includes('"' + name + '"')) {
        errors.push("background.js가 commands." + name + "을 처리하지 않는 것으로 보입니다.");
      }
    });
  }

  return manifest;
}

function validateBuildConfig(distDir, errors) {
  const configPath = path.join(distDir, "build-config.js");
  if (!fs.existsSync(configPath)) {
    errors.push("build-config.js가 없습니다.");
    return;
  }
  let config;
  try {
    // 요구 사항: node의 require 캐시와 충돌하지 않도록 매번 새로 읽어 평가한다.
    delete require.cache[require.resolve(configPath)];
    config = require(configPath);
  } catch (err) {
    errors.push("build-config.js를 불러오지 못했습니다: " + err.message);
    return;
  }
  if (config.developerPro !== false) {
    errors.push("!!! build-config.js의 developerPro가 false가 아닙니다: " + JSON.stringify(config.developerPro));
  }
  if (config.debug !== false) {
    errors.push("build-config.js의 debug가 false가 아닙니다: " + JSON.stringify(config.debug));
  }
  if (config.mode !== "production") {
    errors.push('build-config.js의 mode가 "production"이 아닙니다: ' + JSON.stringify(config.mode));
  }

  validateLicenseServerUrl(config, errors);
}

// 실제 배포된 Cloudflare Worker 주소가 아니면(비어 있음/https 아님/localhost) 출시 ZIP을
// 만들지 못하게 막는다. 라이선스 서버 URL은 비밀이 아니지만(공개 API 주소일 뿐), 로컬
// 개발용 placeholder(http://127.0.0.1:...)가 그대로 출시되면 모든 사용자의 라이선스
// 활성화/검증이 조용히 실패하므로 이 실수를 빌드 단계에서 막는다.
function validateLicenseServerUrl(config, errors) {
  const url = config && config.licenseServerUrl;
  if (!url || typeof url !== "string" || !url.trim()) {
    errors.push(
      "build-config.js의 licenseServerUrl이 비어 있습니다. 실제 배포한 Cloudflare Worker 주소를 설정해야 출시 ZIP을 만들 수 있습니다 (server/SETUP.md 참고)."
    );
    return;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    errors.push("build-config.js의 licenseServerUrl이 올바른 URL이 아닙니다: " + JSON.stringify(url));
    return;
  }
  if (parsed.protocol !== "https:") {
    errors.push("build-config.js의 licenseServerUrl은 https여야 합니다(현재: " + parsed.protocol + "): " + url);
  }
  if (/^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[?::1\]?)$/i.test(parsed.hostname)) {
    errors.push("build-config.js의 licenseServerUrl이 localhost/127.0.0.1을 가리키고 있습니다(실제 배포 URL이 아닙니다): " + url);
  }
}

// content-core.js -> build-config.js -> entitlement.js -> (content.js | popup.js | options.js)
// 순서가 빌드 산출물의 manifest.json/popup.html/options.html에서도 유지되는지 확인한다.
// 이 순서가 어긋나면 entitlement.js가 build-config.js보다 먼저 실행되어 항상 free로
// 굳어지거나, content.js/popup.js가 CloakliEntitlement 없이 실행되어 조용히 멈출 수 있다.
function validateScriptOrder(distDir, errors) {
  const manifestPath = path.join(distDir, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    let manifest;
    try {
      manifest = JSON.parse(readText(manifestPath));
    } catch (err) {
      manifest = null;
    }
    const entry = manifest && manifest.content_scripts && manifest.content_scripts[0];
    if (entry && Array.isArray(entry.js)) {
      const coreIdx = entry.js.indexOf("content-core.js");
      const configIdx = entry.js.indexOf("build-config.js");
      const entitlementIdx = entry.js.indexOf("entitlement.js");
      const contentIdx = entry.js.indexOf("content.js");
      const validOrder =
        coreIdx !== -1 &&
        configIdx !== -1 &&
        entitlementIdx !== -1 &&
        contentIdx !== -1 &&
        coreIdx < configIdx &&
        configIdx < entitlementIdx &&
        entitlementIdx < contentIdx;
      if (!validOrder) {
        errors.push(
          "manifest.json의 content_scripts 순서가 올바르지 않습니다 (content-core.js -> build-config.js -> entitlement.js -> content.js 순서여야 합니다)."
        );
      }
    }
  }

  [
    { file: "popup.html", appScript: "popup.js" },
    { file: "options.html", appScript: "options.js" },
  ].forEach(({ file, appScript }) => {
    const filePath = path.join(distDir, file);
    if (!fs.existsSync(filePath)) return;
    const html = readText(filePath);
    const scriptSrcs = [...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)].map((m) => m[1]);
    const coreIdx = scriptSrcs.indexOf("content-core.js");
    const configIdx = scriptSrcs.indexOf("build-config.js");
    const entitlementIdx = scriptSrcs.indexOf("entitlement.js");
    const appIdx = scriptSrcs.indexOf(appScript);
    const validOrder =
      coreIdx !== -1 &&
      configIdx !== -1 &&
      entitlementIdx !== -1 &&
      appIdx !== -1 &&
      coreIdx < configIdx &&
      configIdx < entitlementIdx &&
      entitlementIdx < appIdx;
    if (!validOrder) {
      errors.push(
        file + "의 <script> 순서가 올바르지 않습니다 (content-core.js -> build-config.js -> entitlement.js -> " + appScript + " 순서여야 합니다)."
      );
    }
  });
}

// distDir: 검증할 출력 폴더(기본값 dist/production)
// 반환값: { ok, errors, warnings }
function validateRelease(distDir) {
  const target = distDir || DEFAULT_DIST_DIR;
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(target)) {
    return { ok: false, errors: ["출력 폴더가 없습니다: " + target + " (먼저 build:prod를 실행하세요)"], warnings };
  }

  validateManifest(target, errors);
  validateBuildConfig(target, errors);
  validateScriptOrder(target, errors);

  const allFiles = listFilesRecursive(target);

  FORBIDDEN_PATH_PATTERNS.forEach(({ pattern, label }) => {
    allFiles.forEach((relPath) => {
      if (pattern.test(relPath)) errors.push("금지된 파일이 포함되어 있습니다(" + label + "): " + relPath);
    });
  });

  scanFilesForPatterns(target, allFiles, DEVELOPER_PRO_LEAK_PATTERNS).forEach((hit) => {
    errors.push("Developer Pro 활성화 가능성이 발견되었습니다: " + hit.file + ":" + hit.line + " (" + hit.label + ")");
  });

  scanFilesForPatterns(target, allFiles, DEV_BUILD_LEAK_PATTERNS).forEach((hit) => {
    errors.push("개발 빌드 전용 표시가 남아 있습니다: " + hit.file + ":" + hit.line + " (" + hit.label + ")");
  });

  scanFilesForPatterns(target, allFiles, DEBUG_HARD_FAIL_PATTERNS).forEach((hit) => {
    errors.push("디버그/테스트 전용 코드가 발견되었습니다: " + hit.file + ":" + hit.line + " (" + hit.label + ")");
  });

  scanFilesForPatterns(target, allFiles, DEBUG_WARN_PATTERNS).forEach((hit) => {
    warnings.push(hit.file + ":" + hit.line + " (" + hit.label + ") — 경고만: 개인정보가 없는 로그인지 직접 확인하세요.");
  });

  scanFilesForPatterns(target, allFiles, NETWORK_PATTERNS).forEach((hit) => {
    errors.push("외부 통신 코드가 발견되었습니다: " + hit.file + ":" + hit.line + " (" + hit.label + ")");
  });

  const filesThatMustNotFetch = allFiles.filter((relPath) => FILES_ALLOWED_TO_FETCH.indexOf(relPath) === -1);
  scanFilesForPatterns(target, filesThatMustNotFetch, [FETCH_PATTERN]).forEach((hit) => {
    errors.push("외부 통신 코드가 발견되었습니다: " + hit.file + ":" + hit.line + " (" + hit.label + ")");
  });

  // <script>/<link>가 원격 URL을 불러오는지도 확인한다.
  allFiles
    .filter((f) => /\.html$/i.test(f))
    .forEach((relPath) => {
      const html = readText(path.join(target, relPath));
      const urls = [
        ...[...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)].map((m) => m[1]),
        ...[...html.matchAll(/<link[^>]*\shref=["']([^"']+)["']/g)].map((m) => m[1]),
      ];
      urls.forEach((url) => {
        if (/^https?:\/\//.test(url)) {
          errors.push("외부 URL을 참조합니다: " + relPath + " -> " + url);
        }
      });
    });

  return { ok: errors.length === 0, errors, warnings, distDir: target, fileCount: allFiles.length };
}

if (require.main === module) {
  const result = validateRelease(process.argv[2]);
  result.warnings.forEach((w) => console.warn("[validate] 경고:", w));
  if (!result.ok) {
    console.error("[validate] 실패 (" + result.errors.length + "건):");
    result.errors.forEach((e) => console.error("  - " + e));
    process.exit(1);
  }
  console.log("[validate] 통과: " + result.distDir + " (" + result.fileCount + "개 파일)");
}

module.exports = { validateRelease, EXPECTED_PERMISSIONS, DEFAULT_DIST_DIR };
