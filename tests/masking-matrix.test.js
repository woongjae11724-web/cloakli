// 요소 가림 정확도 매트릭스 (출시 전 안정화).
//
// "클릭한 것만 정확히 가려진다"를 요소 종류별로 검증한다: 일반 텍스트 / 이미지 / 버튼 /
// 링크 / 사이드바 카드와 메인 카드 분리 / SPA에서 나중에 생성된 요소 / mouseleave 후
// 가림 유지 / legacy 광범위 규칙의 자동 적용 차단 / "이 요소만"의 독립성.
// (제목·채널명·썸네일·롱폼/Shorts 분리는 youtube-thumbnail.test.js가, Gmail 날짜와 hover
// 변화는 frozen-selection.test.js가 담당한다 — 여기서 중복하지 않는다.)
//
// content.js/content-core.js 소스는 한 줄도 바꾸지 않고 fake-browser-env 위에서 실행하며,
// 각 시나리오는 실제 사용 순서(선택 시작 → 클릭 → 범위 선택 → 저장 → 새로고침 재적용)를
// 그대로 따른다.
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createEnv, wait, waitUntil } = require("./helpers/fake-browser-env");

const PRO = { plan: "pro", source: "license_server", isPro: true };
const HOST = "matrix.example.com";
const PAGE_URL = "https://" + HOST + "/feed";

function isMasked(el) {
  if (!el) return false;
  if (el.classList.contains("cloakli-masked")) return true;
  return !!(el.parentNode && el.parentNode.classList && el.parentNode.classList.contains("cloakli-masked"));
}

function hasOwnOverlay(el) {
  const container =
    el.parentNode && el.parentNode.classList && el.parentNode.classList.contains("cloakli-mask-wrapper")
      ? el.parentNode
      : el;
  return !!(container.querySelector && container.querySelector(":scope > .cloakli-mask-overlay"));
}

function scopeButtons(env) {
  const root = env.document.getElementById("cloakli-scope-picker-root");
  if (!root) throw new Error("범위 선택 UI가 열려 있지 않습니다");
  return root.children.filter((c) => c.tagName === "BUTTON" && c.className === "cloakli-scope-picker-option");
}

function chooseScopeOption(env, index) {
  const target = scopeButtons(env)[index];
  if (!target) throw new Error("범위 선택 버튼을 찾지 못했습니다 (index " + index + ")");
  env.dispatch(target, "click");
}

// 선택 시작 → 요소 클릭까지 실제 흐름 그대로 진행한다.
async function clickInSelectionMode(env, el) {
  await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
  env.dispatch(el, "click");
}

// 공통 fixture: 텍스트 문단 / 단독 이미지 / 버튼 / 텍스트 링크 + 메인 카드 3장 + 사이드바 카드 3장.
function buildMatrixFixture(env) {
  const doc = env.document;
  const page = doc.createElement("div");
  page.className = "page-shell";

  const intro = doc.createElement("p");
  intro.className = "intro-text";
  intro.textContent = "hello this is plain text";

  const hero = doc.createElement("img");
  hero.className = "hero-image";
  hero.setAttribute("src", "/hero.png");

  const buyBtn = doc.createElement("button");
  buyBtn.className = "buy-button";
  buyBtn.textContent = "Buy now";

  const promoLink = doc.createElement("a");
  promoLink.className = "promo-link";
  promoLink.setAttribute("href", "/promo");
  promoLink.textContent = "promo text link";

  const main = doc.createElement("div");
  main.className = "main-grid";
  const mainCards = [];
  for (let i = 0; i < 3; i++) {
    const card = doc.createElement("div");
    card.className = "feed-card";
    const link = doc.createElement("a");
    link.className = "thumb-link";
    link.setAttribute("href", "/watch/" + i);
    const img = doc.createElement("img");
    img.className = "thumb-visual";
    link.appendChild(img);
    const title = doc.createElement("span");
    title.className = "card-title";
    title.textContent = "card title " + i;
    card.appendChild(link);
    card.appendChild(title);
    main.appendChild(card);
    mainCards.push({ card, link, img, title });
  }

  // 사이드바: 반복 루트 class만 다르고 내부 구조(class)는 메인과 동일하다.
  const sidebar = doc.createElement("div");
  sidebar.className = "side-column";
  const sideCards = [];
  for (let i = 0; i < 3; i++) {
    const card = doc.createElement("div");
    card.className = "side-card";
    const link = doc.createElement("a");
    link.className = "thumb-link";
    link.setAttribute("href", "/side/" + i);
    const img = doc.createElement("img");
    img.className = "thumb-visual";
    link.appendChild(img);
    const title = doc.createElement("span");
    title.className = "card-title";
    title.textContent = "side title " + i;
    card.appendChild(link);
    card.appendChild(title);
    sidebar.appendChild(card);
    sideCards.push({ card, link, img, title });
  }

  page.appendChild(intro);
  page.appendChild(hero);
  page.appendChild(buyBtn);
  page.appendChild(promoLink);
  page.appendChild(main);
  page.appendChild(sidebar);
  doc.body.appendChild(page);

  return { page, intro, hero, buyBtn, promoLink, main, mainCards, sidebar, sideCards };
}

