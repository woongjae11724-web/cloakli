"use strict";

// 팝업의 "키보드 단축키" 상시 노출 카드 검증.
//
// 이전 버전은 "키보드 단축키" 링크를 눌러야만 펼쳐지는 접힘 패널이었다(사용자가 기능의
// 존재 자체를 모르는 문제가 있었음). 지금은 팝업을 여는 즉시 클릭 없이 카드와 실제
// 단축키 값이 보여야 한다 — 이 파일의 모든 테스트는 별도 클릭 없이 검증한다.
//
// chrome.commands.getAll()로 실제 현재 단축키를 조회하므로, manifest의
// suggested_key(기본 제안값)가 아니라 조회 결과를 그대로 신뢰하는지가 핵심이다.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createPopupEnv } = require("./helpers/fake-popup-env.js");
const { createRealI18nMock } = require("./helpers/real-i18n-mock.js");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BOTH_SET = [
  { name: "start-selection", description: "가릴 영역 선택 시작", shortcut: "Ctrl+Shift+H" },
  { name: "temporarily-clear-page", description: "현재 화면 가림 잠시 해제", shortcut: "Ctrl+Shift+U" },
];
const ONE_SET = [
  { name: "start-selection", description: "가릴 영역 선택 시작", shortcut: "Ctrl+Shift+H" },
  { name: "temporarily-clear-page", description: "현재 화면 가림 잠시 해제", shortcut: "" },
];
const NONE_SET = [
  { name: "start-selection", description: "가릴 영역 선택 시작", shortcut: "" },
  { name: "temporarily-clear-page", description: "현재 화면 가림 잠시 해제", shortcut: "" },
];

function rowsText(env) {
  const list = env.document.getElementById("cloakli-shortcuts-list");
  return list.children.map((li) => ({
    name: li.children[0].textContent,
    key: li.children[1].textContent,
    unset: li.children[1].className.includes("cloakli-shortcuts-key-unset"),
  }));
}

function isAttentionOn(env) {
  return env.document
    .getElementById("cloakli-shortcuts-configure-btn")
    .className.includes("cloakli-shortcuts-configure-btn-attention");
}

describe("popup: 키보드 단축키 카드 - 팝업을 열자마자(클릭 없이) 보인다", () => {
  test("카드 section에 hidden이 없다 (더 이상 접혀 있지 않다)", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET } });
    env.loadPopupScript();
    await wait(30);

    assert.equal(env.document.getElementById("cloakli-shortcuts-section").hidden, false);
  });

  test("클릭 없이 단축키 값이 바로 채워진다", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET } });
    env.loadPopupScript();
    await wait(30); // 클릭 없음 — 초기화 호출만 기다린다

    const rows = rowsText(env);
    assert.equal(rows.length, 2, "클릭 없이도 목록이 채워져야 한다");
    assert.deepStrictEqual(rows[0], { name: "요소 선택 시작", key: "Ctrl+Shift+H", unset: false });
    assert.deepStrictEqual(rows[1], { name: "이 페이지 임시 복원", key: "Ctrl+Shift+U", unset: false });
  });

  test("더 이상 펼치는 버튼(cloakli-shortcuts-btn)이 존재하지 않는다", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET } });
    env.loadPopupScript();
    await wait(30);

    assert.equal(env.document.getElementById("cloakli-shortcuts-btn"), null);
  });
});

