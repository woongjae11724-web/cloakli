"use strict";

// 팝업의 "키보드 단축키" 섹션 검증.
//
// chrome.commands.getAll()로 실제 현재 단축키를 조회해 보여주므로, manifest의
// suggested_key(기본 제안값)가 아니라 chrome.commands.getAll()이 돌려주는 값을 그대로
// 신뢰하는지가 핵심이다 — 사용자가 직접 재배정했거나 지운 경우까지 정확히 반영해야 한다.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createPopupEnv } = require("./helpers/fake-popup-env.js");

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

function openShortcuts(env) {
  env.click(env.document.getElementById("cloakli-shortcuts-btn"));
}

function rowsText(env) {
  const list = env.document.getElementById("cloakli-shortcuts-list");
  return list.children.map((li) => ({
    name: li.children[0].textContent,
    key: li.children[1].textContent,
    unset: li.children[1].className.includes("cloakli-shortcuts-key-unset"),
  }));
}

describe("popup: 키보드 단축키 섹션 - 조회/표시", () => {
  test("버튼을 누르기 전에는 섹션이 숨겨져 있고, 누르면 펼쳐진다(다시 누르면 접힌다)", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET } });
    env.loadPopupScript();
    await wait(30);

    const section = env.document.getElementById("cloakli-shortcuts-section");
    assert.equal(section.hidden, true, "기본 상태는 접혀 있어야 한다");

    openShortcuts(env);
    await wait(30);
    assert.equal(section.hidden, false, "클릭하면 펼쳐져야 한다");

    openShortcuts(env);
    assert.equal(section.hidden, true, "다시 클릭하면 접혀야 한다");
  });

  test("단축키 2개 모두 설정된 경우: 실제 키 조합이 그대로 표시된다", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET } });
    env.loadPopupScript();
    await wait(30);
    openShortcuts(env);
    await wait(30);

    const rows = rowsText(env);
    assert.equal(rows.length, 2);
    assert.deepStrictEqual(rows[0], { name: "요소 선택 시작", key: "Ctrl+Shift+H", unset: false });
    assert.deepStrictEqual(rows[1], { name: "이 페이지 임시 복원", key: "Ctrl+Shift+U", unset: false });
  });

  test("하나만 설정된 경우: 설정된 것은 키 조합, 나머지는 '설정되지 않음'으로 표시된다", async () => {
    const env = createPopupEnv({ chrome: { commands: ONE_SET } });
    env.loadPopupScript();
    await wait(30);
    openShortcuts(env);
    await wait(30);

    const rows = rowsText(env);
    assert.deepStrictEqual(rows[0], { name: "요소 선택 시작", key: "Ctrl+Shift+H", unset: false });
    assert.deepStrictEqual(rows[1], { name: "이 페이지 임시 복원", key: "설정되지 않음", unset: true });
  });

  test("둘 다 비어 있는 경우: 두 항목 모두 '설정되지 않음'으로 표시된다", async () => {
    const env = createPopupEnv({ chrome: { commands: NONE_SET } });
    env.loadPopupScript();
    await wait(30);
    openShortcuts(env);
    await wait(30);

    const rows = rowsText(env);
    assert.deepStrictEqual(rows[0], { name: "요소 선택 시작", key: "설정되지 않음", unset: true });
    assert.deepStrictEqual(rows[1], { name: "이 페이지 임시 복원", key: "설정되지 않음", unset: true });
  });

  test("여러 번 펼쳐도 목록이 중복 누적되지 않는다(다시 그릴 때마다 비운다)", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET } });
    env.loadPopupScript();
    await wait(30);
    openShortcuts(env); // 펼침
    await wait(30);
    openShortcuts(env); // 접힘
    openShortcuts(env); // 다시 펼침 -> renderShortcuts 재실행
    await wait(30);

    assert.equal(rowsText(env).length, 2, "다시 열어도 항목이 2개여야 한다(누적 금지)");
  });

  test("chrome.commands.getAll() 호출 자체가 실패하면(lastError) 안내 문구로 안전하게 대체된다", async () => {
    const env = createPopupEnv({ chrome: { commandsFail: true } });
    env.loadPopupScript();
    await wait(30);
    openShortcuts(env);
    await wait(30);

    assert.equal(rowsText(env).length, 0, "실패 시 목록은 비어 있어야 한다");
    const messageEl = env.document.getElementById("cloakli-shortcuts-message");
    assert.equal(messageEl.hidden, false);
    assert.match(messageEl.textContent, /불러오지 못했습니다/);
  });

  test("chrome.commands API 자체가 없는 환경(구형 Chrome 등)에서도 안전하게 안내 문구로 대체된다", async () => {
    // opts.chrome에 commands를 아예 주지 않으면 mock에도 chrome.commands가 없다(기본값).
    const env = createPopupEnv({});
    env.loadPopupScript();
    await wait(30);
    openShortcuts(env);
    await wait(30);

    assert.equal(rowsText(env).length, 0);
    const messageEl = env.document.getElementById("cloakli-shortcuts-message");
    assert.equal(messageEl.hidden, false);
    assert.match(messageEl.textContent, /불러오지 못했습니다/);
  });

  test("영어 로케일에서는 이름/상태 문구가 영어로 표시된다", async () => {
    const { createRealI18nMock } = require("./helpers/real-i18n-mock.js");
    const env = createPopupEnv({ chrome: { commands: ONE_SET, i18n: createRealI18nMock("en") } });
    env.loadPopupScript();
    await wait(30);
    openShortcuts(env);
    await wait(30);

    const rows = rowsText(env);
    assert.equal(rows[0].name, "Start selecting an element");
    assert.equal(rows[1].name, "Temporarily restore this page");
    assert.equal(rows[1].key, "Not set");
    assert.equal(env.document.getElementById("cloakli-shortcuts-btn").textContent, "Keyboard shortcuts");
  });

  test("한국어 로케일에서는 이름/상태 문구가 한국어로 표시된다", async () => {
    const { createRealI18nMock } = require("./helpers/real-i18n-mock.js");
    const env = createPopupEnv({ chrome: { commands: ONE_SET, i18n: createRealI18nMock("ko") } });
    env.loadPopupScript();
    await wait(30);
    openShortcuts(env);
    await wait(30);

    const rows = rowsText(env);
    assert.equal(rows[0].name, "요소 선택 시작");
    assert.equal(rows[1].name, "이 페이지 임시 복원");
    assert.equal(rows[1].key, "설정되지 않음");
  });
});

