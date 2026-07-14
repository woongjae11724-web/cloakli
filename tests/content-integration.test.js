// content.js(실제 제품 코드)를 손대지 않고, 최소 가짜 브라우저 환경(tests/helpers) 위에서
// 그대로 실행해 MutationObserver/URL 감지/storage 동기화/선택 모드 동작을 검증한다.
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createEnv, wait, waitUntil, FakeMutationObserver } = require("./helpers/fake-browser-env");

// 실제 코드의 debounce 대기 시간(300ms)보다 넉넉히 기다린다.
const DEBOUNCE_WAIT = 650;

// 요소를 클릭하면 이제 즉시 저장되지 않고 범위 선택 UI(cloakli-scope-picker-root)가 뜬다.
// 테스트에서 "이 요소만/페이지/사이트" 버튼 중 하나를 고르는 데 사용한다.
// index: 0="이 요소만", 1="현재 페이지의 같은 종류 모두", 2="이 사이트의 같은 종류 모두"
function chooseScopeOption(env, index) {
  const root = env.document.getElementById("cloakli-scope-picker-root");
  if (!root) throw new Error("범위 선택 UI가 열려 있지 않습니다");
  const buttons = root.children.filter((c) => c.tagName === "BUTTON" && c.className === "cloakli-scope-picker-option");
  const target = buttons[index];
  if (!target) throw new Error("범위 선택 버튼을 찾지 못했습니다 (index " + index + ")");
  env.dispatch(target, "click");
}

// content.js의 applyStoredRules는 IIFE 내부 지역 함수라 밖에서 직접 스파이할 수 없으므로,
// 매번 그 함수가 호출할 때마다 거치는 chrome.storage.local.get 호출 횟수로 대신 센다.
function instrumentStorageGetCalls(env) {
  let count = 0;
  const original = env.chrome.storage.local.get;
  env.chrome.storage.local.get = function (...args) {
    count++;
    return original.apply(this, args);
  };
  return () => count;
}

describe("초기 로딩 시 저장 규칙 적용", () => {
  test("페이지 로딩 시 저장된 selector와 일치하는 요소가 즉시 가려진다", async () => {
    const env = createEnv("https://example.com/");
    env.seedRules("example.com", [{ id: "r1", hostname: "example.com", selector: "#title", mode: "block", createdAt: 1 }]);
    const el = env.document.createElement("h1");
    el.id = "title";
    env.document.body.appendChild(el);

    env.loadContentScript();
    await wait(50);

    assert.equal(el.classList.contains("cloakli-masked"), true);
    const overlay = el.childNodes.find((c) => c.classList && c.classList.contains("cloakli-mask-overlay"));
    assert.ok(overlay, "가림 레이어가 생성되어야 한다");
  });

  test("저장 규칙이 없으면 아무것도 가려지지 않는다", async () => {
    const env = createEnv("https://example.com/");
    const el = env.document.createElement("div");
    el.id = "not-a-rule";
    env.document.body.appendChild(el);

    env.loadContentScript();
    await wait(50);

    assert.equal(el.classList.contains("cloakli-masked"), false);
  });
});

describe("MutationObserver: 늦게 나타나는 요소 / 무한 스크롤", () => {
  test("초기 로딩 이후 새로 추가된 요소도 debounce 후 자동으로 가려진다", async () => {
    const env = createEnv("https://example.com/");
    env.seedRules("example.com", [{ id: "r1", hostname: "example.com", selector: ".card", mode: "block", createdAt: 1 }]);
    env.loadContentScript();
    await wait(50);

    const lateEl = env.document.createElement("div");
    lateEl.className = "card";
    env.document.body.appendChild(lateEl);
    env.flushMutations();

    assert.equal(lateEl.classList.contains("cloakli-masked"), false, "debounce 시간 전에는 아직 가려지지 않아야 한다");
    await wait(DEBOUNCE_WAIT);
    assert.equal(lateEl.classList.contains("cloakli-masked"), true);
  });

  test("무한 스크롤처럼 같은 class를 가진 요소가 여러 개 추가되어도 각각 가려지고 중복 레이어는 없다", async () => {
    const env = createEnv("https://example.com/");
    // scope:"site"는 selector가 매번 여러 요소와 일치하는 것이 의도된 동작이다(무한 스크롤로
    // 새 카드가 계속 추가되어도 전부 가려져야 한다). "element" 범위는 이제 selector가 정확히
    // 하나만 찾을 때만 적용되므로(다른 카드까지 함께 가려지는 것을 막기 위함), 이 시나리오에는
    // 맞지 않는다.
    env.seedRules("example.com", [{ id: "r1", hostname: "example.com", scope: "site", selector: ".card", mode: "block", createdAt: 1 }]);
    env.loadContentScript();
    await wait(50);

    const cards = [];
    for (let i = 0; i < 5; i++) {
      const c = env.document.createElement("div");
      c.className = "card";
      env.document.body.appendChild(c);
      cards.push(c);
    }
    env.flushMutations();
    await wait(DEBOUNCE_WAIT);

    cards.forEach((c) => {
      assert.equal(c.classList.contains("cloakli-masked"), true);
      const overlays = c.childNodes.filter((n) => n.classList && n.classList.contains("cloakli-mask-overlay"));
      assert.equal(overlays.length, 1, "카드마다 오버레이는 정확히 1개여야 한다");
    });
  });

  test("여러 mutation이 짧은 시간에 발생해도 debounce로 한 번만 처리된다", async () => {
    const env = createEnv("https://example.com/");
    env.seedRules("example.com", [{ id: "r1", hostname: "example.com", selector: ".card", mode: "block", createdAt: 1 }]);
    env.loadContentScript();
    await wait(50);

    const getApplyCount = instrumentStorageGetCalls(env);

    for (let i = 0; i < 10; i++) {
      const c = env.document.createElement("div");
      c.className = "card";
      env.document.body.appendChild(c);
      env.flushMutations();
      await wait(20); // 300ms debounce보다 훨씬 짧은 간격으로 계속 mutation 발생
    }

    await wait(DEBOUNCE_WAIT);
    assert.ok(getApplyCount() <= 2, `debounce가 적용되어 재적용 횟수가 적어야 한다 (실제: ${getApplyCount()}회)`);
  });

  test("Cloakli 자신이 만든 가림 레이어/안내 UI로 인한 변경은 재적용을 다시 트리거하지 않는다", async () => {
    const env = createEnv("https://example.com/");
    // 저장 규칙을 1개 두어(다른 selector) ruleCountCache > 0이 되게 하고,
    // observer가 실제로 "Cloakli 자신의 변경인지" 판별하는 경로까지 타도록 만든다.
    env.seedRules("example.com", [{ id: "r1", hostname: "example.com", selector: "#unrelated", mode: "block", createdAt: 1 }]);
    env.loadContentScript();
    await wait(50);

    const getApplyCount = instrumentStorageGetCalls(env);

    const target = env.document.createElement("div");
    env.document.body.appendChild(target); // 웹사이트 자체 변경 -> 여기서 재적용이 1번 예약된다.
    env.flushMutations();
    await wait(DEBOUNCE_WAIT);
    const countAfterSiteChange = getApplyCount();
    assert.ok(countAfterSiteChange >= 1, "사이트 자체 DOM 변경에는 재적용이 예약되어야 한다");

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(target, "mouseover");
    env.dispatch(target, "click"); // maskElement가 오버레이/클래스를 추가 -> Cloakli 자신의 변경
    env.flushMutations();
    await wait(DEBOUNCE_WAIT);

    assert.equal(
      getApplyCount(),
      countAfterSiteChange,
      "Cloakli 자신이 만든 오버레이 삽입만으로는 재적용이 추가로 실행되면 안 된다"
    );
  });
});

