// 화면 고정 선택 모드(frozen selection) 검증.
//
// Gmail처럼 마우스를 올리면 화면이 바뀌는(날짜가 hover 액션 버튼으로 교체되는) 메일 목록
// fixture를 만들고, 선택 모드 중에는 사이트의 hover 동작이 실행되지 않으면서도 좌표로
// 원래(날짜) 요소를 선택할 수 있는지, 그리고 선택 종료 후 사이트 hover가 정상 복원되는지
// 확인한다. content.js 소스는 한 줄도 바꾸지 않고 fake-browser-env.js 위에서 실행한다.
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createEnv, wait, waitUntil } = require("./helpers/fake-browser-env");

const SHIELD_ID = "cloakli-selection-shield-root";

function isMasked(el) {
  if (!el) return false;
  if (el.classList.contains("cloakli-masked")) return true;
  return !!(el.parentNode && el.parentNode.classList && el.parentNode.classList.contains("cloakli-masked"));
}

function chooseScopeOption(env, index) {
  const root = env.document.getElementById("cloakli-scope-picker-root");
  if (!root) throw new Error("범위 선택 UI가 열려 있지 않습니다");
  const buttons = root.children.filter((c) => c.tagName === "BUTTON" && c.className === "cloakli-scope-picker-option");
  const target = buttons[index];
  if (!target) throw new Error("범위 선택 버튼을 찾지 못했습니다 (index " + index + ")");
  env.dispatch(target, "click");
}

// Gmail 유사 메일 행: mail-row > sender + subject + preview + trailing-area(date-time, hover-actions)
// 실제 사이트처럼 row에 mouseover/mouseout 리스너를 붙여, hover 시 날짜를 숨기고 액션
// 버튼을 보여주는 동작을 재현한다. 좌표 기반 선택을 검증하기 위해 각 요소에 실제 rect를 지정한다.
function buildMailFixture(env, rowCount) {
  const list = env.document.createElement("div");
  list.className = "mail-list";
  list._rect = { top: 0, left: 0, width: 800, height: rowCount * 40 };
  env.document.body.appendChild(list);

  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    const rowTop = i * 40;
    const row = env.document.createElement("div");
    row.className = "mail-row";
    row._rect = { top: rowTop, left: 0, width: 800, height: 36 };

    const sender = env.document.createElement("span");
    sender.className = "sender";
    sender.textContent = "sender " + i;
    sender._rect = { top: rowTop + 8, left: 8, width: 120, height: 16 };

    const subject = env.document.createElement("span");
    subject.className = "subject";
    subject.textContent = "subject " + i;
    subject._rect = { top: rowTop + 8, left: 140, width: 300, height: 16 };

    const preview = env.document.createElement("span");
    preview.className = "preview";
    preview.textContent = "preview " + i;
    preview._rect = { top: rowTop + 8, left: 450, width: 200, height: 16 };

    const trailing = env.document.createElement("div");
    trailing.className = "trailing-area";
    trailing._rect = { top: rowTop, left: 700, width: 100, height: 36 };

    const dateTime = env.document.createElement("span");
    dateTime.className = "date-time";
    dateTime.textContent = "10:2" + i + " AM";
    dateTime._rect = { top: rowTop + 10, left: 710, width: 70, height: 16 };

    const hoverActions = env.document.createElement("div");
    hoverActions.className = "hover-actions";
    hoverActions.style.display = "none";
    hoverActions._rect = { top: rowTop, left: 700, width: 100, height: 36 };

    trailing.appendChild(dateTime);
    trailing.appendChild(hoverActions);
    row.appendChild(sender);
    row.appendChild(subject);
    row.appendChild(preview);
    row.appendChild(trailing);
    list.appendChild(row);

    // 실제 메일 사이트의 hover 동작 재현: 행 위에 마우스가 오면 날짜가 사라지고 액션이 나타난다.
    const hoverState = { fired: 0 };
    row.addEventListener("mouseover", () => {
      hoverState.fired++;
      dateTime.style.display = "none";
      hoverActions.style.display = "block";
    });
    row.addEventListener("mouseout", () => {
      dateTime.style.display = "";
      hoverActions.style.display = "none";
    });

    rows.push({ row, sender, subject, preview, trailing, dateTime, hoverActions, hoverState });
  }
  return { list, rows };
}

