// 빌드 분리(개발/출시), 출시 전 자동 검사, ZIP 패키징 스크립트에 대한 자동 테스트.
// 실제 프로젝트의 dist/, releases/ 폴더는 건드리지 않고, 매번 임시 폴더에 실제
// scripts/build.js 등을 그대로 실행해 검증한다(테스트 전용 코드를 스크립트 안에 섞지 않는다).
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { buildMode, VALID_MODES } = require("../scripts/build");
const { validateRelease } = require("../scripts/validate-release");
const { packageRelease } = require("../scripts/package-release");
const { copyRecursive, removeRecursive } = require("../scripts/fs-utils");
const { RELEASE_FILES, RELEASE_DIRS } = require("../scripts/file-manifest");

const REAL_ROOT = path.join(__dirname, "..");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// 실제 프로젝트의 RELEASE_FILES만 복사한 최소 fixture 프로젝트 루트를 만든다.
// (tests/, node_modules/, package.json 등은 애초에 포함하지 않으므로, build.js가
// "필요한 파일만" 복사하는지를 실제 파일 내용으로 검증할 수 있다.)
//
// build-config.js는 실제 저장소의 파일을 그대로 복사하지 않고 항상 결정론적인 기본값
// (developerPro:false, 유효한 https licenseServerUrl)으로 다시 쓴다 — 그래야 이 테스트들이
// 개발자가 로컬에서 developerPro를 true로 바꿔 두었거나 licenseServerUrl을 아직 실제
// 배포 URL로 채우지 않은 상태(현재 저장소의 실제 상태)와 무관하게 항상 안정적으로 통과한다.
// buildConfigOverride로 특정 필드만 덮어써 개별 시나리오(Developer Pro 강제 등)를 테스트한다.
function createFixtureRoot(buildConfigOverride) {
  const root = makeTempDir("cloakli-fixture-");
  RELEASE_FILES.forEach((relPath) => {
    copyRecursive(path.join(REAL_ROOT, relPath), path.join(root, relPath));
  });
  RELEASE_DIRS.forEach((relDir) => {
    const src = path.join(REAL_ROOT, relDir);
    if (fs.existsSync(src)) {
      copyRecursive(src, path.join(root, relDir));
    } else {
      fs.mkdirSync(path.join(root, relDir), { recursive: true });
    }
  });
  writeBuildConfig(
    root,
    Object.assign(
      {
        mode: "development",
        developerPro: false,
        debug: false,
        licenseServerUrl: "https://cloakli-license.example.workers.dev",
        checkoutUrl: "",
      },
      buildConfigOverride || {}
    )
  );
  return root;
}

function writeBuildConfig(root, config) {
  const src = [
    "(function (root) {",
    '  "use strict";',
    "  const CLOAKLI_BUILD_CONFIG = " + JSON.stringify(config) + ";",
    '  if (typeof module !== "undefined" && module.exports) {',
    "    module.exports = CLOAKLI_BUILD_CONFIG;",
    "  } else {",
    "    root.CloakliBuildConfig = CLOAKLI_BUILD_CONFIG;",
    "  }",
    '})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);',
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "build-config.js"), src, "utf8");
}

function requireFresh(filePath) {
  delete require.cache[require.resolve(filePath)];
  return require(filePath);
}

