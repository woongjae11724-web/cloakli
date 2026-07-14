// popup.js를 실제로 한 줄도 바꾸지 않고 Node의 vm 모듈로 그대로 실행해, "가릴 영역 선택"
// 버튼 클릭부터 content script로의 메시지 전송까지 전체 흐름을 검증한다.
// content-integration.test.js가 content.js를 검증하는 것과 같은 방식이다.
//
// 이 파일은 다음 실제 버그의 재발을 막기 위해 추가되었다: tab-actions.js의
// ensureContentInjected가 build-config.js/entitlement.js를 빠뜨려, 이미 열려 있던 탭에서
// 팝업 버튼을 눌렀을 때 content.js가 CloakliEntitlement 없이 실행되어 요소 클릭 시
// 조용히 멈추던 문제.
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createPopupEnv } = require("./helpers/fake-popup-env");

const CONTENT_SCRIPT_FILES = ["content-core.js", "build-config.js", "entitlement.js", "license-client.js", "content.js"];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("popup: 가릴 영역 선택 버튼 -> content script 메시지 전송 흐름", () => {
  test("버튼 클릭 시 활성 탭을 조회하고 이벤트가 실제로 등록되어 있다", async () => {
    const env = createPopupEnv();
    env.loadPopupScript();
    await wait(30);

    const before = env.chrome.__calls.tabsQuery;
    env.click(env.document.getElementById("cloakli-select-btn"));
    await wait(30);

    assert.ok(env.chrome.__calls.tabsQuery > before, "클릭 시 활성 탭을 조회해야 한다");
  });

  test("content script 주입 시 5개 파일(content-core/build-config/entitlement/license-client/content)을 모두 포함한다", async () => {
    const env = createPopupEnv();
    env.loadPopupScript();
    await wait(30);

    env.click(env.document.getElementById("cloakli-select-btn"));
    await wait(30);

    const lastExecuteScript = env.chrome.__calls.executeScript[env.chrome.__calls.executeScript.length - 1];
    assert.ok(lastExecuteScript, "executeScript가 호출되어야 한다");
    // vm 샌드박스(다른 realm)에서 만들어진 배열이라 deepStrictEqual의 프로토타입 비교가
    // 실패할 수 있으므로, 값만 문자열로 비교한다.
    assert.equal(Array.from(lastExecuteScript.files).join(","), CONTENT_SCRIPT_FILES.join(","));
  });

  test("지원 가능한 URL이면 START_SELECTION_MODE 메시지를 올바른 탭으로 전송한다", async () => {
    const env = createPopupEnv({ chrome: { activeTab: { id: 42, url: "https://example.com/" } } });
    env.loadPopupScript();
    await wait(30);

    env.click(env.document.getElementById("cloakli-select-btn"));
    await wait(30);

    const lastMessage = env.chrome.__calls.sendMessage[env.chrome.__calls.sendMessage.length - 1];
    assert.ok(lastMessage, "메시지가 전송되어야 한다");
    assert.equal(lastMessage.tabId, 42);
    assert.equal(lastMessage.message.type, "START_SELECTION_MODE");
  });

  test("메시지 전송 성공 시 선택 모드 시작 안내가 표시된다", async () => {
    const env = createPopupEnv();
    env.loadPopupScript();
    await wait(30);

    env.click(env.document.getElementById("cloakli-select-btn"));
    await wait(30);

    assert.equal(
      env.document.getElementById("cloakli-status").textContent,
      "선택 모드가 시작되었습니다. 팝업을 닫아도 계속 동작합니다."
    );
  });

  test("메시지 전송이 실패해도(content script 없음 등) 구체적인 안내가 표시되고 버튼은 다시 활성화된다", async () => {
    const env = createPopupEnv({
      chrome: {
        sendMessage: (tabId, message, cb) => cb({ ok: false, error: "Could not establish connection." }),
      },
    });
    env.loadPopupScript();
    await wait(30);

    const selectBtn = env.document.getElementById("cloakli-select-btn");
    env.click(selectBtn);
    await wait(30);

    assert.equal(selectBtn.disabled, false, "실패 후에도 버튼이 영구적으로 잠기면 안 된다");
    const msg = env.document.getElementById("cloakli-status").textContent;
    assert.match(msg, /Cloakli를 현재 페이지에서 시작하지 못했습니다/);
    assert.match(msg, /새로고침/);
  });

  test("지원하지 않는 URL(chrome://)에서는 실패해도 페이지 전용 안내가 표시된다", async () => {
    const env = createPopupEnv({ chrome: { activeTab: { id: 1, url: "chrome://extensions" } } });
    env.loadPopupScript();
    await wait(30);

    // 지원하지 않는 페이지에서는 refreshStatus()가 이미 selectBtn을 비활성화해 둔다.
    // withButtonGuard는 이미 비활성화된 버튼의 클릭을 무시하므로, 여기서는 상태 패널의
    // 안내 문구만으로 "지원하지 않는 페이지" 분기를 확인한다.
    assert.equal(env.document.getElementById("cloakli-select-btn").disabled, true);
    assert.match(env.document.getElementById("cloakli-status-hostname").textContent, /사용할 수 없습니다/);
  });
});