describe("화면 고정 선택 모드: 투명 선택 레이어", () => {
  test("선택 모드를 시작하면 투명 선택 레이어와 '화면이 고정되었습니다' 안내가 생기고, 종료하면 제거된다", async () => {
    const env = createEnv("https://mail.example.com/");
    buildMailFixture(env, 3);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    assert.ok(env.document.getElementById(SHIELD_ID), "투명 선택 레이어가 생성되어야 한다");
    const banner = env.document.getElementById("cloakli-selection-banner-root");
    assert.ok(banner, "안내 배너가 있어야 한다");
    assert.match(banner.textContent, /화면이 고정되었습니다/);

    // ESC로 취소하면 레이어가 즉시 제거된다.
    env.dispatch(env.document.body, "keydown", { key: "Escape" });
    assert.equal(env.document.getElementById(SHIELD_ID), null, "취소 시 레이어가 제거되어야 한다");
    assert.equal(env.document.getElementById("cloakli-selection-banner-root"), null);
  });

  test("선택 중 레이어 위 마우스 이동은 사이트 hover를 발생시키지 않고, 원래 요소에 outline만 표시한다", async () => {
    const env = createEnv("https://mail.example.com/");
    const { rows } = buildMailFixture(env, 3);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    const shield = env.document.getElementById(SHIELD_ID);

    // 사용자가 날짜 위치로 마우스를 움직인다 - 실제 이벤트는 전부 레이어가 받는다.
    env.dispatch(shield, "mousemove", { clientX: 715, clientY: 20 });

    assert.equal(rows[0].hoverState.fired, 0, "사이트의 mouseover 리스너가 실행되면 안 된다");
    assert.equal(rows[0].hoverActions.style.display, "none", "hover 액션이 나타나면 안 된다");
    assert.equal(rows[0].dateTime.classList.contains("cloakli-highlight"), true, "좌표 아래 날짜 요소에 outline이 표시되어야 한다");
    // 다른 요소에는 outline이 없다.
    assert.equal(rows[0].row.classList.contains("cloakli-highlight"), false);
    assert.equal(rows[1].dateTime.classList.contains("cloakli-highlight"), false);
  });
});