function newLoadedEnv() {
  const env = createEnv(PAGE_URL);
  const fixture = buildMatrixFixture(env);
  env.loadContentScript({ entitlementOverride: PRO });
  return { env, fixture };
}

// "새로고침"을 모의한다: 같은 규칙 storage로 완전히 새로운 문서/컨텍스트를 만들어
// 저장 규칙이 자동 재적용되는지 확인한다.
function reloadWithSameRules(env) {
  const env2 = createEnv(PAGE_URL);
  const fixture2 = buildMatrixFixture(env2);
  env2.seedRules(HOST, JSON.parse(JSON.stringify(env.getStoredRules(HOST))));
  env2.loadContentScript({ entitlementOverride: PRO });
  return { env: env2, fixture: fixture2 };
}

describe("가림 매트릭스: 요소 종류별 '이 요소만'", () => {
  test("일반 텍스트 문단: 클릭한 문단만 가려지고, 규칙에 role/선택자/fingerprint가 저장되며, 새로고침 후 재적용된다", async () => {
    const { env, fixture } = newLoadedEnv();
    await wait(20);

    await clickInSelectionMode(env, fixture.intro);
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules(HOST).length === 1);
    // 저장 직후 storage.onChanged 재동기화(제거→재적용)가 비동기로 한 번 더 돌므로, 재적용 완료까지 기다린다.
    await waitUntil(() => isMasked(fixture.intro));

    const rule = env.getStoredRules(HOST)[0];
    assert.equal(rule.scope, "element");
    assert.equal(rule.role, "generic-text", "역할이 텍스트로 분류되어야 한다");
    assert.ok(rule.selector && rule.selector.includes("intro-text"), "저장된 selector: " + rule.selector);
    assert.ok(rule.fingerprint, "fingerprint가 저장되어야 한다");
    assert.ok(!JSON.stringify(rule).includes("hello this is plain text"), "규칙에 텍스트 원문을 저장하면 안 된다");

    assert.equal(isMasked(fixture.intro), true, "클릭한 문단이 가려져야 한다");
    assert.equal(isMasked(fixture.page), false, "상위 컨테이너는 가려지면 안 된다");
    assert.equal(isMasked(fixture.buyBtn), false);

    const reloaded = reloadWithSameRules(env);
    await waitUntil(() => isMasked(reloaded.fixture.intro));
    assert.equal(isMasked(reloaded.fixture.hero), false, "다른 요소는 재적용되면 안 된다");
  });

  test("단독 이미지: 이미지 자신만 가려지고(HIDDEN 오버레이), 새로고침 후에도 이미지만 재적용된다", async () => {
    const { env, fixture } = newLoadedEnv();
    await wait(20);

    await clickInSelectionMode(env, fixture.hero);
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules(HOST).length === 1);
    await waitUntil(() => isMasked(fixture.hero));

    assert.equal(env.getStoredRules(HOST)[0].role, "generic-image");
    assert.equal(isMasked(fixture.hero), true, "이미지가 가려져야 한다");
    assert.equal(hasOwnOverlay(fixture.hero), true, "HIDDEN 오버레이가 있어야 한다");
    assert.equal(isMasked(fixture.intro), false);

    const reloaded = reloadWithSameRules(env);
    await waitUntil(() => isMasked(reloaded.fixture.hero));
    assert.equal(isMasked(reloaded.fixture.mainCards[0].img), false, "카드 썸네일까지 가려지면 안 된다");
  });

  test("버튼: 클릭한 버튼만 가려진다", async () => {
    const { env, fixture } = newLoadedEnv();
    await wait(20);

    await clickInSelectionMode(env, fixture.buyBtn);
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules(HOST).length === 1);
    await waitUntil(() => isMasked(fixture.buyBtn));

    assert.equal(isMasked(fixture.buyBtn), true);
    assert.equal(isMasked(fixture.promoLink), false);

    const reloaded = reloadWithSameRules(env);
    await waitUntil(() => isMasked(reloaded.fixture.buyBtn));
  });

  test("텍스트 링크: 링크 텍스트 영역만 가려지고, 오버레이 클릭은 원래 링크로 이동한다", async () => {
    const { env, fixture } = newLoadedEnv();
    await wait(20);

    await clickInSelectionMode(env, fixture.promoLink);
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules(HOST).length === 1);
    await waitUntil(() => isMasked(fixture.promoLink));

    assert.equal(isMasked(fixture.promoLink), true);
    assert.equal(isMasked(fixture.page), false);

    // 가림 오버레이는 클릭을 원래 링크로 전달한다(가림이 사이트 사용을 막지 않음).
    const container = fixture.promoLink;
    const overlay = container.querySelector(":scope > .cloakli-mask-overlay");
    assert.ok(overlay, "오버레이가 있어야 한다");
    env.dispatch(overlay, "click", { button: 0, ctrlKey: true });
    assert.equal(env.windowOpenCalls.length, 1, "ctrl+클릭은 새 탭으로 링크를 열어야 한다");
  });
});