describe("popup: DEV BUILD 배지", () => {
  test("development 빌드 설정에서는 DEV BUILD 배지가 표시된다", async () => {
    const env = createPopupEnv();
    env.loadPopupScript({ buildConfig: { mode: "development", developerPro: false, debug: false } });
    await wait(20);

    const badge = env.document.getElementById("cloakli-dev-badge");
    assert.ok(badge, "DEV BUILD 배지 요소가 있어야 한다");
    assert.equal(badge.hidden, false);
  });

  test("production 빌드 설정에서는 DEV BUILD 배지가 DOM에서 완전히 제거된다", async () => {
    const env = createPopupEnv();
    env.loadPopupScript({ buildConfig: { mode: "production", developerPro: false, debug: false } });
    await wait(20);

    assert.equal(env.document.getElementById("cloakli-dev-badge"), null, "production에서는 배지 요소 자체가 없어야 한다");
  });

  test("storage 값으로는 DEV BUILD 배지를 켤 수 없다 (build-config.js 값만 사용)", async () => {
    const env = createPopupEnv({ chrome: { initialStorage: { cloakliDevBuild: true, mode: "development" } } });
    env.loadPopupScript({ buildConfig: { mode: "production", developerPro: false, debug: false } });
    await wait(20);

    assert.equal(env.document.getElementById("cloakli-dev-badge"), null);
  });
});

describe("popup: 개발 빌드 실패 안내에만 개발 오류 코드가 추가된다", () => {
  test("development 빌드에서 실패하면 개발 오류 코드가 함께 표시된다", async () => {
    const env = createPopupEnv({
      chrome: { sendMessage: (tabId, message, cb) => cb({ ok: false }) },
    });
    env.loadPopupScript({ buildConfig: { mode: "development", developerPro: false, debug: false } });
    await wait(30);

    env.click(env.document.getElementById("cloakli-select-btn"));
    await wait(30);

    assert.match(env.document.getElementById("cloakli-status").textContent, /개발 오류: CONTENT_SCRIPT_UNAVAILABLE/);
  });

  test("production 빌드에서 실패해도 개발 오류 코드나 내부 오류 내용을 노출하지 않는다", async () => {
    const env = createPopupEnv({
      chrome: { sendMessage: (tabId, message, cb) => cb({ ok: false, error: "raw internal detail" }) },
    });
    env.loadPopupScript({ buildConfig: { mode: "production", developerPro: false, debug: false } });
    await wait(30);

    env.click(env.document.getElementById("cloakli-select-btn"));
    await wait(30);

    const msg = env.document.getElementById("cloakli-status").textContent;
    assert.ok(!msg.includes("개발 오류"), "production에서는 개발 오류 코드를 보여주면 안 된다");
    assert.ok(!msg.includes("raw internal detail"), "production에서는 내부 오류 내용을 노출하면 안 된다");
  });
});