describe("SPA URL 변경 감지 (pushState/replaceState/popstate/hashchange)", () => {
  test("history.pushState로 이동하면 새 화면의 저장 규칙이 재적용된다", async () => {
    const env = createEnv("https://spa.example.com/list");
    env.seedRules("spa.example.com", [
      { id: "r1", hostname: "spa.example.com", selector: "#detail-title", mode: "block", createdAt: 1 },
    ]);
    env.loadContentScript();
    await wait(50);

    env.sandbox.history.pushState({}, "", "/detail/1");
    const detailTitle = env.document.createElement("h1");
    detailTitle.id = "detail-title";
    env.document.body.appendChild(detailTitle);

    await wait(DEBOUNCE_WAIT);
    assert.equal(detailTitle.classList.contains("cloakli-masked"), true);
    assert.equal(env.sandbox.location.href, "https://spa.example.com/detail/1");
  });

  test("history.replaceState도 URL 변경으로 감지된다", async () => {
    const env = createEnv("https://spa.example.com/list");
    env.seedRules("spa.example.com", [{ id: "r1", hostname: "spa.example.com", selector: "#x", mode: "block", createdAt: 1 }]);
    env.loadContentScript();
    await wait(50);

    env.sandbox.history.replaceState({}, "", "/list?query=abc");
    const el = env.document.createElement("div");
    el.id = "x";
    env.document.body.appendChild(el);
    await wait(DEBOUNCE_WAIT);

    assert.equal(el.classList.contains("cloakli-masked"), true);
  });

  test("popstate(뒤로가기/앞으로가기) 이벤트로도 재적용된다", async () => {
    const env = createEnv("https://spa.example.com/a");
    env.seedRules("spa.example.com", [{ id: "r1", hostname: "spa.example.com", selector: "#y", mode: "block", createdAt: 1 }]);
    env.loadContentScript();
    await wait(50);

    env.setLocation("https://spa.example.com/b");
    env.triggerWindowEvent("popstate");
    const el = env.document.createElement("div");
    el.id = "y";
    env.document.body.appendChild(el);
    await wait(DEBOUNCE_WAIT);

    assert.equal(el.classList.contains("cloakli-masked"), true);
  });

  test("hashchange 이벤트로도 재적용된다", async () => {
    const env = createEnv("https://spa.example.com/page");
    env.seedRules("spa.example.com", [{ id: "r1", hostname: "spa.example.com", selector: "#z", mode: "block", createdAt: 1 }]);
    env.loadContentScript();
    await wait(50);

    env.setLocation("https://spa.example.com/page#section2");
    env.triggerWindowEvent("hashchange");
    const el = env.document.createElement("div");
    el.id = "z";
    env.document.body.appendChild(el);
    await wait(DEBOUNCE_WAIT);

    assert.equal(el.classList.contains("cloakli-masked"), true);
  });

  test("실제로 URL이 바뀌지 않았으면 불필요한 재적용을 하지 않는다", async () => {
    const env = createEnv("https://example.com/same");
    env.seedRules("example.com", [{ id: "r1", hostname: "example.com", selector: "#a", mode: "block", createdAt: 1 }]);
    env.loadContentScript();
    await wait(50);

    const getApplyCount = instrumentStorageGetCalls(env);

    env.sandbox.history.pushState({}, "", "/same"); // 같은 경로 -> URL 변화 없음
    await wait(DEBOUNCE_WAIT);

    assert.equal(getApplyCount(), 0);
  });

  test("history.pushState의 인자와 반환값은 원래 동작대로 유지된다", async () => {
    const env = createEnv("https://example.com/");
    env.loadContentScript();
    await wait(20);

    // 패치되기 전 동작을 흉내내기 위해, 새 pushState가 실제로 location을 옮기는지도 함께 확인한다.
    const result = env.sandbox.history.pushState({ foo: "bar" }, "ignored-title", "/moved");
    assert.equal(result, undefined); // 표준 history.pushState의 반환값은 undefined
    assert.equal(env.sandbox.location.href, "https://example.com/moved");
  });
});

describe("일시 해제 (현재 페이지 가림 모두 해제)", () => {
  test("해제 후에는 같은 URL에서 mutation이 발생해도 다시 가리지 않는다", async () => {
    const env = createEnv("https://example.com/");
    env.seedRules("example.com", [{ id: "r1", hostname: "example.com", selector: "#a", mode: "block", createdAt: 1 }]);
    const el = env.document.createElement("div");
    el.id = "a";
    env.document.body.appendChild(el);
    env.loadContentScript();
    await wait(50);
    assert.equal(el.classList.contains("cloakli-masked"), true);

    const resp = await env.sendRuntimeMessage({ type: "CLEAR_ALL_MASKS" });
    // resp는 vm 컨텍스트(다른 realm) 안에서 만들어진 객체라 deepStrictEqual의
    // 프로토타입 비교가 실패할 수 있으므로, 필요한 속성만 직접 비교한다.
    assert.equal(resp.ok, true);
    assert.equal(el.classList.contains("cloakli-masked"), false);

    // 같은 요소를 다시 추가해도(같은 selector) 자동으로 다시 가려지면 안 된다.
    const el2 = env.document.createElement("div");
    el2.id = "a2"; // 다른 요소이지만 관찰을 트리거하기 위해 추가
    env.document.body.appendChild(el2);
    env.flushMutations();
    await wait(DEBOUNCE_WAIT);

    assert.equal(el.classList.contains("cloakli-masked"), false, "일시 해제 중에는 다시 가려지면 안 된다");
  });

  test("URL이 바뀌면 일시 해제 상태가 풀리고 저장 규칙이 다시 적용된다", async () => {
    const env = createEnv("https://spa.example.com/x");
    env.seedRules("spa.example.com", [{ id: "r1", hostname: "spa.example.com", selector: "#a", mode: "block", createdAt: 1 }]);
    const el = env.document.createElement("div");
    el.id = "a";
    env.document.body.appendChild(el);
    env.loadContentScript();
    await wait(50);

    await env.sendRuntimeMessage({ type: "CLEAR_ALL_MASKS" });
    assert.equal(el.classList.contains("cloakli-masked"), false);

    env.sandbox.history.pushState({}, "", "/y");
    await wait(DEBOUNCE_WAIT);

    assert.equal(el.classList.contains("cloakli-masked"), true, "새 URL에서는 저장 규칙이 다시 적용되어야 한다");
  });

  test("일시 해제 중에도 사용자가 새로 선택한 요소는 즉시 가려진다", async () => {
    const env = createEnv("https://example.com/");
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "CLEAR_ALL_MASKS" }); // 저장 규칙이 없어도 호출 자체는 안전해야 한다

    const el = env.document.createElement("div");
    env.document.body.appendChild(el);
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el, "click");
    chooseScopeOption(env, 0); // "이 요소만"

    assert.equal(el.classList.contains("cloakli-masked"), true);
  });
});