describe("가림 매트릭스: 메인 카드와 사이드바 카드 분리", () => {
  test("메인 카드 썸네일의 page 범위는 메인 카드들만 가리고 사이드바 카드는 건드리지 않는다", async () => {
    const { env, fixture } = newLoadedEnv();
    await wait(20);

    await clickInSelectionMode(env, fixture.mainCards[0].img);
    chooseScopeOption(env, 1); // 현재 페이지 유형의 같은 요소
    await waitUntil(() => env.getStoredRules(HOST).length === 1);
    await waitUntil(() => fixture.mainCards.every((c) => isMasked(c.img)));

    const rule = env.getStoredRules(HOST)[0];
    assert.equal(rule.scope, "page");
    assert.ok(rule.selector.includes("feed-card"), "반복 카드 루트가 selector에 포함되어야 한다: " + rule.selector);

    fixture.mainCards.forEach((c, i) => assert.equal(isMasked(c.img), true, "메인 카드 " + i + " 썸네일은 가려져야 한다"));
    fixture.sideCards.forEach((c, i) => {
      assert.equal(isMasked(c.img), false, "사이드바 카드 " + i + " 썸네일은 가려지면 안 된다");
      assert.equal(isMasked(c.title), false, "사이드바 제목은 가려지면 안 된다");
    });
    fixture.mainCards.forEach((c, i) => assert.equal(isMasked(c.title), false, "메인 카드 제목은 가려지면 안 된다 (" + i + ")"));
  });

  test("사이드바 카드 썸네일의 page 범위는 사이드바만 가리고 메인 카드는 건드리지 않는다", async () => {
    const { env, fixture } = newLoadedEnv();
    await wait(20);

    await clickInSelectionMode(env, fixture.sideCards[1].img);
    chooseScopeOption(env, 1);
    await waitUntil(() => env.getStoredRules(HOST).length === 1);
    await waitUntil(() => fixture.sideCards.every((c) => isMasked(c.img)));

    fixture.sideCards.forEach((c, i) => assert.equal(isMasked(c.img), true, "사이드바 " + i + " 썸네일은 가려져야 한다"));
    fixture.mainCards.forEach((c, i) => assert.equal(isMasked(c.img), false, "메인 카드 " + i + "는 가려지면 안 된다"));
  });
});