describe("popup: build-config.js가 빠져도 조용히 멈추지 않는다", () => {
  test("build-config.js 로드를 건너뛰어도 popup이 예외 없이 로드되고, 선택 버튼 클릭도 정상 동작한다", async () => {
    const env = createPopupEnv();
    assert.doesNotThrow(() => env.loadPopupScript({ skipBuildConfig: true }));
    await wait(30);

    const before = env.chrome.__calls.tabsQuery;
    env.click(env.document.getElementById("cloakli-select-btn"));
    await wait(30);

    assert.ok(env.chrome.__calls.tabsQuery > before, "build-config.js가 없어도 핵심 흐름(탭 조회)은 계속 동작해야 한다");
  });
});

// 라이선스(Pro) 섹션. 세 상태(Free/License Pro/Developer Pro)를 명확히 구분해서 보여줘야 하고,
// 결제 URL은 https만, 라이선스 키는 마지막 4자리만 표시해야 한다.
describe("popup: 라이선스 섹션 - Free 상태", () => {
  test("Free 상태에서는 구매/키 입력 버튼이 보이고, 활성 정보 패널은 숨겨진다", async () => {
    const env = createPopupEnv();
    env.loadPopupScript({ buildConfig: { mode: "development", developerPro: false, debug: false } });
    await wait(30);

    assert.equal(env.document.getElementById("cloakli-license-free-actions").hidden, false);
    assert.equal(env.document.getElementById("cloakli-license-active-info").hidden, true);
  });

  test("'라이선스 키 입력' 버튼을 누르면 입력 폼이 펼쳐진다", async () => {
    const env = createPopupEnv();
    env.loadPopupScript({ buildConfig: { mode: "development", developerPro: false, debug: false } });
    await wait(30);

    const inputArea = env.document.getElementById("cloakli-license-input-area");
    assert.equal(inputArea.hidden, true);
    env.click(env.document.getElementById("cloakli-show-license-input-btn"));
    assert.equal(inputArea.hidden, false);
  });

  test("라이선스 키 입력란은 기본적으로 password로 마스킹되어 있고, 표시 버튼으로 전환할 수 있다", async () => {
    const env = createPopupEnv();
    env.loadPopupScript({ buildConfig: { mode: "development", developerPro: false, debug: false } });
    await wait(30);

    const keyInput = env.document.getElementById("cloakli-license-key-input");
    assert.equal(keyInput.type, "password");
    env.click(env.document.getElementById("cloakli-toggle-license-visibility-btn"));
    assert.equal(keyInput.type, "text");
  });
});

describe("popup: 라이선스 섹션 - 결제 URL 처리", () => {
  test("checkoutUrl이 설정되지 않았으면 '아직 준비되지 않았습니다' 안내만 표시하고 새 탭을 열지 않는다", async () => {
    const env = createPopupEnv();
    env.loadPopupScript({ buildConfig: { mode: "development", developerPro: false, debug: false } });
    await wait(30);

    env.click(env.document.getElementById("cloakli-buy-pro-btn"));
    await wait(10);

    assert.equal(env.chrome.__calls.tabsCreate.length, 0, "URL이 없으면 새 탭을 열면 안 된다");
    assert.match(env.document.getElementById("cloakli-license-message").textContent, /아직 준비되지 않았습니다/);
  });

  test("checkoutUrl이 http(비-https)이면 거부하고 새 탭을 열지 않는다", async () => {
    const env = createPopupEnv();
    env.loadPopupScript({
      buildConfig: { mode: "development", developerPro: false, debug: false, checkoutUrl: "http://example.com/checkout" },
    });
    await wait(30);

    env.click(env.document.getElementById("cloakli-buy-pro-btn"));
    await wait(10);

    assert.equal(env.chrome.__calls.tabsCreate.length, 0, "https가 아닌 URL은 열면 안 된다");
  });

  test("checkoutUrl이 유효한 https URL이면 새 탭으로 연다", async () => {
    const env = createPopupEnv();
    env.loadPopupScript({
      buildConfig: { mode: "development", developerPro: false, debug: false, checkoutUrl: "https://example.com/checkout" },
    });
    await wait(30);

    env.click(env.document.getElementById("cloakli-buy-pro-btn"));
    await wait(10);

    assert.equal(env.chrome.__calls.tabsCreate.length, 1);
    assert.equal(env.chrome.__calls.tabsCreate[0].url, "https://example.com/checkout");
  });
});