describe("화면 고정 선택 모드: hover 전 보이던 날짜 선택", () => {
  test("레이어 클릭 좌표로 date-time 요소가 선택되고, '이 요소만'으로 그 날짜 하나만 가릴 수 있다", async () => {
    const env = createEnv("https://mail.example.com/");
    const { rows } = buildMailFixture(env, 10);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    const shield = env.document.getElementById(SHIELD_ID);

    // 첫 행의 날짜 좌표를 클릭한다.
    env.dispatch(shield, "click", { clientX: 715, clientY: 20, button: 0 });

    const picker = env.document.getElementById("cloakli-scope-picker-root");
    assert.ok(picker, "범위 선택 UI가 열려야 한다");
    const targetLine = picker.children.find((c) => c.className === "cloakli-scope-picker-target");
    assert.match(targetLine.textContent, /날짜·시간/, "인식된 대상이 날짜·시간으로 표시되어야 한다");

    const buttons = picker.children.filter((c) => c.tagName === "BUTTON" && c.className === "cloakli-scope-picker-option");
    assert.ok(!buttons[0].disabled, "'이 요소만' 버튼이 활성화되어야 한다");

    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("mail.example.com").length === 1);
    await waitUntil(() => isMasked(rows[0].dateTime));

    const saved = env.getStoredRules("mail.example.com")[0];
    assert.equal(saved.role, "date-time");
    assert.equal(saved.family, "mail-list-row");
    assert.ok(!/10:2|AM/.test(saved.selector), "selector에 실제 날짜 텍스트가 들어가면 안 된다");

    rows.forEach((r, i) => {
      assert.equal(isMasked(r.dateTime), i === 0, `행 ${i}의 날짜 가림 상태가 예상과 다르다`);
      assert.equal(isMasked(r.row), false, "행 전체가 가려지면 안 된다");
      assert.equal(isMasked(r.hoverActions), false, "hover 액션 영역이 가려지면 안 된다");
    });

    // 선택 완료 시 레이어는 이미 제거되어 있어야 한다.
    assert.equal(env.document.getElementById(SHIELD_ID), null);
  });

  test("date-time의 site 범위는 같은 family의 날짜만 가리고, 발신자/제목은 가리지 않는다", async () => {
    const env = createEnv("https://mail.example.com/");
    const { rows } = buildMailFixture(env, 10);
    env.loadContentScript({ entitlementOverride: { plan: "pro", source: "developer", isPro: true } });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    const shield = env.document.getElementById(SHIELD_ID);
    env.dispatch(shield, "click", { clientX: 715, clientY: 20, button: 0 });
    chooseScopeOption(env, 2); // 이 사이트의 같은 요소
    await waitUntil(() => env.getStoredRules("mail.example.com").length === 1);
    await waitUntil(() => rows.every((r) => isMasked(r.dateTime)));

    rows.forEach((r, i) => {
      assert.equal(isMasked(r.dateTime), true, `행 ${i}의 날짜가 가려져야 한다`);
      assert.equal(isMasked(r.sender), false, `행 ${i}의 발신자는 가려지면 안 된다`);
      assert.equal(isMasked(r.subject), false, `행 ${i}의 제목은 가려지면 안 된다`);
    });
  });

  test("선택 종료 후에는 사이트의 hover 동작이 정상 복원된다", async () => {
    const env = createEnv("https://mail.example.com/");
    const { rows } = buildMailFixture(env, 3);
    env.loadContentScript();
    await wait(20);

    // 선택 모드를 시작했다가 ESC로 취소한다.
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(env.document.body, "keydown", { key: "Escape" });
    assert.equal(env.document.getElementById(SHIELD_ID), null);

    // 이제 행에 직접 mouseover하면 사이트 자신의 hover 동작이 정상 실행되어야 한다.
    env.dispatch(rows[1].row, "mouseover");
    assert.equal(rows[1].hoverState.fired, 1, "선택 종료 후 사이트 hover 리스너가 정상 실행되어야 한다");
    assert.equal(rows[1].hoverActions.style.display, "block");
    env.dispatch(rows[1].row, "mouseout");
    assert.equal(rows[1].hoverActions.style.display, "none");
  });

  test("스크롤로 화면이 바뀌면 스냅샷을 다시 찍어 새 좌표로 선택할 수 있다", async () => {
    const env = createEnv("https://mail.example.com/");
    const { rows } = buildMailFixture(env, 5);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });

    // 스크롤 발생: 모든 rect가 위로 40px 이동했다고 가정하고 rect를 갱신한 뒤 scroll 이벤트를 낸다.
    rows.forEach((r) => {
      [r.row, r.sender, r.subject, r.preview, r.trailing, r.dateTime, r.hoverActions].forEach((el) => {
        if (el._rect) el._rect = Object.assign({}, el._rect, { top: el._rect.top - 40 });
      });
    });
    env.triggerWindowEvent("scroll");
    await wait(250); // 재캡처 debounce(150ms) 대기

    // 원래 두 번째 행의 날짜가 있던 화면 위치(이동 후 첫 번째 화면 위치)를 클릭한다.
    const shield = env.document.getElementById(SHIELD_ID);
    env.dispatch(shield, "click", { clientX: 715, clientY: 20, button: 0 });

    const picker = env.document.getElementById("cloakli-scope-picker-root");
    assert.ok(picker, "범위 선택 UI가 열려야 한다");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("mail.example.com").length === 1);
    await waitUntil(() => isMasked(rows[1].dateTime));

    assert.equal(isMasked(rows[1].dateTime), true, "스크롤 후 좌표에 있던(두 번째 행) 날짜가 선택되어야 한다");
    assert.equal(isMasked(rows[0].dateTime), false);
  });
});

describe("화면 고정 선택 모드: 스냅샷 개인정보/정리", () => {
  test("선택이 끝난 뒤 storage에는 가림 규칙 외 스냅샷 관련 데이터가 전혀 없다", async () => {
    const env = createEnv("https://mail.example.com/");
    buildMailFixture(env, 5);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    const shield = env.document.getElementById(SHIELD_ID);
    env.dispatch(shield, "click", { clientX: 715, clientY: 20, button: 0 });
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("mail.example.com").length === 1);

    const storedKeys = Object.keys(env.chrome.storage.__data);
    assert.deepEqual(storedKeys.sort(), ["cloakliRules"], "가림 규칙 외에는 아무 것도 저장되면 안 된다");

    // 저장된 규칙에도 실제 텍스트(발신자/제목/날짜 값)가 없어야 한다.
    const serialized = JSON.stringify(env.chrome.storage.__data);
    assert.ok(!/sender \d|subject \d|10:2\d/.test(serialized), "규칙에 실제 텍스트가 저장되면 안 된다");
  });

  test("선택 모드 준비 중 오류가 나도(cleanup) 임시 레이어가 남지 않는다", async () => {
    const env = createEnv("https://mail.example.com/");
    buildMailFixture(env, 3);
    env.loadContentScript();
    await wait(20);

    // body가 없는 극단적 상황에서 startSelectionMode가 예외를 만나도 레이어/배너가 남으면 안 된다.
    const realBody = env.document.body;
    env.document.body = null;
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.document.body = realBody;

    assert.equal(env.document.getElementById(SHIELD_ID), null, "오류 시에도 레이어가 정리되어야 한다");
  });
});