describe("build.js: 빌드 모드/설정", () => {
  test("허용되지 않는 빌드 모드는 예외를 던진다", () => {
    assert.throws(() => buildMode("staging"));
    assert.throws(() => buildMode(undefined));
    assert.throws(() => buildMode(""));
  });

  test("development 빌드는 소스의 build-config.js를 그대로 복사한다 (developerPro:true가 유지됨)", () => {
    const root = createFixtureRoot();
    writeBuildConfig(root, { mode: "development", developerPro: true, debug: false });
    const distDir = path.join(root, "out-dev");

    buildMode("development", { rootDir: root, distDir });
    const config = requireFresh(path.join(distDir, "build-config.js"));

    assert.equal(config.developerPro, true, "development 빌드는 developerPro를 강제로 끄지 않아야 한다");
    removeRecursive(root);
  });

  test("production 빌드는 developerPro/debug를 항상 false로, mode를 production으로 강제한다", () => {
    const root = createFixtureRoot();
    // 일부러 위험한 상태(Developer Pro + 디버그 켜짐)로 소스를 준비해도 결과는 항상 안전해야 한다.
    writeBuildConfig(root, { mode: "development", developerPro: true, debug: true });
    const distDir = path.join(root, "out-prod");

    buildMode("production", { rootDir: root, distDir });
    const config = requireFresh(path.join(distDir, "build-config.js"));

    assert.equal(config.developerPro, false);
    assert.equal(config.debug, false);
    assert.equal(config.mode, "production");
    removeRecursive(root);
  });

  test("production 빌드에서 entitlement.js는 항상 free 상태를 돌려준다", () => {
    const root = createFixtureRoot();
    writeBuildConfig(root, { mode: "development", developerPro: true, debug: false });
    const distDir = path.join(root, "out-prod2");

    buildMode("production", { rootDir: root, distDir });
    requireFresh(path.join(distDir, "content-core.js"));
    requireFresh(path.join(distDir, "build-config.js"));
    const CloakliEntitlement = requireFresh(path.join(distDir, "entitlement.js"));

    const state = CloakliEntitlement.getEntitlementState();
    assert.equal(state.isPro, false, "production 빌드의 기본 entitlement는 항상 free여야 한다");
    removeRecursive(root);
  });

  test("build mode 값이 유효한 값(development/production)만 노출한다", () => {
    assert.deepEqual(VALID_MODES.slice().sort(), ["development", "production"]);
  });

  test("storage로 Developer Pro를 활성화할 수 없다 (entitlement.js가 chrome.storage API를 호출하지 않음)", () => {
    const src = fs.readFileSync(path.join(REAL_ROOT, "entitlement.js"), "utf8");
    // 설명 주석에는 "chrome.storage.local의 값" 같은 표현이 나올 수 있으므로,
    // 실제 API 호출(.get(/.set(/.remove(/.addListener() 형태만 검사한다.
    assert.ok(
      !/chrome\.storage\.(local|sync)\.(get|set|remove)\s*\(/.test(src),
      "entitlement.js는 chrome.storage.local/sync를 직접 읽거나 쓰면 안 된다"
    );
    assert.ok(
      !/chrome\.storage\.onChanged\.addListener\s*\(/.test(src),
      "entitlement.js는 chrome.storage.onChanged를 구독하면 안 된다"
    );
  });
});

describe("build.js: 파일 복사", () => {
  test("production 빌드에 필수 파일이 모두 존재한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });

    RELEASE_FILES.forEach((relPath) => {
      assert.ok(fs.existsSync(path.join(distDir, relPath)), relPath + "가 있어야 한다");
    });
    removeRecursive(root);
  });

  test("production 빌드에 tests/, node_modules/, package.json, README가 없다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });

    assert.equal(fs.existsSync(path.join(distDir, "tests")), false);
    assert.equal(fs.existsSync(path.join(distDir, "node_modules")), false);
    assert.equal(fs.existsSync(path.join(distDir, "package.json")), false);
    assert.equal(fs.existsSync(path.join(distDir, "package-lock.json")), false);
    assert.equal(fs.existsSync(path.join(distDir, "README.md")), false);
    removeRecursive(root);
  });

  test("manifest.json이 참조하는 파일이 production 빌드 안에 모두 존재한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });

    const manifest = JSON.parse(fs.readFileSync(path.join(distDir, "manifest.json"), "utf8"));
    (manifest.content_scripts || []).forEach((entry) => {
      (entry.js || []).forEach((f) => assert.ok(fs.existsSync(path.join(distDir, f)), f));
      (entry.css || []).forEach((f) => assert.ok(fs.existsSync(path.join(distDir, f)), f));
    });
    assert.ok(fs.existsSync(path.join(distDir, manifest.action.default_popup)));
    assert.ok(fs.existsSync(path.join(distDir, manifest.options_ui.page)));
    assert.ok(fs.existsSync(path.join(distDir, manifest.background.service_worker)));
    removeRecursive(root);
  });
});