describe("가림 매트릭스: SPA에서 나중에 생성된 요소", () => {
  test("페이지 로드 후 동적으로 추가된 요소도 선택·저장할 수 있고, 같은 종류가 늦게 추가되면 자동으로 가려진다", async () => {
    const { env, fixture } = newLoadedEnv();
    await wait(20);

    // 같은 종류(page 범위) 규칙을 먼저 저장한 뒤...
    await clickInSelectionMode(env, fixture.mainCards[0].img);
    chooseScopeOption(env, 1);
    await waitUntil(() => env.getStoredRules(HOST).length === 1);

    // SPA가 나중에 카드를 추가로 렌더링한다.
    const doc = env.document;
    const lateCard = doc.createElement("div");
    lateCard.className = "feed-card";
    const lateLink = doc.createElement("a");
    lateLink.className = "thumb-link";
    lateLink.setAttribute("href", "/watch/late");
    const lateImg = doc.createElement("img");
    lateImg.className = "thumb-visual";
    lateLink.appendChild(lateImg);
    lateCard.appendChild(lateLink);
    fixture.main.appendChild(lateCard);
    env.flushMutations();

    await waitUntil(() => isMasked(lateImg), { timeoutMs: 3000 });
    assert.equal(isMasked(lateImg), true, "늦게 추가된 같은 종류 썸네일도 자동으로 가려져야 한다");

    // 늦게 추가된 요소 자체를 '이 요소만'으로 선택하는 것도 가능해야 한다.
    const lateSolo = doc.createElement("p");
    lateSolo.className = "late-note";
    lateSolo.textContent = "late note";
    fixture.page.appendChild(lateSolo);
    env.flushMutations();

    await clickInSelectionMode(env, lateSolo);
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules(HOST).length === 2);
    await waitUntil(() => isMasked(lateSolo));
    assert.equal(isMasked(lateSolo), true);
  });
});

describe("가림 매트릭스: persistent mask는 hover/mouseleave와 무관하게 유지된다", () => {
  test("가려진 요소 위로 mouseover/mouseout이 일어나도 오버레이가 사라지지 않는다", async () => {
    const { env, fixture } = newLoadedEnv();
    await wait(20);

    await clickInSelectionMode(env, fixture.hero);
    chooseScopeOption(env, 0);
    await waitUntil(() => isMasked(fixture.hero));

    const container = fixture.hero.parentNode; // img는 래퍼로 감싸진다
    env.dispatch(container, "mouseover");
    env.dispatch(container, "mouseout");
    env.dispatch(env.document.body, "mouseover");
    env.dispatch(env.document.body, "mouseout");

    assert.equal(isMasked(fixture.hero), true, "mouseleave 후에도 가림이 유지되어야 한다");
    assert.equal(hasOwnOverlay(fixture.hero), true, "오버레이가 DOM에 남아 있어야 한다");
  });

  test("선택 모드를 시작했다 취소해도(ESC) 기존 persistent mask는 남는다", async () => {
    const { env, fixture } = newLoadedEnv();
    await wait(20);

    await clickInSelectionMode(env, fixture.buyBtn);
    chooseScopeOption(env, 0);
    await waitUntil(() => isMasked(fixture.buyBtn));

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(env.document.body, "keydown", { key: "Escape" });

    assert.equal(isMasked(fixture.buyBtn), true, "선택 취소가 기존 가림을 지우면 안 된다");
  });
});

