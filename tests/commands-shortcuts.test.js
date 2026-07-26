"use strict";

// 키보드 단축키(chrome.commands) 회귀 테스트.
//
// 실제로 겪은 사고: 프로젝트 폴더를 옮기자 unpacked 확장 ID가 바뀌면서(경로 해시 기반)
// Chrome이 전혀 다른 확장으로 취급 → 사용자가 지정해 둔 단축키가 전부 사라졌다.
// 이 파일은 그 사고의 두 축을 모두 잠근다:
//   (1) command ID / suggested_key / description 키가 조용히 바뀌지 않도록 고정
//   (2) 개발 빌드에 고정 확장 키(key)가 항상 들어가고 production에는 절대 안 들어가도록 고정
//
// command ID가 바뀌면 Chrome은 그것을 "없어진 명령 + 새 명령"으로 보고 기존 사용자에게
// 배정돼 있던 단축키를 버린다. 그래서 ID는 사실상 영구 계약이며 여기서 문자열로 못 박는다.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const { applyDevExtensionKey } = require("../scripts/build");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// 출시된 확장이 실제로 쓰는 값. 이 값을 바꾸면 기존 사용자의 단축키가 초기화되므로
// 테스트를 고쳐서 통과시키기 전에 "정말 바꿔도 되는가"를 반드시 다시 판단해야 한다.
const EXPECTED_COMMANDS = {
  "start-selection": {
    default: "Ctrl+Shift+H",
    mac: "Command+Shift+H",
    description: "__MSG_commandStartSelection__",
  },
  "temporarily-clear-page": {
    default: "Ctrl+Shift+U",
    mac: "Command+Shift+U",
    description: "__MSG_commandTemporarilyClear__",
  },
};

describe("commands: manifest 정의 고정", () => {
  test("command ID 목록이 정확히 일치한다 (ID가 바뀌면 기존 사용자 단축키가 초기화된다)", () => {
    const manifest = readJson(path.join(ROOT, "manifest.json"));
    assert.deepStrictEqual(
      Object.keys(manifest.commands).sort(),
      Object.keys(EXPECTED_COMMANDS).sort()
    );
  });

  test("각 command의 suggested_key와 description 키가 고정값과 일치한다", () => {
    const manifest = readJson(path.join(ROOT, "manifest.json"));
    for (const [id, expected] of Object.entries(EXPECTED_COMMANDS)) {
      const actual = manifest.commands[id];
      assert.ok(actual, `command 누락: ${id}`);
      assert.equal(actual.suggested_key.default, expected.default, `${id}: default 키`);
      assert.equal(actual.suggested_key.mac, expected.mac, `${id}: mac 키`);
      assert.equal(actual.description, expected.description, `${id}: description`);
    }
  });

  test("command description의 i18n 키가 en/ko 로케일에 모두 존재한다 (없으면 단축키 화면이 빈칸으로 보인다)", () => {
    const manifest = readJson(path.join(ROOT, "manifest.json"));
    const en = readJson(path.join(ROOT, "_locales", "en", "messages.json"));
    const ko = readJson(path.join(ROOT, "_locales", "ko", "messages.json"));
    for (const cmd of Object.values(manifest.commands)) {
      const m = /^__MSG_(\w+)__$/.exec(cmd.description);
      assert.ok(m, `description이 i18n 키가 아님: ${cmd.description}`);
      assert.ok(en[m[1]], `en 로케일에 ${m[1]} 누락`);
      assert.ok(ko[m[1]], `ko 로케일에 ${m[1]} 누락`);
    }
  });

  test("background.js가 manifest의 모든 command ID를 실제로 처리한다", () => {
    const manifest = readJson(path.join(ROOT, "manifest.json"));
    const src = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
    assert.match(src, /chrome\.commands\.onCommand\.addListener/, "onCommand 리스너가 있어야 한다");
    for (const id of Object.keys(manifest.commands)) {
      assert.ok(src.includes('"' + id + '"'), `background.js가 ${id}를 처리하지 않는다`);
    }
  });
});