describe("build.js: 개발/출시 빌드 이름 구분 (Cloakli DEV vs Cloakli)", () => {
  // manifest가 다국어 키(__MSG_extensionName__)를 쓰므로, 실제 사용자에게 보이는
  // 이름/설명은 dist의 _locales 기본 언어(en) 메시지를 resolve해서 검사한다.
  const { resolveManifestMessage } = require("../scripts/build");

  test("development 빌드의 표시 이름은 'Cloakli DEV', 설명에는 개발 빌드 표시가 붙는다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out-dev");
    buildMode("development", { rootDir: root, distDir });

    const manifest = JSON.parse(fs.readFileSync(path.join(distDir, "manifest.json"), "utf8"));
    assert.equal(resolveManifestMessage(manifest.name, distDir), "Cloakli DEV");
    assert.match(resolveManifestMessage(manifest.description, distDir), /^\[개발 빌드\]/);
    // ko 메시지에도 같은 라벨이 적용되어야 한다(한국어 Chrome에서도 DEV가 구분되도록).
    const ko = JSON.parse(fs.readFileSync(path.join(distDir, "_locales", "ko", "messages.json"), "utf8"));
    assert.equal(ko.extensionName.message, "Cloakli DEV");
    removeRecursive(root);
  });

  test("production 빌드의 표시 이름은 'Cloakli', 설명에 개발 문구가 없다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out-prod");
    buildMode("production", { rootDir: root, distDir });

    const manifest = JSON.parse(fs.readFileSync(path.join(distDir, "manifest.json"), "utf8"));
    assert.equal(resolveManifestMessage(manifest.name, distDir), "Cloakli");
    assert.ok(!resolveManifestMessage(manifest.description, distDir).includes("[개발 빌드]"));
    removeRecursive(root);
  });

  test("development popup.html/options.html에는 DEV BUILD 배지/개발 빌드 배너 마크업이 남아 있다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out-dev");
    buildMode("development", { rootDir: root, distDir });

    const popupHtml = fs.readFileSync(path.join(distDir, "popup.html"), "utf8");
    const optionsHtml = fs.readFileSync(path.join(distDir, "options.html"), "utf8");
    assert.ok(popupHtml.includes('id="cloakli-dev-badge"'));
    assert.ok(optionsHtml.includes('id="cloakli-dev-banner"'));
    removeRecursive(root);
  });

  test("production popup.html/options.html에는 DEV BUILD 배지/개발 빌드 배너 마크업이 완전히 제거된다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out-prod");
    buildMode("production", { rootDir: root, distDir });

    const popupHtml = fs.readFileSync(path.join(distDir, "popup.html"), "utf8");
    const optionsHtml = fs.readFileSync(path.join(distDir, "options.html"), "utf8");
    assert.ok(!popupHtml.includes("cloakli-dev-badge"));
    assert.ok(!popupHtml.includes("DEV BUILD"));
    assert.ok(!optionsHtml.includes("cloakli-dev-banner"));
    assert.ok(!optionsHtml.includes("개발 빌드"));
    // 마커 주석 자체도 남으면 안 된다.
    assert.ok(!popupHtml.includes("CLOAKLI_DEV_ONLY_START"));
    assert.ok(!optionsHtml.includes("CLOAKLI_DEV_ONLY_START"));
    removeRecursive(root);
  });

  test("production으로 다시 빌드해도 popup.html/options.html의 나머지 구조는 그대로 남는다(과도하게 잘리지 않음)", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out-prod");
    buildMode("production", { rootDir: root, distDir });

    const popupHtml = fs.readFileSync(path.join(distDir, "popup.html"), "utf8");
    const optionsHtml = fs.readFileSync(path.join(distDir, "options.html"), "utf8");
    assert.ok(popupHtml.includes('id="cloakli-select-btn"'));
    assert.ok(popupHtml.includes('id="cloakli-plan-badge"'));
    assert.ok(optionsHtml.includes('id="cloakli-options-list"'));
    removeRecursive(root);
  });
});