describe("popup: 라이선스 섹션 - 활성화/에러/중복 클릭 방지", () => {
  test("라이선스 키를 입력하지 않고 활성화를 누르면 안내만 표시하고 서버를 호출하지 않는다", async () => {
    const env = createPopupEnv();
    env.loadPopupScript({
      buildConfig: {
        mode: "development",
        developerPro: false,
        debug: false,
        licenseServerUrl: "https://cloakli-license.example.workers.dev",
      },
    });
    await wait(30);

    env.click(env.document.getElementById("cloakli-show-license-input-btn"));
    env.click(env.document.getElementById("cloakli-activate-license-btn"));
    await wait(10);

    assert.equal(env.fetchCalls.length, 0);
    assert.match(env.document.getElementById("cloakli-license-message").textContent, /라이선스 키를 입력해 주세요/);
  });

  test("서버가 활성화를 거부하면(유효하지 않은 키) 내부 코드가 아닌 한국어 안내가 표시된다", async () => {
    const env = createPopupEnv({
      fetchImpl: () => Promise.resolve({ status: 400, json: async () => ({ ok: false, error: "invalid_license" }) }),
    });
    env.loadPopupScript({
      buildConfig: {
        mode: "development",
        developerPro: false,
        debug: false,
        licenseServerUrl: "https://cloakli-license.example.workers.dev",
      },
    });
    await wait(30);

    env.click(env.document.getElementById("cloakli-show-license-input-btn"));
    env.document.getElementById("cloakli-license-key-input").value = "BAD-KEY-0000";
    env.click(env.document.getElementById("cloakli-activate-license-btn"));
    await wait(30);

    assert.equal(
      env.document.getElementById("cloakli-license-message").textContent,
      "유효하지 않은 라이선스 키입니다."
    );
    assert.equal(env.document.getElementById("cloakli-license-active-info").hidden, true);
  });

  test("활성화 성공 시 License Pro 상태로 전환되고 라이선스 키는 마지막 4자리만 표시된다", async () => {
    const entitlement = {
      plan: "pro",
      source: "license_server",
      isPro: true,
      status: "active",
      expiresAt: null,
      validatedAt: Date.now(),
      offlineValidUntil: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    const env = createPopupEnv({
      fetchImpl: () =>
        Promise.resolve({ status: 200, json: async () => ({ ok: true, sessionToken: "sess-token-abc", entitlement }) }),
    });
    env.loadPopupScript({
      buildConfig: {
        mode: "development",
        developerPro: false,
        debug: false,
        licenseServerUrl: "https://cloakli-license.example.workers.dev",
      },
    });
    await wait(30);

    env.click(env.document.getElementById("cloakli-show-license-input-btn"));
    env.document.getElementById("cloakli-license-key-input").value = "AAAA-BBBB-CCCC-1234";
    env.click(env.document.getElementById("cloakli-activate-license-btn"));
    await wait(120);

    assert.equal(env.document.getElementById("cloakli-license-active-info").hidden, false);
    assert.equal(env.document.getElementById("cloakli-license-free-actions").hidden, true);
    assert.equal(env.document.getElementById("cloakli-license-masked-key").textContent, "•••• 1234");
    assert.equal(env.document.getElementById("cloakli-license-status-text").textContent, "활성");
    // 원문 키는 입력란에도 더 이상 남아있으면 안 된다.
    assert.equal(env.document.getElementById("cloakli-license-key-input").value, "");
  });

  test("활성화 버튼은 처리 중 중복 클릭을 막는다(같은 요청이 두 번 전송되지 않는다)", async () => {
    let resolveFetch;
    const env = createPopupEnv({
      fetchImpl: () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    });
    env.loadPopupScript({
      buildConfig: {
        mode: "development",
        developerPro: false,
        debug: false,
        licenseServerUrl: "https://cloakli-license.example.workers.dev",
      },
    });
    await wait(30);

    env.click(env.document.getElementById("cloakli-show-license-input-btn"));
    env.document.getElementById("cloakli-license-key-input").value = "AAAA-BBBB-CCCC-1234";
    const activateBtn = env.document.getElementById("cloakli-activate-license-btn");
    env.click(activateBtn);
    await wait(10);
    env.click(activateBtn); // 처리 중 다시 클릭해도 무시되어야 한다
    await wait(10);

    assert.equal(env.fetchCalls.length, 1, "처리 중에는 중복 요청을 보내면 안 된다");

    resolveFetch({ status: 200, json: async () => ({ ok: false, error: "invalid_license" }) });
    await wait(20);
  });
});

describe("popup: 라이선스 섹션 - 다시 확인 / 비활성화", () => {
  function createActivatedEnv(fetchImpl) {
    const entitlement = {
      plan: "pro",
      source: "license_server",
      isPro: true,
      status: "active",
      expiresAt: null,
      validatedAt: Date.now(),
      offlineValidUntil: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    return createPopupEnv({
      chrome: {
        initialStorage: {
          cloakliLicenseSession: { sessionToken: "sess-token-abc", licenseKeyLast4: "1234", activatedAt: Date.now() },
          cloakliLicenseCache: entitlement,
        },
      },
      fetchImpl: fetchImpl,
    });
  }

  test("비활성화 확인 대화상자에서 취소하면 라이선스가 그대로 유지된다", async () => {
    const env = createActivatedEnv(() => Promise.resolve({ status: 200, json: async () => ({ ok: true }) }));
    env.sandbox.confirm = () => false;
    env.loadPopupScript({ buildConfig: { mode: "development", developerPro: false, debug: false } });
    await wait(30);

    env.click(env.document.getElementById("cloakli-deactivate-license-btn"));
    await wait(20);

    assert.equal(env.document.getElementById("cloakli-license-active-info").hidden, false, "취소했으므로 Pro 상태가 유지되어야 한다");
  });

  test("비활성화를 확인하면 Free 상태로 돌아간다", async () => {
    const env = createActivatedEnv(() => Promise.resolve({ status: 200, json: async () => ({ ok: true }) }));
    env.sandbox.confirm = () => true;
    env.loadPopupScript({ buildConfig: { mode: "development", developerPro: false, debug: false } });
    await wait(30);

    env.click(env.document.getElementById("cloakli-deactivate-license-btn"));
    await wait(30);

    assert.equal(env.document.getElementById("cloakli-license-active-info").hidden, true);
    assert.equal(env.document.getElementById("cloakli-license-free-actions").hidden, false);
  });

  test("네트워크 실패 중 '다시 확인'을 눌러도 기존 Pro 상태가 즉시 사라지지 않는다(오프라인 유예)", async () => {
    const env = createActivatedEnv(() => Promise.reject(new Error("network down")));
    env.loadPopupScript({ buildConfig: { mode: "development", developerPro: false, debug: false } });
    await wait(30);

    env.click(env.document.getElementById("cloakli-recheck-license-btn"));
    await wait(30);

    assert.equal(env.document.getElementById("cloakli-license-active-info").hidden, false);
  });
});

describe("popup: 라이선스 섹션 - Developer Pro 상태", () => {
  test("Developer Pro에서는 라이선스 섹션 전체(구매/입력/활성 정보)가 숨겨진다", async () => {
    const env = createPopupEnv();
    env.loadPopupScript({ buildConfig: { mode: "development", developerPro: true, debug: false } });
    await wait(30);

    assert.equal(env.document.getElementById("cloakli-license-free-actions").hidden, true);
    assert.equal(env.document.getElementById("cloakli-license-input-area").hidden, true);
    assert.equal(env.document.getElementById("cloakli-license-active-info").hidden, true);
  });
});
