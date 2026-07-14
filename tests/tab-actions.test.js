// tab-actions.js 단위 테스트. popup.js와 background.js(키보드 단축키)가 공유하는
// "탭을 찾고 content script를 주입하고 메시지를 보내는" 로직을 chrome.* 없이 검증한다.
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const TabActions = require("../tab-actions.js");

describe("CONTENT_SCRIPT_FILES: 이미 열려 있던 탭에도 필요한 파일을 모두 주입한다", () => {
  test("content-core.js -> build-config.js -> entitlement.js -> license-client.js -> content.js 순서로 5개 모두 포함한다", () => {
    assert.deepEqual(TabActions.CONTENT_SCRIPT_FILES, [
      "content-core.js",
      "build-config.js",
      "entitlement.js",
      "license-client.js",
      "content.js",
    ]);
  });

  // 이 테스트는 정확히 이번 버그(ensureContentInjected가 build-config.js/entitlement.js를
  // 빠뜨려, 팝업 버튼으로 주입할 때만 content.js가 CloakliEntitlement 없이 실행되던 문제)의
  // 재발을 막기 위한 것이다: manifest.json의 정적 content_scripts와 팝업/단축키가 쓰는
  // 동적 주입 목록이 항상 정확히 같은 파일을 같은 순서로 사용해야 한다.
  test("manifest.json의 content_scripts.js와 정확히 같은 파일을 같은 순서로 사용한다", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
    const manifestFiles = manifest.content_scripts[0].js;
    assert.deepEqual(TabActions.CONTENT_SCRIPT_FILES, manifestFiles);
  });
});

describe("isUnsupportedUrl", () => {
  test("chrome://, 웹스토어, 새 탭 등 내부 페이지는 지원하지 않는다", () => {
    [
      "chrome://extensions",
      "chrome://newtab",
      "edge://settings",
      "about:blank",
      "https://chrome.google.com/webstore/detail/x",
      "https://chromewebstore.google.com/detail/x",
    ].forEach((url) => {
      assert.equal(TabActions.isUnsupportedUrl(url), true, `${url}은 지원하지 않아야 한다`);
    });
  });

  test("일반 http/https 웹사이트는 지원한다", () => {
    ["https://example.com/", "http://localhost:3000/", "https://www.youtube.com/watch?v=1"].forEach((url) => {
      assert.equal(TabActions.isUnsupportedUrl(url), false, `${url}은 지원해야 한다`);
    });
  });

  test("url이 없으면 지원하지 않는 것으로 안전하게 처리한다", () => {
    assert.equal(TabActions.isUnsupportedUrl(undefined), true);
    assert.equal(TabActions.isUnsupportedUrl(""), true);
    assert.equal(TabActions.isUnsupportedUrl(null), true);
  });
});

// chrome.* 없이 dispatchCloakliMessage의 분기(탭 없음/지원 안 함/정상)를 확인하기 위한
// 최소한의 chrome 모의 구현.
function installFakeChrome(overrides) {
  global.chrome = Object.assign(
    {
      tabs: {
        query: async () => [{ id: 1, url: "https://example.com/" }],
        sendMessage: (tabId, message, cb) => cb({ ok: true }),
      },
      scripting: {
        insertCSS: async () => {},
        executeScript: async () => {},
      },
      runtime: { lastError: undefined },
    },
    overrides || {}
  );
}

describe("dispatchCloakliMessage", () => {
  test("탭을 찾을 수 없으면 unsupported로 처리한다", async () => {
    installFakeChrome({
      tabs: {
        query: async () => [],
        sendMessage: () => {},
      },
    });
    const result = await TabActions.dispatchCloakliMessage("START_SELECTION_MODE");
    assert.equal(result.ok, false);
    assert.equal(result.unsupported, true);
  });

  test("지원하지 않는 URL(chrome://)이면 unsupported로 처리한다", async () => {
    installFakeChrome({
      tabs: {
        query: async () => [{ id: 1, url: "chrome://extensions" }],
        sendMessage: () => {},
      },
    });
    const result = await TabActions.dispatchCloakliMessage("CLEAR_ALL_MASKS");
    assert.equal(result.ok, false);
    assert.equal(result.unsupported, true);
  });

  test("정상 페이지에서는 content script를 주입한 뒤 메시지를 보내고 응답을 그대로 돌려준다", async () => {
    let injectedFiles = null;
    let sentMessage = null;
    installFakeChrome({
      tabs: {
        query: async () => [{ id: 42, url: "https://example.com/" }],
        sendMessage: (tabId, message, cb) => {
          sentMessage = message;
          cb({ ok: true, custom: "yes" });
        },
      },
      scripting: {
        insertCSS: async () => {},
        executeScript: async (opts) => {
          injectedFiles = opts.files;
        },
      },
    });

    const result = await TabActions.dispatchCloakliMessage("START_SELECTION_MODE");
    assert.deepEqual(injectedFiles, ["content-core.js", "build-config.js", "entitlement.js", "license-client.js", "content.js"]);
    assert.equal(sentMessage.type, "START_SELECTION_MODE");
    assert.equal(result.ok, true);
    assert.equal(result.custom, "yes");
  });

  test("chrome.scripting.executeScript가 실패해도(내부 페이지 등) unsupported로 처리한다", async () => {
    installFakeChrome({
      tabs: {
        query: async () => [{ id: 1, url: "https://example.com/" }],
        sendMessage: () => {
          throw new Error("호출되면 안 됨");
        },
      },
      scripting: {
        insertCSS: async () => {
          throw new Error("주입 거부");
        },
        executeScript: async () => {},
      },
    });
    const result = await TabActions.dispatchCloakliMessage("START_SELECTION_MODE");
    assert.equal(result.ok, false);
    assert.equal(result.unsupported, true);
  });

  test("getActiveTab 자체가 예외를 던져도 unsupported로 안전하게 처리한다", async () => {
    installFakeChrome({
      tabs: {
        query: async () => {
          throw new Error("쿼리 실패");
        },
        sendMessage: () => {},
      },
    });
    const result = await TabActions.dispatchCloakliMessage("START_SELECTION_MODE");
    assert.equal(result.ok, false);
    assert.equal(result.unsupported, true);
  });
});