describe("storage 변경 동기화 (options 페이지에서의 삭제 반영)", () => {
  test("규칙 하나를 삭제하면 그 규칙의 가림만 사라지고 다른 규칙은 유지된다", async () => {
    const env = createEnv("https://example.com/");
    env.seedRules("example.com", [
      { id: "r1", hostname: "example.com", selector: "#a", mode: "block", createdAt: 1 },
      { id: "r2", hostname: "example.com", selector: "#b", mode: "block", createdAt: 2 },
    ]);
    const elA = env.document.createElement("div");
    elA.id = "a";
    const elB = env.document.createElement("div");
    elB.id = "b";
    env.document.body.appendChild(elA);
    env.document.body.appendChild(elB);
    env.loadContentScript();
    await wait(50);
    assert.equal(elA.classList.contains("cloakli-masked"), true);
    assert.equal(elB.classList.contains("cloakli-masked"), true);

    const remaining = env.getStoredRules("example.com").filter((r) => r.id !== "r1");
    await new Promise((resolve) =>
      env.chrome.storage.local.set({ cloakliRules: { "example.com": remaining } }, resolve)
    );
    await wait(80);

    assert.equal(elA.classList.contains("cloakli-masked"), false, "삭제된 규칙의 가림은 사라져야 한다");
    assert.equal(elB.classList.contains("cloakli-masked"), true, "남은 규칙의 가림은 유지되어야 한다");
  });

  test("다른 hostname의 규칙 변경은 현재 페이지에 영향을 주지 않는다", async () => {
    const env = createEnv("https://a.example.com/");
    env.seedRules("a.example.com", [{ id: "r1", hostname: "a.example.com", selector: "#a", mode: "block", createdAt: 1 }]);
    const el = env.document.createElement("div");
    el.id = "a";
    env.document.body.appendChild(el);
    env.loadContentScript();
    await wait(50);
    assert.equal(el.classList.contains("cloakli-masked"), true);

    // 다른 사이트(b.example.com)의 규칙만 바뀜
    await new Promise((resolve) =>
      env.chrome.storage.local.set(
        {
          cloakliRules: {
            "a.example.com": env.getStoredRules("a.example.com"),
            "b.example.com": [{ id: "x", hostname: "b.example.com", selector: "#z", mode: "block", createdAt: 9 }],
          },
        },
        resolve
      )
    );
    await wait(80);

    assert.equal(el.classList.contains("cloakli-masked"), true, "다른 사이트의 변경으로 영향을 받으면 안 된다");
  });

  test("storage 이벤트가 반복적으로 처리되어 무한 루프를 만들지 않는다", async () => {
    const env = createEnv("https://example.com/");
    env.seedRules("example.com", [{ id: "r1", hostname: "example.com", selector: "#a", mode: "block", createdAt: 1 }]);
    env.document.body.appendChild(Object.assign(env.document.createElement("div"), { id: "a" }));
    env.loadContentScript();
    await wait(50);

    let onChangedFireCount = 0;
    const original = env.chrome.storage.__onChangedListeners[0];
    env.chrome.storage.__onChangedListeners[0] = (...args) => {
      onChangedFireCount++;
      return original(...args);
    };

    // 규칙 삭제 한 번만 수행
    await new Promise((resolve) => env.chrome.storage.local.set({ cloakliRules: {} }, resolve));
    await wait(150);

    assert.equal(onChangedFireCount, 1, "저장소 변경 1회에 리스너도 1회만 호출되어야 한다 (무한 반복 없음)");
  });
});

describe("선택 모드와 동적 대응 기능의 상호작용", () => {
  test("선택 모드 중 새 DOM 변경이 있어도 선택 모드가 강제 종료되지 않는다", async () => {
    const env = createEnv("https://example.com/");
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    assert.equal(env.document.body.classList.contains("cloakli-selecting"), true);

    const noise = env.document.createElement("div");
    env.document.body.appendChild(noise);
    env.flushMutations();
    await wait(DEBOUNCE_WAIT);

    assert.equal(
      env.document.body.classList.contains("cloakli-selecting"),
      true,
      "무관한 DOM 변경으로 선택 모드가 종료되면 안 된다"
    );
  });

  test("선택 완료 후 해당 selector가 저장되고 즉시 가려진다", async () => {
    const env = createEnv("https://example.com/");
    env.loadContentScript();
    await wait(20);

    const target = env.document.createElement("button");
    target.id = "submit-btn";
    env.document.body.appendChild(target);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(target, "click");
    chooseScopeOption(env, 0); // "이 요소만"
    // 저장 후 storage.onChanged가 다시 발화되어 제거+재적용 라운드트립이 있으므로,
    // 고정 시간 대신 실제로 저장/가림이 끝날 때까지 폴링한다(타이밍에 안정적).
    await waitUntil(() => env.getStoredRules("example.com").length === 1);
    await waitUntil(() => target.classList.contains("cloakli-masked"));

    assert.equal(target.classList.contains("cloakli-masked"), true);
    const saved = env.getStoredRules("example.com");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].selector, "#submit-btn");
    assert.equal(saved[0].scope, "element");
  });

  test("안내 바(banner)는 Cloakli 선택 대상에서 제외된다", async () => {
    const env = createEnv("https://example.com/");
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    const banner = env.document.getElementById("cloakli-selection-banner-root");
    assert.ok(banner, "선택 모드 중에는 안내 바가 있어야 한다");

    env.dispatch(banner, "click");
    assert.equal(banner.classList.contains("cloakli-masked"), false, "안내 바 자신은 가려지면 안 된다");
  });
});

describe("초기화 중복 방지 (재주입 가드)", () => {
  test("content.js가 같은 문서에서 두 번 실행되어도 observer/리스너가 중복 등록되지 않는다", async () => {
    const env = createEnv("https://example.com/");
    env.loadContentScript();
    await wait(20);

    const observerCountBefore = FakeMutationObserver.instances.length;
    const messageListenerCountBefore = env.chrome.runtime.__listeners.length;
    const storageListenerCountBefore = env.chrome.storage.__onChangedListeners.length;

    // popup 버튼을 다시 눌러 재주입되는 상황을 흉내낸다.
    env.loadContentScript();
    env.loadContentScript();

    assert.equal(FakeMutationObserver.instances.length, observerCountBefore);
    assert.equal(env.chrome.runtime.__listeners.length, messageListenerCountBefore);
    assert.equal(env.chrome.storage.__onChangedListeners.length, storageListenerCountBefore);
  });
});