describe("popup: 키보드 단축키 카드 - 설정 상태별 표시", () => {
  test("2개 모두 설정된 경우: 실제 키 조합이 표시되고 설정 버튼은 강조되지 않는다", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET } });
    env.loadPopupScript();
    await wait(30);

    const rows = rowsText(env);
    assert.deepStrictEqual(rows[0], { name: "요소 선택 시작", key: "Ctrl+Shift+H", unset: false });
    assert.deepStrictEqual(rows[1], { name: "이 페이지 임시 복원", key: "Ctrl+Shift+U", unset: false });
    assert.equal(isAttentionOn(env), false, "둘 다 설정돼 있으면 강조하면 안 된다");
  });

  test("하나만 설정된 경우: 나머지는 '설정되지 않음'으로 표시되고 설정 버튼이 강조된다", async () => {
    const env = createPopupEnv({ chrome: { commands: ONE_SET } });
    env.loadPopupScript();
    await wait(30);

    const rows = rowsText(env);
    assert.deepStrictEqual(rows[0], { name: "요소 선택 시작", key: "Ctrl+Shift+H", unset: false });
    assert.deepStrictEqual(rows[1], { name: "이 페이지 임시 복원", key: "설정되지 않음", unset: true });
    assert.equal(isAttentionOn(env), true, "하나라도 비어 있으면 설정 버튼이 강조되어야 한다");
  });

  test("둘 다 비어 있는 경우: 두 항목 모두 '설정되지 않음'이고 설정 버튼이 강조된다", async () => {
    const env = createPopupEnv({ chrome: { commands: NONE_SET } });
    env.loadPopupScript();
    await wait(30);

    const rows = rowsText(env);
    assert.deepStrictEqual(rows[0], { name: "요소 선택 시작", key: "설정되지 않음", unset: true });
    assert.deepStrictEqual(rows[1], { name: "이 페이지 임시 복원", key: "설정되지 않음", unset: true });
    assert.equal(isAttentionOn(env), true);
  });

  test("chrome.commands.getAll() 호출 자체가 실패하면(lastError) 안내 문구로 안전하게 대체되고, 강조 상태는 켜지지 않는다", async () => {
    const env = createPopupEnv({ chrome: { commandsFail: true } });
    env.loadPopupScript();
    await wait(30);

    assert.equal(rowsText(env).length, 0, "실패 시 목록은 비어 있어야 한다");
    const messageEl = env.document.getElementById("cloakli-shortcuts-message");
    assert.equal(messageEl.hidden, false);
    assert.match(messageEl.textContent, /불러오지 못했습니다/);
    assert.equal(isAttentionOn(env), false, "조회 실패로 설정 여부를 모르므로 임의로 강조하면 안 된다");
  });

  test("chrome.commands API 자체가 없는 환경(구형 Chrome 등)에서도 안전하게 안내 문구로 대체된다", async () => {
    // opts.chrome에 commands를 아예 주지 않으면 mock에도 chrome.commands가 없다(기본값).
    const env = createPopupEnv({});
    env.loadPopupScript();
    await wait(30);

    assert.equal(rowsText(env).length, 0);
    const messageEl = env.document.getElementById("cloakli-shortcuts-message");
    assert.equal(messageEl.hidden, false);
    assert.match(messageEl.textContent, /불러오지 못했습니다/);
    assert.equal(isAttentionOn(env), false);
  });
});

describe("popup: 키보드 단축키 카드 - 로케일 렌더링", () => {
  test("영어 로케일에서는 이름/상태/버튼 문구가 영어로 표시된다", async () => {
    const env = createPopupEnv({ chrome: { commands: ONE_SET, i18n: createRealI18nMock("en") } });
    env.loadPopupScript();
    await wait(30);

    const rows = rowsText(env);
    assert.equal(rows[0].name, "Start selecting an element");
    assert.equal(rows[1].name, "Temporarily restore this page");
    assert.equal(rows[1].key, "Not set");
    assert.equal(env.document.getElementById("cloakli-shortcuts-heading").textContent, "Keyboard shortcuts");
    assert.equal(env.document.getElementById("cloakli-shortcuts-configure-btn").textContent, "Manage shortcuts");
  });

  test("한국어 로케일에서는 이름/상태/버튼 문구가 한국어로 표시된다", async () => {
    const env = createPopupEnv({ chrome: { commands: ONE_SET, i18n: createRealI18nMock("ko") } });
    env.loadPopupScript();
    await wait(30);

    const rows = rowsText(env);
    assert.equal(rows[0].name, "요소 선택 시작");
    assert.equal(rows[1].name, "이 페이지 임시 복원");
    assert.equal(rows[1].key, "설정되지 않음");
    assert.equal(env.document.getElementById("cloakli-shortcuts-heading").textContent, "키보드 단축키");
  });
});

