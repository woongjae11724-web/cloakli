#!/usr/bin/env node
// 개발(development) 빌드와 출시(production) 빌드를 만드는 Node 스크립트.
// 번들러 없이 필요한 파일만 dist/<mode>/ 아래로 복사하고, production 빌드에서만
// 출력 폴더 안의 build-config.js 사본을 developerPro:false/debug:false로 강제 교체한다.
// 원본 소스의 build-config.js는 이 과정에서 전혀 수정하지 않는다.
"use strict";

const fs = require("fs");
const path = require("path");
const { RELEASE_FILES, RELEASE_DIRS } = require("./file-manifest");
const { copyRecursive, removeRecursive, listFilesRecursive } = require("./fs-utils");

const ROOT_DIR = path.join(__dirname, "..");
const VALID_MODES = ["development", "production"];

// production 빌드 전용 build-config.js 내용을 만든다. 원본과 같은 UMD 형태를 유지해
// 브라우저(<script> 로드)와 Node(require) 양쪽에서 그대로 동작한다.
// developerPro/debug/mode는 항상 안전한 값으로 강제하지만, licenseServerUrl/checkoutUrl은
// 비밀이 아니므로(공개 API 주소/결제 페이지 주소일 뿐) 소스에 있던 값을 그대로 옮긴다 —
// 이 값이 실제 배포 URL인지는 scripts/validate-release.js가 별도로 검사한다.
function buildProductionConfigSource(sourceConfig) {
  const src = sourceConfig || {};
  return [
    "// scripts/build.js가 production 빌드 시 자동 생성한 파일입니다.",
    "// 원본 소스(build-config.js)는 건드리지 않으며, 이 사본만 developerPro/debug/mode를 강제로 안전한 값으로 바꿉니다.",
    "(function (root) {",
    '  "use strict";',
    "",
    "  const CLOAKLI_BUILD_CONFIG = {",
    '    mode: "production",',
    "    developerPro: false,",
    "    debug: false,",
    "    licenseServerUrl: " + JSON.stringify(src.licenseServerUrl || "") + ",",
    "    checkoutUrl: " + JSON.stringify(src.checkoutUrl || "") + ",",
    "  };",
    "",
    '  if (typeof module !== "undefined" && module.exports) {',
    "    module.exports = CLOAKLI_BUILD_CONFIG;",
    "  } else {",
    "    root.CloakliBuildConfig = CLOAKLI_BUILD_CONFIG;",
    "  }",
    '})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);',
    "",
  ].join("\n");
}

// manifest.json의 name/description을 빌드 모드에 맞게 바꾼 새 객체를 돌려준다(원본은
// 변경하지 않는 순수 함수). 개발 빌드와 출시 빌드를 Chrome 확장 목록에서 한눈에
// 구분할 수 있도록, 개발 빌드에만 "Cloakli DEV"/"[개발 빌드]" 표시를 붙인다.
//
// manifest가 다국어 키(__MSG_extensionName__)를 쓰는 경우 manifest 자체는 건드리지 않고
// (키를 리터럴로 바꾸면 다국어가 깨진다), 대신 buildMode()가 출력 폴더의 _locales
// 메시지 파일에 같은 라벨을 적용한다(applyLocaleBuildLabel).
function applyManifestBuildLabel(manifest, mode) {
  const result = Object.assign({}, manifest);
  const usesI18nName = /^__MSG_.+__$/.test(String(manifest.name || ""));
  if (usesI18nName) return result;

  const baseDescription = String(manifest.description || "").replace(/^\[개발 빌드\]\s*/, "");
  if (mode === "development") {
    result.name = "Cloakli DEV";
    if (result.short_name) result.short_name = "Cloakli DEV";
    result.description = "[개발 빌드] " + baseDescription;
  } else {
    // 출시 빌드는 항상 원래 이름/설명으로 되돌린다(소스에 실수로 개발용 표시가
    // 남아 있어도 여기서 항상 제거된다).
    result.name = "Cloakli";
    if (result.short_name) result.short_name = "Cloakli";
    result.description = baseDescription;
  }
  return result;
}

// _locales/<언어>/messages.json 객체에 빌드 라벨을 적용한 새 객체를 돌려준다(순수 함수).
// 개발 빌드: extensionName → "Cloakli DEV", extensionDescription 앞에 "[개발 빌드] ".
// 출시 빌드: 라벨이 남아 있으면 항상 제거해 원래 값으로 되돌린다.
function applyLocaleBuildLabel(messages, mode) {
  const result = JSON.parse(JSON.stringify(messages || {}));
  const baseName = String((result.extensionName && result.extensionName.message) || "Cloakli").replace(/\s*DEV$/, "");
  const baseDescription = String((result.extensionDescription && result.extensionDescription.message) || "").replace(/^\[개발 빌드\]\s*/, "");

  if (mode === "development") {
    result.extensionName = { message: baseName + " DEV" };
    result.extensionDescription = { message: "[개발 빌드] " + baseDescription };
  } else {
    result.extensionName = { message: baseName };
    result.extensionDescription = { message: baseDescription };
  }
  return result;
}

// dist manifest의 __MSG_키__ 값을 dist의 _locales 기본 언어(en) 메시지로 해석한다.
// validate-release.js와 빌드 테스트가 "실제 사용자에게 보이는 이름"을 검사할 때 쓴다.
function resolveManifestMessage(value, distDir) {
  const match = /^__MSG_(.+)__$/.exec(String(value || ""));
  if (!match) return value;
  try {
    const messages = JSON.parse(fs.readFileSync(path.join(distDir, "_locales", "en", "messages.json"), "utf8"));
    const entry = messages[match[1]];
    return entry && entry.message ? entry.message : value;
  } catch (err) {
    return value;
  }
}