describe("범위 선택 UI", () => {
  test("요소를 클릭하면 즉시 저장되지 않고 범위 선택 UI가 뜬다", async () => {
    const env = createEnv("https://example.com/");
    env.loadContentScript();
    await wait(20);

    const el = env.document.createElement("div");
    el.id = "target";
    env.document.body.appendChild(el);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el, "click");

    assert.equal(el.classList.contains("cloakli-masked"), false, "선택 직후에는 아직 가려지면 안 된다");
    const picker = env.document.getElementById("cloakli-scope-picker-root");
    assert.ok(picker, "범위 선택 UI가 표시되어야 한다");
    assert.equal(env.getStoredRules("example.com").length, 0, "선택 직후에는 아직 저장되면 안 된다");
  });

  test("취소 버튼을 누르면 아무것도 저장되지 않고 UI가 닫힌다", async () => {
    const env = createEnv("https://example.com/");
    env.loadContentScript();
    await wait(20);

    const el = env.document.createElement("div");
    el.id = "target";
    env.document.body.appendChild(el);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el, "click");

    const picker = env.document.getElementById("cloakli-scope-picker-root");
    const cancelBtn = picker.children.find((c) => c.className === "cloakli-scope-picker-cancel");
    env.dispatch(cancelBtn, "click");

    assert.equal(env.document.getElementById("cloakli-scope-picker-root"), null, "UI가 닫혀야 한다");
    assert.equal(el.classList.contains("cloakli-masked"), false);
    assert.equal(env.getStoredRules("example.com").length, 0);
  });

  test("ESC 키를 누르면 아무것도 저장되지 않고 UI가 닫힌다", async () => {
    const env = createEnv("https://example.com/");
    env.loadContentScript();
    await wait(20);

    const el = env.document.createElement("div");
    el.id = "target";
    env.document.body.appendChild(el);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el, "click");
    env.dispatch(env.document.body, "keydown", { key: "Escape" });

    assert.equal(env.document.getElementById("cloakli-scope-picker-root"), null);
    assert.equal(el.classList.contains("cloakli-masked"), false);
    assert.equal(env.getStoredRules("example.com").length, 0);
  });

  test("범위 선택 UI 자체는 선택 대상이 되지 않는다 (Cloakli 자체 UI 제외)", async () => {
    const env = createEnv("https://example.com/");
    env.loadContentScript();
    await wait(20);

    const el = env.document.createElement("div");
    el.id = "target";
    env.document.body.appendChild(el);
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el, "click");

    const picker = env.document.getElementById("cloakli-scope-picker-root");
    assert.equal(picker.classList.contains("cloakli-scope-picker"), true);
    // 선택 모드는 이미 종료된 상태이므로(endSelectionMode), picker 자신을 클릭해도
    // 새로운 선택으로 처리되거나 selector 대상이 되지 않는다.
    env.dispatch(picker, "click");
    assert.equal(env.document.getElementById("cloakli-scope-picker-root"), picker, "picker 자신 클릭으로 사라지면 안 된다");
  });

  test("완료(선택 확정) 후에는 picker의 ESC 리스너가 남지 않는다 (리스너 누수/중복 방지)", async () => {
    const env = createEnv("https://example.com/");
    env.loadContentScript();
    await wait(20);

    const el1 = env.document.createElement("div");
    env.document.body.appendChild(el1);
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el1, "click");
    chooseScopeOption(env, 0);

    const afterConfirm = (env.document._listeners["keydown|c"] || []).length;
    assert.equal(afterConfirm, 0, "선택을 확정하면 picker의 keydown 리스너가 제거되어야 한다");

    // 다시 선택 모드를 시작해 두 번째 요소를 고르고 취소해도 리스너가 쌓이지 않는지 확인한다.
    const el2 = env.document.createElement("div");
    env.document.body.appendChild(el2);
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el2, "click");
    assert.equal((env.document._listeners["keydown|c"] || []).length, 1, "picker가 열려 있는 동안은 리스너가 1개여야 한다");
    env.dispatch(env.document.body, "keydown", { key: "Escape" });
    assert.equal((env.document._listeners["keydown|c"] || []).length, 0);
  });
});

describe("일반화 selector 생성 (같은 종류 모두)", () => {
  test("동일 class 카드 여러 개 중 하나를 고르면 '페이지'/'사이트' 범위에서 전체 개수가 미리보기로 표시된다", async () => {
    const env = createEnv("https://example.com/list");
    const container = env.document.createElement("div");
    env.document.body.appendChild(container);
    const cards = [];
    for (let i = 0; i < 5; i++) {
      const c = env.document.createElement("h3");
      c.className = "video-title";
      container.appendChild(c);
      cards.push(c);
    }
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[0], "click");

    const picker = env.document.getElementById("cloakli-scope-picker-root");
    const options = picker.children.filter((c) => c.className === "cloakli-scope-picker-option");
    const pageLabel = options[1].children.find((c) => c.tagName === "STRONG").textContent;
    assert.match(pageLabel, /\(5개\)/, "미리보기 개수가 5개로 표시되어야 한다");
  });

  test("'현재 페이지의 같은 종류 모두'를 선택하면 같은 class를 가진 요소가 전부 즉시 가려진다", async () => {
    const env = createEnv("https://example.com/list");
    const container = env.document.createElement("div");
    env.document.body.appendChild(container);
    const cards = [];
    for (let i = 0; i < 4; i++) {
      const c = env.document.createElement("h3");
      c.className = "video-title";
      container.appendChild(c);
      cards.push(c);
    }
    // page/site 범위는 Pro 기능이므로(무료판 차단은 별도 describe에서 검증), 이 테스트는
    // Pro 상태에서 범위 선택/저장 메커니즘 자체가 올바른지만 확인한다.
    env.loadContentScript({ entitlementOverride: { plan: "pro", source: "developer", isPro: true } });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[0], "click");
    chooseScopeOption(env, 1); // 현재 페이지의 같은 종류 모두
    // 가림 자체는 동기적으로 즉시 적용되지만, storage 저장은 비동기이고 그 뒤 storage.onChanged가
    // 다시 발화되어 removeAllCloakliMasks + applyStoredRules를 한 번 더 거치는 라운드트립이 있다.
    // 고정된 시간을 기다리는 대신 두 조건이 실제로 참이 될 때까지 각각 폴링한다(타이밍에 안정적).
    await waitUntil(() => env.getStoredRules("example.com").length === 1);
    await waitUntil(() => cards.every((c) => c.classList.contains("cloakli-masked")));

    cards.forEach((c) => assert.equal(c.classList.contains("cloakli-masked"), true));

    const saved = env.getStoredRules("example.com");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].scope, "page");
    assert.equal(saved[0].pagePattern, "/list");
  });

  test("'이 사이트의 같은 종류 모두'를 선택하면 scope:site, pagePattern:null로 저장된다", async () => {
    const env = createEnv("https://example.com/list");
    const container = env.document.createElement("div");
    env.document.body.appendChild(container);
    for (let i = 0; i < 3; i++) {
      const c = env.document.createElement("h3");
      c.className = "video-title";
      container.appendChild(c);
    }
    // page/site 범위는 Pro 기능이므로 Pro 상태에서 메커니즘만 확인한다.
    env.loadContentScript({ entitlementOverride: { plan: "pro", source: "developer", isPro: true } });
    await wait(20);

    const target = container.children[0];
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(target, "click");
    chooseScopeOption(env, 2); // 이 사이트의 같은 종류 모두
    await waitUntil(() => env.getStoredRules("example.com").length === 1);

    const saved = env.getStoredRules("example.com");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].scope, "site");
    assert.equal(saved[0].pagePattern, null);
  });

  test("무작위 해시처럼 보이는 class는 일반화 selector에서 제외된다", async () => {
    const env = createEnv("https://example.com/list");
    const container = env.document.createElement("div");
    env.document.body.appendChild(container);
    const cards = [];
    for (let i = 0; i < 3; i++) {
      const c = env.document.createElement("h3");
      c.className = "video-title css-1a2b3c4d"; // css-1a2b3c4d는 해시형 class로 판단되어 제외되어야 한다
      container.appendChild(c);
      cards.push(c);
    }
    // page/site 범위는 Pro 기능이므로 Pro 상태에서 selector 생성 로직만 확인한다.
    env.loadContentScript({ entitlementOverride: { plan: "pro", source: "developer", isPro: true } });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[0], "click");
    chooseScopeOption(env, 2);
    await waitUntil(() => env.getStoredRules("example.com").length === 1);
    await waitUntil(() => cards.every((c) => c.classList.contains("cloakli-masked")));

    const saved = env.getStoredRules("example.com");
    assert.equal(saved.length, 1);
    assert.ok(!saved[0].selector.includes("css-1a2b3c4d"), "해시형 class는 selector에 포함되면 안 된다");
    assert.ok(saved[0].selector.includes("video-title"));
    cards.forEach((c) => assert.equal(c.classList.contains("cloakli-masked"), true));
  });

  test("일반화 selector는 nth-of-type/nth-child를 사용하지 않는다", async () => {
    const env = createEnv("https://example.com/list");
    const container = env.document.createElement("div");
    env.document.body.appendChild(container);
    for (let i = 0; i < 3; i++) {
      const c = env.document.createElement("h3");
      c.className = "video-title";
      container.appendChild(c);
    }
    // page/site 범위는 Pro 기능이므로 Pro 상태에서 selector 생성 로직만 확인한다.
    env.loadContentScript({ entitlementOverride: { plan: "pro", source: "developer", isPro: true } });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(container.children[0], "click");
    chooseScopeOption(env, 1);
    await waitUntil(() => env.getStoredRules("example.com").length === 1);

    const saved = env.getStoredRules("example.com");
    assert.equal(saved.length, 1);
    assert.ok(!/nth-of-type|nth-child/.test(saved[0].selector));
  });

  test("class/속성이 전혀 없는 흔한 태그(div)를 고르고 부모도 구분할 방법이 없으면, 일반화 범위가 비활성화된다", async () => {
    const env = createEnv("https://example.com/list");
    const bare = env.document.createElement("div"); // class/id/속성 없음
    env.document.body.appendChild(bare); // 부모(body)도 별다른 class가 없음
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(bare, "click");

    const picker = env.document.getElementById("cloakli-scope-picker-root");
    const options = picker.children.filter((c) => c.className === "cloakli-scope-picker-option");
    assert.equal(options[1].disabled, true, "페이지 범위 버튼이 비활성화되어야 한다");
    assert.equal(options[2].disabled, true, "사이트 범위 버튼이 비활성화되어야 한다");

    // 비활성 버튼을 클릭해도 아무 일도 일어나지 않아야 한다.
    env.dispatch(options[1], "click");
    assert.equal(env.getStoredRules("example.com").length, 0);
  });
});