describe("가림 매트릭스: legacy 광범위 규칙의 자동 적용 차단", () => {
  test("bare 태그(img) site 규칙은 자동 적용이 차단되고, 정상 규칙은 그대로 적용된다", async () => {
    const env = createEnv(PAGE_URL);
    const fixture = buildMatrixFixture(env);
    env.seedRules(HOST, [
      // 이전 버전에서 저장됐을 법한 위험한 규칙: 페이지의 모든 이미지를 가리게 된다.
      { id: "legacy-1", hostname: HOST, scope: "site", selector: "img", pagePattern: null, createdAt: 1 },
      // 정상적인 규칙: 특정 문단 하나.
      { id: "ok-1", hostname: HOST, scope: "site", selector: "p.intro-text", pagePattern: null, createdAt: 2 },
    ]);
    env.loadContentScript({ entitlementOverride: PRO });
    await waitUntil(() => isMasked(fixture.intro));

    assert.equal(isMasked(fixture.hero), false, "bare img 규칙이 이미지를 가리면 안 된다(자동 적용 차단)");
    fixture.mainCards.forEach((c, i) => assert.equal(isMasked(c.img), false, "카드 썸네일 " + i + "도 차단되어야 한다"));
    assert.equal(isMasked(fixture.intro), true, "정상 규칙은 계속 적용되어야 한다");
  });

  test("저장 당시보다 훨씬 많은 요소(50개 초과)와 일치하게 된 page/site 규칙은 자동 적용이 차단된다", async () => {
    const env = createEnv(PAGE_URL);
    const doc = env.document;
    const grid = doc.createElement("div");
    grid.className = "big-grid";
    const cells = [];
    for (let i = 0; i < 60; i++) {
      const cell = doc.createElement("div");
      cell.className = "grid-cell";
      cell.textContent = "cell " + i;
      grid.appendChild(cell);
      cells.push(cell);
    }
    doc.body.appendChild(grid);
    env.seedRules(HOST, [
      { id: "wide-1", hostname: HOST, scope: "site", selector: "div.grid-cell", pagePattern: null, createdAt: 1 },
    ]);
    env.loadContentScript({ entitlementOverride: PRO });
    await wait(50);

    assert.equal(cells.filter(isMasked).length, 0, "일치 요소가 상한을 넘으면 하나도 가리지 않아야 한다");
  });
});

describe("가림 매트릭스: '이 요소만'은 일반화 실패와 무관하게 항상 제공", () => {
  test("안정적 class가 전혀 없는 깊은 구조에서도 '이 요소만' 버튼은 활성화되고, page/site만 비활성화된다", async () => {
    const env = createEnv(PAGE_URL);
    const doc = env.document;
    // class/id가 전혀 없는 bare div 중첩 구조 (일반화 selector를 만들 수 없는 최악의 경우)
    let node = doc.createElement("div");
    doc.body.appendChild(node);
    for (let i = 0; i < 4; i++) {
      const child = doc.createElement("div");
      node.appendChild(child);
      node = child;
    }
    const target = doc.createElement("span");
    target.textContent = "bare deep text";
    node.appendChild(target);
    env.loadContentScript({ entitlementOverride: PRO });
    await wait(20);

    await clickInSelectionMode(env, target);
    const buttons = scopeButtons(env);
    assert.equal(buttons.length, 3);
    assert.ok(!buttons[0].disabled, "'이 요소만' 버튼은 활성화되어야 한다");
    assert.equal(buttons[1].disabled, true, "일반화 불가 시 page 범위는 비활성화");
    assert.equal(buttons[2].disabled, true, "일반화 불가 시 site 범위는 비활성화");

    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules(HOST).length === 1);
    assert.equal(isMasked(target), true, "위치 기반 selector로도 이 요소만 가릴 수 있어야 한다");
  });
});