describe("popup: 키보드 단축키 섹션 - '단축키 설정' 버튼", () => {
  test("chrome://extensions/shortcuts 열기에 성공하면 대체 안내(주소 복사)는 보이지 않는다", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET } });
    env.loadPopupScript();
    await wait(30);
    openShortcuts(env);
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
    openShortcuts(env);
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
    openShortcuts(env);
    await wait(30);

    const btn = env.document.getElementById("cloakli-shortcuts-configure-btn");
    env.click(btn);
    assert.equal(btn.disabled, true, "처리 중에는 비활성화되어야 한다");
    await wait(50);
    assert.equal(btn.disabled, false, "완료 후 다시 활성화되어야 한다");
  });

  test("복사 버튼: clipboard API 성공 시 '복사되었습니다' 상태 문구가 표시된다", async () => {
    const env = createPopupEnv({ chrome: { commands: BOTH_SET, tabsCreateFails: true } });
    env.sandbox.navigator = { clipboard: { writeText: () => Promise.resolve() } };
    env.loadPopupScript();
    await wait(30);
    openShortcuts(env);
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
    openShortcuts(env);
    await wait(30);
    env.click(env.document.getElementById("cloakli-shortcuts-configure-btn"));
    await wait(30);

    env.click(env.document.getElementById("cloakli-shortcuts-copy-btn"));
    await wait(10);

    assert.match(env.document.getElementById("cloakli-shortcuts-copy-status").textContent, /복사하지 못했습니다/);
  });
});

describe("popup: 키보드 단축키 섹션이 기존 기능에 영향을 주지 않는다", () => {
  test("단축키 섹션을 여닫아도 요소 선택/라이선스/상태 표시는 그대로 동작한다", async () => {
    const env = createPopupEnv({
      chrome: { commands: BOTH_SET, activeTab: { id: 42, url: "https://example.com/" } },
    });
    env.loadPopupScript();
    await wait(150);

    openShortcuts(env);
    await wait(30);
    openShortcuts(env);

    assert.equal(env.document.getElementById("cloakli-status-hostname").textContent, "현재 사이트: example.com");

    env.click(env.document.getElementById("cloakli-select-btn"));
    await wait(150);
    const lastMessage = env.chrome.__calls.sendMessage[env.chrome.__calls.sendMessage.length - 1];
    assert.equal(lastMessage.message.type, "START_SELECTION_MODE");
  });
});