describe("scope 적용 (element / page / site)", () => {
  test("element 규칙은 hostname이 같으면 selector가 있는 어떤 페이지에도 적용된다", async () => {
    const env = createEnv("https://example.com/page-a");
    env.seedRules("example.com", [
      { id: "r1", hostname: "example.com", scope: "element", selector: "#a", pagePattern: null, createdAt: 1 },
    ]);
    const el = env.document.createElement("div");
    el.id = "a";
    env.document.body.appendChild(el);
    env.loadContentScript();
    await wait(50);

    assert.equal(el.classList.contains("cloakli-masked"), true);
  });

  test("page 규칙은 저장 당시의 page pattern과 일치할 때만 적용된다", async () => {
    const env = createEnv("https://www.youtube.com/watch?v=AAA");
    env.seedRules("www.youtube.com", [
      {
        id: "r1",
        hostname: "www.youtube.com",
        scope: "page",
        selector: "h3.video-title",
        pagePattern: "/watch",
        createdAt: 1,
      },
    ]);
    const title = env.document.createElement("h3");
    title.className = "video-title";
    env.document.body.appendChild(title);
    env.loadContentScript();
    await wait(50);

    assert.equal(title.classList.contains("cloakli-masked"), true, "같은 pathname(/watch)이면 다른 영상 ID라도 적용되어야 한다");
  });

  test("page 규칙은 다른 pathname의 페이지에는 적용되지 않는다", async () => {
    const env = createEnv("https://www.youtube.com/results?search_query=x");
    env.seedRules("www.youtube.com", [
      {
        id: "r1",
        hostname: "www.youtube.com",
        scope: "page",
        selector: "h3.video-title",
        pagePattern: "/watch",
        createdAt: 1,
      },
    ]);
    const title = env.document.createElement("h3");
    title.className = "video-title";
    env.document.body.appendChild(title);
    env.loadContentScript();
    await wait(50);

    assert.equal(title.classList.contains("cloakli-masked"), false, "/watch 규칙이 /results 페이지에 적용되면 안 된다");
  });

  test("site 규칙은 hostname 내 모든 URL에 적용된다", async () => {
    const env = createEnv("https://www.youtube.com/results?search_query=x");
    env.seedRules("www.youtube.com", [
      { id: "r1", hostname: "www.youtube.com", scope: "site", selector: "h3.video-title", pagePattern: null, createdAt: 1 },
    ]);
    const title = env.document.createElement("h3");
    title.className = "video-title";
    env.document.body.appendChild(title);
    env.loadContentScript();
    await wait(50);

    assert.equal(title.classList.contains("cloakli-masked"), true);
  });

  test("다른 hostname의 규칙은 적용되지 않는다", async () => {
    const env = createEnv("https://other.example.com/");
    env.seedRules("www.youtube.com", [
      { id: "r1", hostname: "www.youtube.com", scope: "site", selector: "h3.video-title", pagePattern: null, createdAt: 1 },
    ]);
    const title = env.document.createElement("h3");
    title.className = "video-title";
    env.document.body.appendChild(title);
    env.loadContentScript();
    await wait(50);

    assert.equal(title.classList.contains("cloakli-masked"), false);
  });

  test("SPA 이동 후 page 규칙이 재평가된다: /watch -> /results로 이동하면 가림이 새로 적용되지 않는다", async () => {
    const env = createEnv("https://www.youtube.com/watch?v=AAA");
    env.seedRules("www.youtube.com", [
      {
        id: "r1",
        hostname: "www.youtube.com",
        scope: "page",
        selector: "h3.video-title",
        pagePattern: "/watch",
        createdAt: 1,
      },
    ]);
    env.loadContentScript();
    await wait(50);

    env.sandbox.history.pushState({}, "", "/results?search_query=x");
    const newTitle = env.document.createElement("h3");
    newTitle.className = "video-title";
    env.document.body.appendChild(newTitle);
    await wait(DEBOUNCE_WAIT);

    assert.equal(newTitle.classList.contains("cloakli-masked"), false, "/results 페이지에는 /watch 전용 page 규칙이 적용되면 안 된다");
  });

  test("SPA 이동 후에도 site 규칙은 계속 적용된다 (다른 영상으로 이동해도 새 제목이 가려짐)", async () => {
    const env = createEnv("https://www.youtube.com/watch?v=AAA");
    env.seedRules("www.youtube.com", [
      { id: "r1", hostname: "www.youtube.com", scope: "site", selector: "h3.video-title", pagePattern: null, createdAt: 1 },
    ]);
    env.loadContentScript();
    await wait(50);

    env.sandbox.history.pushState({}, "", "/watch?v=BBB");
    const newTitle = env.document.createElement("h3");
    newTitle.className = "video-title";
    env.document.body.appendChild(newTitle);
    await wait(DEBOUNCE_WAIT);

    assert.equal(newTitle.classList.contains("cloakli-masked"), true, "다른 영상으로 이동해도 site 규칙은 계속 적용되어야 한다");
  });
});