describe("validate-release.js: 출시 안전 검사", () => {
  test("정상적인 production 빌드는 검증을 통과한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });

    const result = validateRelease(distDir);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    removeRecursive(root);
  });

  test("developerPro: true 패턴이 남아 있으면 실패한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    fs.writeFileSync(
      path.join(distDir, "build-config.js"),
      "const x = { developerPro: true };\nmodule.exports = x;\n"
    );

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("Developer Pro")));
    removeRecursive(root);
  });

  test("debugger 문이 있으면 실패한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    fs.appendFileSync(path.join(distDir, "content.js"), "\ndebugger;\n");

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("디버그")));
    removeRecursive(root);
  });

  test("console.log는 실패시키지 않고 경고만 남긴다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    fs.appendFileSync(path.join(distDir, "options.js"), '\nconsole.log("debug output");\n');

    const result = validateRelease(distDir);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.ok(result.warnings.some((w) => w.includes("console.log")));
    removeRecursive(root);
  });

  test("fetch(...) 호출이 있으면 실패한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    fs.appendFileSync(path.join(distDir, "popup.js"), '\nfetch("https://example.com");\n');

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("외부 통신")));
    removeRecursive(root);
  });

  test("원격 <script> 참조가 있으면 실패한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    const htmlPath = path.join(distDir, "popup.html");
    const html = fs.readFileSync(htmlPath, "utf8").replace(
      "</body>",
      '<script src="https://cdn.example.com/x.js"></script></body>'
    );
    fs.writeFileSync(htmlPath, html);

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("외부 URL")));
    removeRecursive(root);
  });

  test("금지 파일(tests/)이 섞여 있으면 실패한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    fs.mkdirSync(path.join(distDir, "tests"), { recursive: true });
    fs.writeFileSync(path.join(distDir, "tests", "leftover.test.js"), "// leftover\n");

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("tests/")));
    removeRecursive(root);
  });

  test("manifest.json이 유효하지 않은 JSON이면 실패한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    fs.writeFileSync(path.join(distDir, "manifest.json"), "{ not valid json");

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("JSON")));
    removeRecursive(root);
  });

  test("존재하지 않는 아이콘을 참조하면 실패한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    const manifestPath = path.join(distDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.icons = { "128": "icons/missing.png" };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("icons")));
    removeRecursive(root);
  });

  test("불필요한 권한(host_permissions)이 추가되면 실패한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    const manifestPath = path.join(distDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.host_permissions = ["<all_urls>"];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("host_permissions") || e.includes("<all_urls>")));
    removeRecursive(root);
  });

  test("존재하지 않는 폴더를 검증하면 실패한다", () => {
    const result = validateRelease(path.join(os.tmpdir(), "cloakli-does-not-exist-" + Date.now()));
    assert.equal(result.ok, false);
  });

  test("licenseServerUrl이 localhost를 가리키면 실패한다(개발용 placeholder가 그대로 출시되는 것을 막음)", () => {
    const root = createFixtureRoot({ licenseServerUrl: "http://127.0.0.1:8787" });
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("localhost")));
    removeRecursive(root);
  });

  test("licenseServerUrl이 비어 있으면 실패한다", () => {
    const root = createFixtureRoot({ licenseServerUrl: "" });
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("licenseServerUrl이 비어 있습니다")));
    removeRecursive(root);
  });

  test("licenseServerUrl이 https가 아니면 실패한다", () => {
    const root = createFixtureRoot({ licenseServerUrl: "http://cloakli-license.example.workers.dev" });
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("https")));
    removeRecursive(root);
  });

  test("실제 배포 URL처럼 보이는 https licenseServerUrl은 통과한다", () => {
    const root = createFixtureRoot({ licenseServerUrl: "https://cloakli-license.example.workers.dev" });
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });

    const result = validateRelease(distDir);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    removeRecursive(root);
  });

  test("manifest.json의 name에 개발 빌드 표시('Cloakli DEV')가 남아 있으면 실패한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    const manifestPath = path.join(distDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.name = "Cloakli DEV";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("개발 빌드 표시")));
    removeRecursive(root);
  });

  test("manifest.json의 description에 '[개발 빌드]' 문구가 남아 있으면 실패한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    const manifestPath = path.join(distDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.description = "[개발 빌드] " + manifest.description;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    removeRecursive(root);
  });

  test("DEV BUILD 배지 마크업이 남아 있으면 실패한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    const popupPath = path.join(distDir, "popup.html");
    fs.appendFileSync(popupPath, '<p id="cloakli-dev-badge">DEV BUILD</p>\n');

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("개발 빌드 전용 표시")));
    removeRecursive(root);
  });

  test("빌드 파일이 누락되면 실패한다 (entitlement.js가 없는 경우)", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    fs.rmSync(path.join(distDir, "entitlement.js"));

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("entitlement.js")));
    removeRecursive(root);
  });

  test("manifest.json의 content_scripts 순서가 틀리면 실패한다 (entitlement.js가 build-config.js보다 먼저)", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    const manifestPath = path.join(distDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.content_scripts[0].js = ["content-core.js", "entitlement.js", "build-config.js", "content.js"];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("순서")));
    removeRecursive(root);
  });

  test("popup.html의 <script> 순서가 틀리면 실패한다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    const popupPath = path.join(distDir, "popup.html");
    let html = fs.readFileSync(popupPath, "utf8");
    // entitlement.js를 build-config.js보다 먼저 오도록 뒤바꾼다.
    html = html
      .replace('<script src="build-config.js"></script>', "___TMP___")
      .replace('<script src="entitlement.js"></script>', '<script src="build-config.js"></script>')
      .replace("___TMP___", '<script src="entitlement.js"></script>');
    fs.writeFileSync(popupPath, html);

    const result = validateRelease(distDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("popup.html") && e.includes("순서")));
    removeRecursive(root);
  });
});