describe("commands: 빌드 산출물에도 그대로 유지된다", () => {
  for (const mode of ["development", "production"]) {
    test(`${mode} 빌드 manifest에 command 정의가 원본 그대로 남아 있다`, () => {
      const distManifestPath = path.join(ROOT, "dist", mode, "manifest.json");
      if (!fs.existsSync(distManifestPath)) return; // 빌드 전이면 건너뛴다(build 테스트가 별도 검증)
      const dist = readJson(distManifestPath);
      const source = readJson(path.join(ROOT, "manifest.json"));
      assert.deepStrictEqual(dist.commands, source.commands, `${mode} 빌드에서 commands가 변형되면 안 된다`);
    });
  }
});

// unpacked 확장 ID = SHA-256(공개키 DER)의 앞 16바이트를 a-p로 매핑.
function extensionIdFromKey(keyB64) {
  const der = Buffer.from(keyB64, "base64");
  const hash = crypto.createHash("sha256").update(der).digest("hex").slice(0, 32);
  return hash.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

describe("확장 ID 안정성: 개발 빌드는 폴더 경로가 바뀌어도 ID가 고정된다", () => {
  test("dev-extension-key.json이 존재하고 기록된 ID가 키에서 실제로 파생된다", () => {
    const devKey = readJson(path.join(ROOT, "scripts", "dev-extension-key.json"));
    assert.ok(devKey.key, "key 값이 있어야 한다");
    assert.equal(
      extensionIdFromKey(devKey.key),
      devKey.extensionId,
      "기록된 extensionId가 key에서 파생된 값과 달라 혼란을 준다"
    );
  });

  test("applyDevExtensionKey: development에만 key를 넣고 production에서는 제거한다", () => {
    const base = { name: "x", commands: {} };
    const dev = applyDevExtensionKey(base, "development", "KEYVALUE");
    const prod = applyDevExtensionKey(base, "production", "KEYVALUE");
    assert.equal(dev.key, "KEYVALUE", "개발 빌드에는 고정 키가 들어가야 한다");
    assert.ok(!("key" in prod), "production 빌드에는 key가 절대 들어가면 안 된다(스토어가 ID를 발급)");
    // 소스에 실수로 key가 남아 있어도 production에서는 항상 제거된다.
    const prodStripped = applyDevExtensionKey({ ...base, key: "LEFTOVER" }, "production", null);
    assert.ok(!("key" in prodStripped), "production은 기존 key도 제거해야 한다");
  });

  test("실제 빌드 산출물: development에는 고정 key, production에는 key 없음", () => {
    const devPath = path.join(ROOT, "dist", "development", "manifest.json");
    const prodPath = path.join(ROOT, "dist", "production", "manifest.json");
    if (!fs.existsSync(devPath) || !fs.existsSync(prodPath)) return;

    const devKey = readJson(path.join(ROOT, "scripts", "dev-extension-key.json"));
    const dev = readJson(devPath);
    const prod = readJson(prodPath);

    assert.equal(dev.key, devKey.key, "개발 빌드 manifest에 고정 키가 있어야 한다");
    assert.equal(
      extensionIdFromKey(dev.key),
      devKey.extensionId,
      "개발 빌드 확장 ID가 기록된 값과 같아야 한다(라이선스 allowlist 등록에 쓰인다)"
    );
    assert.ok(!("key" in prod), "production 빌드 manifest에는 key가 없어야 한다");
  });

  test("소스 manifest.json에는 key를 두지 않는다 (빌드가 모드별로 주입한다)", () => {
    const manifest = readJson(path.join(ROOT, "manifest.json"));
    assert.ok(
      !("key" in manifest),
      "소스에 key를 직접 넣으면 production ZIP에도 섞여 스토어 ID와 충돌할 수 있다"
    );
  });
});