describe("사이트 단위 일시중지 (현재 사이트 가림 일시중지)", () => {
  test("일시중지된 사이트에서는 저장 규칙이 자동 적용되지 않는다", async () => {
    const env = createEnv("https://www.youtube.com/");
    env.seedRules("www.youtube.com", [
      { id: "r1", hostname: "www.youtube.com", scope: "site", selector: "#a", pagePattern: null, createdAt: 1 },
    ]);
    env.setHostPaused("www.youtube.com", true);
    const el = env.document.createElement("div");
    el.id = "a";
    env.document.body.appendChild(el);

    env.loadContentScript();
    await wait(50);

    assert.equal(el.classList.contains("cloakli-masked"), false, "일시중지된 사이트에서는 초기 로딩 시에도 적용되면 안 된다");
  });

  test("다른 hostname의 일시중지는 이 사이트에 영향을 주지 않는다", async () => {
    const env = createEnv("https://www.youtube.com/");
    env.seedRules("www.youtube.com", [
      { id: "r1", hostname: "www.youtube.com", scope: "site", selector: "#a", pagePattern: null, createdAt: 1 },
    ]);
    env.setHostPaused("mail.google.com", true); // 다른 사이트만 일시중지
    const el = env.document.createElement("div");
    el.id = "a";
    env.document.body.appendChild(el);

    env.loadContentScript();
    await wait(50);

    assert.equal(el.classList.contains("cloakli-masked"), true, "다른 사이트의 일시중지가 이 사이트에 영향을 주면 안 된다");
  });

  test("일시중지하면 이미 적용된 가림이 제거된다 (popup에서 storage로 토글하는 경로)", async () => {
    const env = createEnv("https://www.youtube.com/");
    env.seedRules("www.youtube.com", [
      { id: "r1", hostname: "www.youtube.com", scope: "site", selector: "#a", pagePattern: null, createdAt: 1 },
    ]);
    const el = env.document.createElement("div");
    el.id = "a";
    env.document.body.appendChild(el);

    env.loadContentScript();
    await wait(50);
    assert.equal(el.classList.contains("cloakli-masked"), true);

    await env.setHostPausedViaStorage("www.youtube.com", true);
    await waitUntil(() => !el.classList.contains("cloakli-masked"));

    assert.equal(el.classList.contains("cloakli-masked"), false, "일시중지 즉시 기존 가림이 제거되어야 한다");
  });

  test("다시 시작하면 저장 규칙이 즉시 다시 적용된다", async () => {
    const env = createEnv("https://www.youtube.com/");
    env.seedRules("www.youtube.com", [
      { id: "r1", hostname: "www.youtube.com", scope: "site", selector: "#a", pagePattern: null, createdAt: 1 },
    ]);
    env.setHostPaused("www.youtube.com", true);
    const el = env.document.createElement("div");
    el.id = "a";
    env.document.body.appendChild(el);

    env.loadContentScript();
    await wait(50);
    assert.equal(el.classList.contains("cloakli-masked"), false);

    await env.setHostPausedViaStorage("www.youtube.com", false);
    await waitUntil(() => el.classList.contains("cloakli-masked"));

    assert.equal(el.classList.contains("cloakli-masked"), true, "다시 시작하면 규칙이 즉시 재적용되어야 한다");
  });

  test("새로고침(스크립트 재시작)에 해당하는 상황에서도 일시중지 상태가 유지된다", async () => {
    const env = createEnv("https://www.youtube.com/");
    env.seedRules("www.youtube.com", [
      { id: "r1", hostname: "www.youtube.com", scope: "site", selector: "#a", pagePattern: null, createdAt: 1 },
    ]);
    env.setHostPaused("www.youtube.com", true);

    // 새로고침을 흉내내기 위해 같은 storage를 공유하는 새 env(=새 문서/새 content.js 인스턴스)를 만든다.
    const el = env.document.createElement("div");
    el.id = "a";
    env.document.body.appendChild(el);
    env.loadContentScript();
    await wait(50);

    assert.equal(el.classList.contains("cloakli-masked"), false, "새로고침 후에도(=스크립트가 새로 시작해도) 일시중지가 유지되어야 한다");
  });

  test("일시중지 데이터와 규칙 삭제 데이터는 서로 분리되어 있다", async () => {
    const env = createEnv("https://www.youtube.com/");
    env.seedRules("www.youtube.com", [
      { id: "r1", hostname: "www.youtube.com", scope: "site", selector: "#a", pagePattern: null, createdAt: 1 },
    ]);
    env.setHostPaused("www.youtube.com", true);
    env.loadContentScript();
    await wait(50);

    // 일시중지되어 있어도 저장된 규칙 자체는 그대로 남아 있어야 한다.
    const rules = env.getStoredRules("www.youtube.com");
    assert.equal(rules.length, 1);
    assert.equal(rules[0].selector, "#a");

    // 일시중지를 풀어도 규칙이 지워지지 않고 그대로 재적용된다.
    await env.setHostPausedViaStorage("www.youtube.com", false);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    assert.equal(env.getStoredRules("www.youtube.com").length, 1);
  });

  test("일시중지 중에도 사용자가 새 요소를 직접 선택하면 즉시 가려지고 저장된다", async () => {
    const env = createEnv("https://example.com/");
    env.setHostPaused("example.com", true);
    env.loadContentScript();
    await wait(30);

    const el = env.document.createElement("div");
    env.document.body.appendChild(el);
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el, "click");
    chooseScopeOption(env, 0);

    assert.equal(el.classList.contains("cloakli-masked"), true, "일시중지 중에도 직접 선택한 요소는 즉시 가려져야 한다");
  });
});