// popup.html/options.html 안의 "CLOAKLI_DEV_ONLY_START ~ CLOAKLI_DEV_ONLY_END" 주석
// 사이의 블록(DEV BUILD 배지, 개발 빌드 안내 배너)을 통째로 제거한다. 출시 빌드에는
// 이 블록 자체가 파일에 남지 않아야 하므로, 런타임에 숨기는 것과 별개로 빌드 시점에
// 아예 잘라낸다.
const DEV_ONLY_BLOCK_PATTERN = /[ \t]*<!--\s*CLOAKLI_DEV_ONLY_START[\s\S]*?CLOAKLI_DEV_ONLY_END\s*-->\r?\n?/g;

function stripDevOnlyMarkup(html) {
  return html.replace(DEV_ONLY_BLOCK_PATTERN, "");
}

// mode: "development" | "production"
// options.rootDir: 소스를 읽어올 프로젝트 루트(기본값: 실제 Cloakli 루트). 자동 테스트가
// 실제 프로젝트 파일을 건드리지 않고 임시 fixture 루트로 빌드 로직을 검증할 때 사용한다.
// options.distDir: 결과를 쓸 폴더(기본값: <rootDir>/dist/<mode>)
// 반환값: { mode, distDir, copiedFiles, allFiles }
function buildMode(mode, options) {
  if (VALID_MODES.indexOf(mode) === -1) {
    throw new Error('빌드 모드는 "development" 또는 "production"만 허용됩니다. 입력값: ' + JSON.stringify(mode));
  }

  const opts = options || {};
  const rootDir = opts.rootDir || ROOT_DIR;
  const distDir = opts.distDir || path.join(rootDir, "dist", mode);

  removeRecursive(distDir); // 이전 빌드 결과와 섞이지 않도록 항상 먼저 비운다.
  fs.mkdirSync(distDir, { recursive: true });

  const copiedFiles = [];
  RELEASE_FILES.forEach((relPath) => {
    const src = path.join(rootDir, relPath);
    if (!fs.existsSync(src)) {
      throw new Error("필요한 파일이 없습니다: " + relPath);
    }
    copyRecursive(src, path.join(distDir, relPath));
    copiedFiles.push(relPath);
  });

  RELEASE_DIRS.forEach((relDir) => {
    const src = path.join(rootDir, relDir);
    if (fs.existsSync(src)) {
      copyRecursive(src, path.join(distDir, relDir));
    }
  });

  if (mode === "production") {
    // 원본 소스는 그대로 두고, 출력 폴더 안의 사본만 강제로 덮어써 Developer Pro/디버그가
    // 항상 꺼진 상태로 배포되도록 보장한다. (개발자가 소스에서 developerPro를 true로
    // 바꿔 둔 상태로 실수로 배포해도 이 단계에서 항상 무력화된다.)
    const sourceConfigPath = path.join(rootDir, "build-config.js");
    delete require.cache[require.resolve(sourceConfigPath)];
    const sourceConfig = require(sourceConfigPath);
    fs.writeFileSync(path.join(distDir, "build-config.js"), buildProductionConfigSource(sourceConfig), "utf8");
  }

  // manifest.json의 name/description을 빌드 모드에 맞게 다시 쓴다.
  const manifestDistPath = path.join(distDir, "manifest.json");
  const manifestJson = JSON.parse(fs.readFileSync(manifestDistPath, "utf8"));
  const labeledManifest = applyManifestBuildLabel(manifestJson, mode);
  fs.writeFileSync(manifestDistPath, JSON.stringify(labeledManifest, null, 2) + "\n", "utf8");

  // manifest가 다국어 키를 쓰면 실제 표시 이름은 _locales에서 나오므로, 출력 폴더의
  // 모든 언어 메시지 파일에 빌드 라벨(Cloakli DEV/[개발 빌드])을 적용한다.
  const localesDistDir = path.join(distDir, "_locales");
  if (/^__MSG_.+__$/.test(String(labeledManifest.name || "")) && fs.existsSync(localesDistDir)) {
    fs.readdirSync(localesDistDir).forEach((lang) => {
      const messagesPath = path.join(localesDistDir, lang, "messages.json");
      if (!fs.existsSync(messagesPath)) return;
      const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
      fs.writeFileSync(messagesPath, JSON.stringify(applyLocaleBuildLabel(messages, mode), null, 2) + "\n", "utf8");
    });
  }

  if (mode === "production") {
    // 출시 빌드에는 DEV BUILD 배지/개발 빌드 안내 배너 마크업 자체를 남기지 않는다.
    ["popup.html", "options.html"].forEach((relPath) => {
      const filePath = path.join(distDir, relPath);
      const original = fs.readFileSync(filePath, "utf8");
      fs.writeFileSync(filePath, stripDevOnlyMarkup(original), "utf8");
    });
  }

  const allFiles = listFilesRecursive(distDir);
  return { mode, distDir, copiedFiles, allFiles, manifest: labeledManifest };
}

if (require.main === module) {
  const mode = process.argv[2];
  try {
    const result = buildMode(mode);
    console.log("[build] " + result.mode + " 빌드 완료 -> " + path.relative(ROOT_DIR, result.distDir));
    console.log("[build] 포함된 파일 " + result.allFiles.length + "개");
  } catch (err) {
    console.error("[build] 실패:", err.message);
    process.exit(1);
  }
}

module.exports = {
  buildMode,
  buildProductionConfigSource,
  applyManifestBuildLabel,
  applyLocaleBuildLabel,
  resolveManifestMessage,
  stripDevOnlyMarkup,
  VALID_MODES,
};