describe("popup: 키보드 단축키 카드 - '단축키 설정' 버튼", () => {
  test("chrome://extensions/shortcuts 열기에 성공하면 대체 안내(주소 복사)는 보이지 않는다", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET } });
    env.loadPopupScript();
    await wait(30);

    env.click(env.document.getElementById("cloakli-shortcuts-configure-btn"));
    await wait(30);

    const lastCreate = env.chrome.__calls.tabsCreate[env.chrome.__calls.tabsCreate.length - 1];
    assert.equal(lastCreate.url, "chrome://extensions/shortcuts");
    assert.equal(env.document.getElementById("cloakli-shortcuts-fallback").hidden, true);
  });

  test("chrome://extensions/shortcuts 열기가 실패하면(내부 페이지 거부 등) 주소 복사 대체 안내가 나타난다", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET, tabsCreateFails: true } });
    env.loadPopupScript();
    await wait(30);

    env.click(env.document.getElementById("cloakli-shortcuts-configure-btn"));
    await wait(30);

    assert.equal(env.document.getElementById("cloakli-shortcuts-fallback").hidden, false, "실패 시 대체 안내가 보여야 한다");
    assert.equal(
      env.document.getElementById("cloakli-shortcuts-url-input").value,
      "chrome://extensions/shortcuts",
      "주소가 그대로 노출되어 사용자가 복사할 수 있어야 한다"
    );
  });

  test("설정 버튼은 처리 중 중복 클릭을 막고, 끝나면 다시 활성화된다", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET } });
    env.loadPopupScript();
    await wait(30);

    const btn = env.document.getElementById("cloakli-shortcuts-configure-btn");
    env.click(btn);
    assert.equal(btn.disabled, true, "처리 중에는 비활성화되어야 한다");
    await wait(50);
    assert.equal(btn.disabled, false, "완료 후 다시 활성화되어야 한다");
  });

  test("둘 다 설정돼 있어도 설정 버튼은 눌러서 chrome://extensions/shortcuts를 열 수 있다(작게 유지되지만 비활성화는 아니다)", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET } });
    env.loadPopupScript();
    await wait(30);

    assert.equal(isAttentionOn(env), false, "강조는 꺼져 있어야 한다");
    const btn = env.document.getElementById("cloakli-shortcuts-configure-btn");
    assert.ok(!btn.disabled, "둘 다 설정돼 있어도 버튼 자체는 눌러 변경할 수 있어야 한다");

    env.click(btn);
    await wait(30);
    const lastCreate = env.chrome.__calls.tabsCreate[env.chrome.__calls.tabsCreate.length - 1];
    assert.equal(lastCreate.url, "chrome://extensions/shortcuts");
  });

  test("복사 버튼: clipboard API 성공 시 '복사되었습니다' 상태 문구가 표시된다", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET, tabsCreateFails: true } });
    env.sandbox.navigator = { clipboard: { writeText: () => Promise.resolve() } };
    env.loadPopupScript();
    await wait(30);
    env.click(env.document.getElementById("cloakli-shortcuts-configure-btn"));
    await wait(30);

    env.click(env.document.getElementById("cloakli-shortcuts-copy-btn"));
    await wait(30);

    assert.match(env.document.getElementById("cloakli-shortcuts-copy-status").textContent, /복사되었습니다/);
  });

  test("복사 버튼: clipboard API가 없거나 실패하면 실패 안내로 대체된다", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET, tabsCreateFails: true } });
    // navigator를 아예 주지 않음(clipboard API 없는 환경 시뮬레이션)
    env.loadPopupScript();
    await wait(30);
    env.click(env.document.getElementById("cloakli-shortcuts-configure-btn"));
    await wait(30);

    env.click(env.document.getElementById("cloakli-shortcuts-copy-btn"));
    await wait(10);

    assert.match(env.document.getElementById("cloakli-shortcuts-copy-status").textContent, /복사하지 못했습니다/);
  });
});

describe("popup: 키보드 단축키 카드가 기존 기능에 영향을 주지 않는다", () => {
  test("카드가 항상 보여도 요소 선택/라이선스/상태 표시는 그대로 동작한다", async () => {
    const env = createPopupEnv({
      chrome: { commands: BOTH_SET, activeTab: { id: 42, url: "https://example.com/" } },
    });
    env.loadPopupScript();
    await wait(150);

    assert.equal(env.document.getElementById("cloakli-status-hostname").textContent, "현재 사이트: example.com");

    env.click(env.document.getElementById("cloakli-select-btn"));
    await wait(150);
    const lastMessage = env.chrome.__calls.sendMessage[env.chrome.__calls.sendMessage.length - 1];
    assert.equal(lastMessage.message.type, "START_SELECTION_MODE");
  });
});