describe("무료/Pro 요금제 제한 (entitlement)", () => {
  function getToastEl(env) {
    return env.document.getElementById("cloakli-toast-root");
  }

  test("무료 사용자는 규칙이 이미 3개면 4번째는 차단되고, 임시 가림도 즉시 제거된다", async () => {
    const env = createEnv("https://example.com/");
    env.seedRules("example.com", [
      { id: "r1", hostname: "example.com", scope: "element", selector: "#a", pagePattern: null, createdAt: 1 },
      { id: "r2", hostname: "example.com", scope: "element", selector: "#b", pagePattern: null, createdAt: 2 },
      { id: "r3", hostname: "example.com", scope: "element", selector: "#c", pagePattern: null, createdAt: 3 },
    ]);
    const elA = env.document.createElement("div");
    elA.id = "a";
    const elB = env.document.createElement("div");
    elB.id = "b";
    const elC = env.document.createElement("div");
    elC.id = "c";
    env.document.body.appendChild(elA);
    env.document.body.appendChild(elB);
    env.document.body.appendChild(elC);
    env.loadContentScript();
    await wait(50);
    // 기존 1~3번째 규칙은 초기 로딩 시 정상적으로 가려져 있어야 한다.
    assert.equal(elA.classList.contains("cloakli-masked"), true);
    assert.equal(elB.classList.contains("cloakli-masked"), true);
    assert.equal(elC.classList.contains("cloakli-masked"), true);

    const elD = env.document.createElement("div");
    elD.id = "d";
    env.document.body.appendChild(elD);
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(elD, "click");
    chooseScopeOption(env, 0); // 이 요소만
    await wait(80);

    assert.equal(env.getStoredRules("example.com").length, 3, "4번째 규칙은 저장되지 않아야 한다");
    const toast = getToastEl(env);
    assert.ok(toast, "차단 안내 toast가 표시되어야 한다");
    assert.match(toast.textContent, /최대 3개까지/);

    // 새로고침 전(=이 세션에서) 이미 4번째 요소의 임시 가림이 제거되어 있어야 한다.
    assert.equal(elD.classList.contains("cloakli-masked"), false, "차단된 4번째 요소는 가려지지 않아야 한다");
    assert.equal(
      elD.className.split(/\s+/).some((c) => c.indexOf("cloakli") !== -1),
      false,
      "4번째 요소에 Cloakli class가 남아 있으면 안 된다"
    );
    assert.equal(
      Object.keys(elD.dataset || {}).some((k) => k.toLowerCase().indexOf("cloakli") !== -1),
      false,
      "4번째 요소에 Cloakli dataset이 남아 있으면 안 된다"
    );
    // 오버레이 레이어(자식 요소)도 남아 있으면 안 된다.
    assert.equal(
      elD.childNodes.some((c) => c.classList && c.classList.contains("cloakli-mask-overlay")),
      false,
      "4번째 요소에 가림 레이어가 남아 있으면 안 된다"
    );

    // 기존 1~3번째 가림은 그대로 유지되어야 한다(이번 롤백이 다른 요소에 영향을 주면 안 됨).
    assert.equal(elA.classList.contains("cloakli-masked"), true, "기존 1번째 가림은 유지되어야 한다");
    assert.equal(elB.classList.contains("cloakli-masked"), true, "기존 2번째 가림은 유지되어야 한다");
    assert.equal(elC.classList.contains("cloakli-masked"), true, "기존 3번째 가림은 유지되어야 한다");
  });

  test("storage 저장이 실패하면 임시 가림도 남지 않는다", async () => {
    const env = createEnv("https://example.com/");
    env.loadContentScript();
    await wait(30);

    // chrome.storage.local.set이 실패하는 것을 흉내낸다.
    const originalSet = env.chrome.storage.local.set;
    env.chrome.storage.local.set = function (obj, cb) {
      env.chrome.runtime.lastError = { message: "storage 오류(테스트)" };
      setTimeout(() => {
        cb();
        env.chrome.runtime.lastError = undefined;
      }, 0);
    };

    const el = env.document.createElement("div");
    el.id = "fail-target";
    env.document.body.appendChild(el);
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el, "click");
    chooseScopeOption(env, 0); // 이 요소만
    await wait(80);

    env.chrome.storage.local.set = originalSet;

    assert.equal(env.getStoredRules("example.com").length, 0, "저장 실패 시 규칙이 남으면 안 된다");
    assert.equal(el.classList.contains("cloakli-masked"), false, "저장 실패 시 임시 가림도 남으면 안 된다");
    const toast = getToastEl(env);
    assert.ok(toast, "실패 안내 toast가 표시되어야 한다");
  });

  test("무료 사용자는 규칙이 2개일 때 3번째는 저장할 수 있다", async () => {
    const env = createEnv("https://example.com/");
    env.seedRules("example.com", [
      { id: "r1", hostname: "example.com", scope: "element", selector: "#a", pagePattern: null, createdAt: 1 },
      { id: "r2", hostname: "example.com", scope: "element", selector: "#b", pagePattern: null, createdAt: 2 },
    ]);
    env.loadContentScript();
    await wait(30);

    const el = env.document.createElement("div");
    el.id = "c";
    env.document.body.appendChild(el);
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("example.com").length === 3);

    assert.equal(env.getStoredRules("example.com").length, 3);
  });

  test("규칙을 삭제해 한도 아래로 내려가면 다시 저장할 수 있다", async () => {
    const env = createEnv("https://example.com/");
    env.seedRules("example.com", [
      { id: "r1", hostname: "example.com", scope: "element", selector: "#a", pagePattern: null, createdAt: 1 },
      { id: "r2", hostname: "example.com", scope: "element", selector: "#b", pagePattern: null, createdAt: 2 },
      { id: "r3", hostname: "example.com", scope: "element", selector: "#c", pagePattern: null, createdAt: 3 },
    ]);
    env.loadContentScript();
    await wait(30);

    // options.js의 개별 삭제와 동일하게 storage를 직접 갱신한다.
    const remaining = env.getStoredRules("example.com").filter((r) => r.id !== "r1");
    await new Promise((resolve) => env.chrome.storage.local.set({ cloakliRules: { "example.com": remaining } }, resolve));
    await wait(80);

    const el = env.document.createElement("div");
    el.id = "d";
    env.document.body.appendChild(el);
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("example.com").length === 3);

    assert.equal(env.getStoredRules("example.com").length, 3, "삭제로 한도 아래로 내려간 뒤에는 다시 저장되어야 한다");
  });

  test("무료 사용자는 이미 다른 hostname을 쓰고 있으면 새 hostname에는 저장할 수 없다", async () => {
    const env = createEnv("https://second.example.com/");
    env.seedRules("first.example.com", [
      { id: "r1", hostname: "first.example.com", scope: "element", selector: "#a", pagePattern: null, createdAt: 1 },
    ]);
    env.loadContentScript();
    await wait(30);

    const el = env.document.createElement("div");
    el.id = "b";
    env.document.body.appendChild(el);
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el, "click");
    chooseScopeOption(env, 0);
    await wait(80);

    assert.equal(
      env.getStoredRules("second.example.com").length,
      0,
      "이미 다른 사이트를 쓰고 있으면 새 사이트에는 저장되면 안 된다"
    );
    const toast = getToastEl(env);
    assert.ok(toast, "차단 안내 toast가 표시되어야 한다");
    assert.match(toast.textContent, /1개 사이트/);
  });

  test("첫 hostname의 규칙을 전부 삭제하면 다른 hostname에 새로 저장할 수 있다", async () => {
    const env = createEnv("https://second.example.com/");
    env.seedRules("first.example.com", [
      { id: "r1", hostname: "first.example.com", scope: "element", selector: "#a", pagePattern: null, createdAt: 1 },
    ]);
    env.loadContentScript();
    await wait(30);

    // options.js의 "사이트 전체 삭제"와 동일하게 해당 hostname 키 자체를 제거한다.
    await new Promise((resolve) => env.chrome.storage.local.set({ cloakliRules: {} }, resolve));
    await wait(80);

    const el = env.document.createElement("div");
    el.id = "b";
    env.document.body.appendChild(el);
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("second.example.com").length === 1);

    assert.equal(
      env.getStoredRules("second.example.com").length,
      1,
      "첫 사이트 규칙을 모두 삭제하면 다른 사이트를 새로 쓸 수 있어야 한다"
    );
  });

  test("무료 사용자가 '현재 페이지의 같은 종류 모두'(page)를 선택하면 저장되지 않고 Pro 안내가 표시된다", async () => {
    const env = createEnv("https://example.com/list");
    const container = env.document.createElement("div");
    env.document.body.appendChild(container);
    const cards = [];
    for (let i = 0; i < 3; i++) {
      const c = env.document.createElement("h3");
      c.className = "video-title";
      container.appendChild(c);
      cards.push(c);
    }
    env.loadContentScript(); // 기본값(무료)
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[0], "click");
    chooseScopeOption(env, 1); // 현재 페이지의 같은 종류 모두
    await wait(50);

    assert.equal(env.getStoredRules("example.com").length, 0, "무료판에서는 page 범위가 저장되면 안 된다");
    cards.forEach((c) =>
      assert.equal(c.classList.contains("cloakli-masked"), false, "저장이 차단되면 가리지도 않아야 한다")
    );
    const toast = getToastEl(env);
    assert.ok(toast, "Pro 안내 toast가 표시되어야 한다");
    assert.match(toast.textContent, /Pro 기능/);

    // 범위 선택 UI는 닫히지 않고 그대로 열려 있어, 사용자가 바로 "이 요소만"으로 다시 고를 수 있다.
    const picker = env.document.getElementById("cloakli-scope-picker-root");
    assert.ok(picker, "범위 선택 UI는 닫히지 않고 열려 있어야 한다");
  });

  test("무료 사용자가 '이 사이트의 같은 종류 모두'(site)를 선택해도 저장되지 않는다", async () => {
    const env = createEnv("https://example.com/list");
    const container = env.document.createElement("div");
    env.document.body.appendChild(container);
    for (let i = 0; i < 3; i++) {
      const c = env.document.createElement("h3");
      c.className = "video-title";
      container.appendChild(c);
    }
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(container.children[0], "click");
    chooseScopeOption(env, 2); // 이 사이트의 같은 종류 모두
    await wait(50);

    assert.equal(env.getStoredRules("example.com").length, 0);
  });

  test("Pro(개발자 Pro) 상태에서는 규칙/hostname 한도 없이 저장할 수 있다", async () => {
    const env = createEnv("https://second.example.com/");
    env.seedRules("first.example.com", [
      { id: "r1", hostname: "first.example.com", scope: "element", selector: "#a", pagePattern: null, createdAt: 1 },
      { id: "r2", hostname: "first.example.com", scope: "element", selector: "#b", pagePattern: null, createdAt: 2 },
      { id: "r3", hostname: "first.example.com", scope: "element", selector: "#c", pagePattern: null, createdAt: 3 },
    ]);
    env.loadContentScript({ entitlementOverride: { plan: "pro", source: "developer", isPro: true } });
    await wait(30);

    const el = env.document.createElement("div");
    el.id = "d";
    env.document.body.appendChild(el);
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("second.example.com").length === 1);
    await waitUntil(() => el.classList.contains("cloakli-masked"));

    assert.equal(
      env.getStoredRules("second.example.com").length,
      1,
      "Pro는 다른 사이트에 이미 규칙이 3개 있어도 새 사이트에 저장할 수 있어야 한다"
    );
    assert.equal(el.classList.contains("cloakli-masked"), true, "Pro는 4번째 이상도 정상적으로 가려져야 한다");
  });

  test("Pro(개발자 Pro) 상태에서는 같은 hostname에서 4번째 규칙도 정상 저장·가림된다", async () => {
    const env = createEnv("https://example.com/");
    env.seedRules("example.com", [
      { id: "r1", hostname: "example.com", scope: "element", selector: "#a", pagePattern: null, createdAt: 1 },
      { id: "r2", hostname: "example.com", scope: "element", selector: "#b", pagePattern: null, createdAt: 2 },
      { id: "r3", hostname: "example.com", scope: "element", selector: "#c", pagePattern: null, createdAt: 3 },
    ]);
    env.loadContentScript({ entitlementOverride: { plan: "pro", source: "developer", isPro: true } });
    await wait(30);

    const el = env.document.createElement("div");
    el.id = "d";
    env.document.body.appendChild(el);
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(el, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("example.com").length === 4);
    await waitUntil(() => el.classList.contains("cloakli-masked"));

    assert.equal(env.getStoredRules("example.com").length, 4, "Developer Pro는 4번째 규칙도 저장할 수 있어야 한다");
    assert.equal(el.classList.contains("cloakli-masked"), true, "Developer Pro는 4번째 요소도 정상적으로 가려져야 한다");
  });

  test("Pro 상태의 범위 선택 UI에는 page/site에 PRO 배지가 없다", async () => {
    const env = createEnv("https://example.com/list");
    const container = env.document.createElement("div");
    env.document.body.appendChild(container);
    for (let i = 0; i < 3; i++) {
      const c = env.document.createElement("h3");
      c.className = "video-title";
      container.appendChild(c);
    }
    env.loadContentScript({ entitlementOverride: { plan: "pro", source: "developer", isPro: true } });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(container.children[0], "click");

    const picker = env.document.getElementById("cloakli-scope-picker-root");
    const options = picker.children.filter((c) => c.className === "cloakli-scope-picker-option");
    const pageHasBadge = options[1].children.some((c) => c.className === "cloakli-scope-picker-pro-badge");
    const siteHasBadge = options[2].children.some((c) => c.className === "cloakli-scope-picker-pro-badge");
    assert.equal(pageHasBadge, false);
    assert.equal(siteHasBadge, false);
  });

  test("무료 상태의 범위 선택 UI에는 page/site에 PRO 배지가 표시된다", async () => {
    const env = createEnv("https://example.com/list");
    const container = env.document.createElement("div");
    env.document.body.appendChild(container);
    for (let i = 0; i < 3; i++) {
      const c = env.document.createElement("h3");
      c.className = "video-title";
      container.appendChild(c);
    }
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(container.children[0], "click");

    const picker = env.document.getElementById("cloakli-scope-picker-root");
    const options = picker.children.filter((c) => c.className === "cloakli-scope-picker-option");
    const pageHasBadge = options[1].children.some((c) => c.className === "cloakli-scope-picker-pro-badge");
    const siteHasBadge = options[2].children.some((c) => c.className === "cloakli-scope-picker-pro-badge");
    assert.equal(pageHasBadge, true);
    assert.equal(siteHasBadge, true);
  });

  test("무료 상태에서도 이미 저장되어 있던 page/site 규칙은 계속 적용된다 (기존 규칙 보호)", async () => {
    const env = createEnv("https://www.youtube.com/watch?v=AAA");
    env.seedRules("www.youtube.com", [
      {
        id: "r1",
        hostname: "www.youtube.com",
        scope: "page",
        selector: "h3.video-title",
        pagePattern: "/watch",
        createdAt: 1,
      },
      { id: "r2", hostname: "www.youtube.com", scope: "site", selector: "#legacy-site-rule", pagePattern: null, createdAt: 2 },
    ]);
    const title = env.document.createElement("h3");
    title.className = "video-title";
    env.document.body.appendChild(title);
    const legacy = env.document.createElement("div");
    legacy.id = "legacy-site-rule";
    env.document.body.appendChild(legacy);

    env.loadContentScript(); // 기본값(무료) 상태에서도
    await wait(50);

    assert.equal(title.classList.contains("cloakli-masked"), true, "기존 page 규칙은 무료 상태에서도 계속 적용되어야 한다");
    assert.equal(legacy.classList.contains("cloakli-masked"), true, "기존 site 규칙은 무료 상태에서도 계속 적용되어야 한다");
  });

  test("무료 상태에서도 page/site 규칙을 포함해 규칙 삭제/관리는 요금제와 무관하게 동작한다", async () => {
    const env = createEnv("https://www.youtube.com/watch?v=AAA");
    env.seedRules("www.youtube.com", [
      {
        id: "r1",
        hostname: "www.youtube.com",
        scope: "page",
        selector: "h3.video-title",
        pagePattern: "/watch",
        createdAt: 1,
      },
    ]);
    env.loadContentScript();
    await wait(30);

    await new Promise((resolve) => env.chrome.storage.local.set({ cloakliRules: {} }, resolve));
    await wait(80);

    assert.equal(
      env.getStoredRules("www.youtube.com").length,
      0,
      "무료 상태에서도 규칙 삭제는 요금제와 무관하게 동작해야 한다"
    );
  });
});