describe("package-release.js: ZIP 생성", () => {
  test("ZIP이 생성되고 최상단에 manifest.json이 있으며 tests/node_modules/dist 폴더가 없다", () => {
    const root = createFixtureRoot();
    const distDir = path.join(root, "out");
    buildMode("production", { rootDir: root, distDir });
    const releasesDir = path.join(root, "releases-out");

    const result = packageRelease(distDir, releasesDir);

    assert.ok(fs.existsSync(result.zipPath), "ZIP 파일이 실제로 생성되어야 한다");
    assert.equal(result.topLevelEntries[0], "manifest.json", "ZIP 최상단은 manifest.json이어야 한다");
    assert.ok(result.entryCount > 0, "빈 ZIP이면 안 된다");
    assert.ok(!result.topLevelEntries.some((n) => n.startsWith("tests/")));
    assert.ok(!result.topLevelEntries.some((n) => n.includes("node_modules/")));
    assert.ok(!result.topLevelEntries.some((n) => n.startsWith("production/") || n.startsWith("dist/")));
    assert.ok(result.fileName.includes(result.version), "파일명에 버전이 포함되어야 한다");
    assert.ok(result.size > 0);
    assert.match(result.sha256, /^[0-9a-f]{64}$/, "SHA-256 해시 형식이어야 한다");
    removeRecursive(root);
  });

  test("빈 폴더는 ZIP으로 만들 수 없다", () => {
    const root = makeTempDir("cloakli-empty-");
    fs.mkdirSync(path.join(root, "empty"), { recursive: true });
    assert.throws(() => packageRelease(path.join(root, "empty"), path.join(root, "releases-out")));
    removeRecursive(root);
  });

  test("존재하지 않는 출력 폴더는 ZIP으로 만들 수 없다", () => {
    assert.throws(() =>
      packageRelease(path.join(os.tmpdir(), "cloakli-missing-" + Date.now()), path.join(os.tmpdir(), "cloakli-releases-x"))
    );
  });
});

describe("회귀: 기존 entitlement/저장/가림 관련 파일 자체는 이번 단계에서 바뀌지 않았다", () => {
  test("content.js/entitlement.js가 여전히 CloakliEntitlement/CloakliCore를 사용한다", () => {
    const contentSrc = fs.readFileSync(path.join(REAL_ROOT, "content.js"), "utf8");
    assert.ok(contentSrc.includes("CloakliEntitlement"));
    assert.ok(contentSrc.includes("CloakliCore"));
  });

  test("manifest.json 권한은 activeTab/alarms/scripting/storage 뿐이다", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REAL_ROOT, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.permissions.slice().sort(), ["activeTab", "alarms", "scripting", "storage"]);
  });
});
