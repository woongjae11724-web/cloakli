// YouTube 롱폼/Shorts 썸네일과 유사한 로컬 fixture로, 10단계에서 고친 버그(하나만
// 선택해도 여러 썸네일이 함께 가려짐 / 클릭 불가 / hover에만 HIDDEN이 보임)의 재발을
// 막는다. content.js/content-core.js 소스는 한 줄도 바꾸지 않고 fake-browser-env.js
// 위에서 그대로 실행해 검증한다. 제품 코드에는 YouTube 전용 하드코딩을 넣지 않았으므로,
// 여기서 만드는 구조도 "반복되는 카드 목록"이라는 일반적인 형태일 뿐이다.
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createEnv, wait, waitUntil } = require("./helpers/fake-browser-env");

const PRO_ENTITLEMENT = { plan: "pro", source: "developer", isPro: true };

// img/input 등 "자식을 가질 수 없는" 태그는 maskElement()가 <span class="cloakli-mask-wrapper">로
// 감싸고 MASKED_CLASS를 그 래퍼에 붙인다(원본 img 자신에는 붙이지 않는다). 그래서 가림 여부를
// 확인할 때는 요소 자신과 그 부모(래퍼일 수 있음) 둘 다 확인해야 한다.
function isMasked(el) {
  if (!el) return false;
  if (el.classList.contains("cloakli-masked")) return true;
  return !!(el.parentNode && el.parentNode.classList && el.parentNode.classList.contains("cloakli-masked"));
}

// index: 0="이 요소만", 1="현재 페이지의 같은 종류 모두", 2="이 사이트의 같은 종류 모두"
function chooseScopeOption(env, index) {
  const root = env.document.getElementById("cloakli-scope-picker-root");
  if (!root) throw new Error("범위 선택 UI가 열려 있지 않습니다");
  const buttons = root.children.filter((c) => c.tagName === "BUTTON" && c.className === "cloakli-scope-picker-option");
  const target = buttons[index];
  if (!target) throw new Error("범위 선택 버튼을 찾지 못했습니다 (index " + index + ")");
  env.dispatch(target, "click");
}

// 카드 하나를 만든다. 중요: 내부 구성요소의 태그/class(thumbnail-link/thumbnail-visual/
// title-link/title-text/channel-link/channel-name-text)는 롱폼과 Shorts가 "완전히 동일"하다 -
// 실제 YouTube도 내부 구성요소 이름은 카드 종류와 무관하게 같을 수 있으므로, 반복되는 카드
// 자체(root)의 class가 다르다는 것만으로 role+family가 구분되는지 검증하기 위함이다.
function buildCard(env, rootClass, hrefPrefix, index) {
  const card = env.document.createElement("div");
  card.className = rootClass;

  const link = env.document.createElement("a");
  link.className = "thumbnail-link";
  link.setAttribute("href", hrefPrefix + index);
  const img = env.document.createElement("img");
  img.className = "thumbnail-visual";
  link.appendChild(img);

  const titleLink = env.document.createElement("a");
  titleLink.className = "title-link";
  titleLink.setAttribute("href", hrefPrefix + index);
  const title = env.document.createElement("span");
  title.className = "title-text";
  title.textContent = "video title " + index;
  titleLink.appendChild(title);

  const channelLink = env.document.createElement("a");
  channelLink.className = "channel-link";
  channelLink.setAttribute("href", "/channel/ch-" + index);
  const channel = env.document.createElement("span");
  channel.className = "channel-name-text";
  channel.textContent = "channel " + index;
  channelLink.appendChild(channel);

  card.appendChild(link);
  card.appendChild(titleLink);
  card.appendChild(channelLink);
  return { card, link, img, titleLink, title, channelLink, channel };
}

function buildLongFormCard(env, index) {
  return buildCard(env, "longform-card", "/watch?v=video-", index);
}

function buildShortsCard(env, index) {
  return buildCard(env, "shorts-card", "/shorts/short-", index);
}

// 롱폼 카드 longCount개 + Shorts 카드 shortCount개를 담은 fixture를 만든다.
function buildFixture(env, longCount, shortCount) {
  const grid = env.document.createElement("div");
  grid.className = "longform-grid";
  env.document.body.appendChild(grid);

  const longCards = [];
  for (let i = 0; i < longCount; i++) {
    const built = buildLongFormCard(env, i);
    grid.appendChild(built.card);
    longCards.push(built);
  }

  const shortsGrid = env.document.createElement("div");
  shortsGrid.className = "shorts-grid";
  env.document.body.appendChild(shortsGrid);

  const shortsCards = [];
  for (let i = 0; i < shortCount; i++) {
    const built = buildShortsCard(env, i);
    shortsGrid.appendChild(built.card);
    shortsCards.push(built);
  }

  return { grid, longCards, shortsGrid, shortsCards };
}

describe("YouTube 유사 fixture: element 범위 (이 요소만)", () => {
  test("썸네일 카드 10개 중 하나를 선택해 '이 요소만'으로 저장하면 그 하나만 가려진다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 10, 6);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[3].img, "click");
    chooseScopeOption(env, 0); // 이 요소만
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    // 저장 직후 storage.onChanged로 removeAll+재적용 라운드트립이 한 번 더 돌 수 있으므로,
    // 재적용이 안정된(선택 카드가 가려진) 상태가 될 때까지 기다린 뒤에 검사한다.
    await waitUntil(() => isMasked(longCards[3].img));

    const saved = env.getStoredRules("www.youtube.com")[0];
    assert.equal(saved.scope, "element");

    // 선택한 카드의 썸네일만 가려지고, 나머지 9개는 전혀 영향을 받지 않아야 한다.
    longCards.forEach((c, i) => {
      assert.equal(isMasked(c.img), i === 3, `카드 ${i}의 가림 상태가 예상과 다르다`);
    });

    // selector는 (마스킹으로 img가 래퍼에 감싸이기 전, 저장 시점 기준) 문서에서 정확히
    // 이 카드 하나만 가리키도록 만들어졌어야 한다 - 새 문서에 같은 규칙만 다시 적용하는
    // 다음 테스트("새로고침")가 이를 실제로 검증한다.
  });

  test("Shorts 하나만 선택해 '이 요소만'으로 저장하면 그 하나만 가려지고 롱폼에는 영향이 없다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards, shortsCards } = buildFixture(env, 10, 8);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(shortsCards[4].img, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(shortsCards[4].img));

    const saved = env.getStoredRules("www.youtube.com")[0];
    assert.equal(saved.scope, "element");

    shortsCards.forEach((c, i) => {
      assert.equal(isMasked(c.img), i === 4, `Shorts 카드 ${i}의 가림 상태가 예상과 다르다`);
    });
    longCards.forEach((c, i) => {
      assert.equal(isMasked(c.img), false, `롱폼 카드 ${i}가 Shorts element 규칙에 영향을 받으면 안 된다`);
    });
  });

  test("새로고침(재적용) 후에도 저장된 카드 하나만 다시 가려지고 나머지는 그대로다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 10, 6);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[7].img, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    const savedRule = env.getStoredRules("www.youtube.com")[0];

    // "새로고침"을 흉내낸다: 완전히 새 문서를 만들고 저장된 규칙만 재적용한다.
    const env2 = createEnv("https://www.youtube.com/");
    const fixture2 = buildFixture(env2, 10, 6);
    env2.seedRules("www.youtube.com", [savedRule]);
    env2.loadContentScript();
    await wait(30);

    fixture2.longCards.forEach((c, i) => {
      assert.equal(isMasked(c.img), i === 7, `새로고침 후 카드 ${i}의 가림 상태가 예상과 다르다`);
    });
  });

  test("selector가 문서에서 2개 이상과 일치하게 되면(무한 스크롤 등) 아무 것도 가리지 않는다", async () => {
    // 실제로는 절대 만들어지지 않아야 하지만(요구사항 2), 혹시라도 예전에 저장된 넓은
    // selector(예: 카드마다 재사용되는 id)가 있다면 재적용 시점에 안전하게 무시되어야 한다.
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 5, 0);
    // 카드마다 완전히 같은 id="thumbnail"을 부여해, 실제 YouTube에서 보고된 것과 같은
    // (id가 카드마다 재사용되는) 위험한 규칙을 재현한다.
    longCards.forEach((c) => c.link.id = "thumbnail");
    env.seedRules("www.youtube.com", [
      { id: "r1", hostname: "www.youtube.com", scope: "element", selector: "#thumbnail", pagePattern: null, createdAt: 1 },
    ]);
    env.loadContentScript();
    await wait(30);

    longCards.forEach((c, i) => {
      assert.equal(c.link.classList.contains("cloakli-masked"), false, `카드 ${i}가 잘못 가려지면 안 된다`);
    });
  });
});

describe("YouTube 유사 fixture: page/site 범위 (같은 종류 모두)", () => {
  test("썸네일 이미지 영역만 가리고, 제목/채널명/카드 전체는 가리지 않는다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 10, 6);
    env.loadContentScript({ entitlementOverride: PRO_ENTITLEMENT });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[0].img, "click");
    chooseScopeOption(env, 2); // 이 사이트의 같은 종류 모두
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => longCards.every((c) => isMasked(c.img)));

    longCards.forEach((c, i) => {
      assert.equal(isMasked(c.img), true, `카드 ${i}의 썸네일 이미지가 가려져야 한다`);
      assert.equal(c.title.classList.contains("cloakli-masked"), false, `카드 ${i}의 제목은 가려지면 안 된다`);
      assert.equal(c.channel.classList.contains("cloakli-masked"), false, `카드 ${i}의 채널명은 가려지면 안 된다`);
      assert.equal(c.card.classList.contains("cloakli-masked"), false, `카드 ${i} 전체가 가려지면 안 된다`);
      assert.equal(c.link.classList.contains("cloakli-masked"), false, `카드 ${i}의 링크 전체가 가려지면 안 된다`);
    });
  });

  test("롱폼 썸네일을 선택해 저장해도 Shorts 카드에는 영향이 없다 (구조가 다르므로 섞이지 않는다)", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards, shortsCards } = buildFixture(env, 10, 6);
    env.loadContentScript({ entitlementOverride: PRO_ENTITLEMENT });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[0].img, "click");
    chooseScopeOption(env, 2);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(longCards[0].img));

    shortsCards.forEach((c, i) => {
      assert.equal(isMasked(c.img), false, `Shorts 카드 ${i}가 롱폼 규칙에 영향을 받으면 안 된다`);
    });
  });

  test("Shorts 썸네일을 선택해 저장해도 롱폼 카드에는 영향이 없다 (내부 이미지 class가 같아도 구분된다)", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards, shortsCards } = buildFixture(env, 10, 8);
    env.loadContentScript({ entitlementOverride: PRO_ENTITLEMENT });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(shortsCards[0].img, "click");
    chooseScopeOption(env, 2); // 이 사이트의 같은 종류 모두
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => shortsCards.every((c) => isMasked(c.img)));

    const saved = env.getStoredRules("www.youtube.com")[0];
    // 내부 이미지 class("thumbnail-visual")는 롱폼과 완전히 같지만, selector에는 반복 루트
    // (shorts-card)의 구분이 포함되어 있어야 한다.
    assert.match(saved.selector, /shorts-card/, "selector에 Shorts 반복 루트가 포함되어야 한다");
    assert.ok(!/longform-card/.test(saved.selector), "selector에 롱폼 반복 루트가 섞이면 안 된다");
    assert.equal(saved.role, "thumbnail", "규칙에 role이 저장되어야 한다");
    assert.equal(saved.family, "shorts-card", "규칙에 family가 저장되어야 한다");

    shortsCards.forEach((c, i) => {
      assert.equal(isMasked(c.img), true, `Shorts 카드 ${i}의 썸네일이 가려져야 한다`);
    });
    longCards.forEach((c, i) => {
      assert.equal(isMasked(c.img), false, `롱폼 카드 ${i}가 Shorts 규칙에 영향을 받으면 안 된다`);
    });
  });

  test("링크(카드) 전체를 클릭해도 그 안의 이미지만 대상이 되고, 링크 자체는 가림 대상에서 제외된다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 8, 0);
    env.loadContentScript({ entitlementOverride: PRO_ENTITLEMENT });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    // 썸네일 이미지가 아니라 그 이미지를 감싸는 <a> 링크 자체를 클릭한 경우를 재현한다.
    env.dispatch(longCards[2].link, "click");
    chooseScopeOption(env, 1); // 현재 페이지의 같은 종류 모두

    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => longCards.every((c) => isMasked(c.img)));
    const saved = env.getStoredRules("www.youtube.com")[0];
    assert.ok(!/^a[.#\[]|^a$/i.test(saved.selector.trim()), "링크(a) 전체를 대상으로 하는 selector면 안 된다");

    longCards.forEach((c) => {
      assert.equal(c.link.classList.contains("cloakli-masked"), false, "링크 전체가 가려지면 안 된다");
      assert.equal(isMasked(c.img), true, "링크 안의 이미지는 가려져야 한다");
    });
  });
});

describe("YouTube 유사 fixture: 클릭 가능성 (가림 레이어가 실제 링크로 클릭을 전달한다)", () => {
  function findOverlay(img) {
    return img.parentNode.childNodes.find((n) => n.classList && n.classList.contains("cloakli-mask-overlay"));
  }

  test("일반 클릭(왼쪽 클릭)은 같은 탭에서 원래 링크로 이동한다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 5, 0);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[1].img, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(longCards[1].img));

    const overlay = findOverlay(longCards[1].img);
    assert.ok(overlay, "오버레이가 생성되어야 한다");

    env.dispatch(overlay, "click", { button: 0 });
    assert.match(env.sandbox.location.href, /\/watch\?v=video-1$/, "일반 클릭은 원래 링크 주소로 이동해야 한다");
    assert.equal(env.windowOpenCalls.length, 0, "일반 클릭은 새 탭을 열면 안 된다");
  });

  test("ctrl+클릭/중간 클릭은 새 탭으로 연다(기존 링크 동작 유지)", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 5, 0);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[2].img, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(longCards[2].img));

    const overlay = findOverlay(longCards[2].img);

    env.dispatch(overlay, "click", { button: 0, ctrlKey: true });
    assert.equal(env.windowOpenCalls.length, 1, "ctrl+클릭은 새 탭을 열어야 한다");
    assert.match(env.windowOpenCalls[0].url, /\/watch\?v=video-2$/);

    env.dispatch(overlay, "auxclick", { button: 1 });
    assert.equal(env.windowOpenCalls.length, 2, "중간 클릭도 새 탭을 열어야 한다");
    assert.match(env.windowOpenCalls[1].url, /\/watch\?v=video-2$/);
  });

  test("maskElement()는 원본 요소의 pointer-events/display를 건드리지 않는다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 5, 0);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[1].img, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(longCards[1].img));

    const link = longCards[1].link;
    assert.equal(link.style.pointerEvents, undefined, "원래 링크의 pointer-events를 건드리면 안 된다");
    assert.equal(link.style.display, undefined, "원래 링크를 display:none으로 숨기면 안 된다");
  });
});

describe("YouTube 유사 fixture: 항상 가림 (hover에 의존하지 않는다)", () => {
  test("가림 직후, mouseenter/mouseleave를 흉내내도 masked 클래스는 그대로 유지된다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 5, 0);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[0].img, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(longCards[0].img));

    const container = longCards[0].img.parentNode.classList.contains("cloakli-masked") ? longCards[0].img.parentNode : longCards[0].img;
    assert.equal(container.classList.contains("cloakli-masked"), true);

    env.dispatch(longCards[0].img, "mouseenter");
    assert.equal(container.classList.contains("cloakli-masked"), true, "mouseenter 후에도 가려진 상태여야 한다");

    env.dispatch(longCards[0].img, "mouseleave");
    assert.equal(container.classList.contains("cloakli-masked"), true, "mouseleave 후에도 가려진 상태여야 한다");
  });
});

describe("YouTube 유사 fixture: hover 선택 모드 (미리보기)", () => {
  test("선택 모드에서 hover한 카드 하나에만 파란 outline이 표시되고, 다른 카드는 실제로 가려지지 않는다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 6, 0);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[2].img, "mouseover");

    assert.equal(longCards[2].img.classList.contains("cloakli-highlight"), true, "hover한 요소에만 outline이 있어야 한다");
    longCards.forEach((c, i) => {
      if (i === 2) return;
      assert.equal(c.img.classList.contains("cloakli-highlight"), false, `카드 ${i}에는 outline이 없어야 한다`);
      assert.equal(c.img.classList.contains("cloakli-masked"), false, `hover만으로 카드 ${i}가 가려지면 안 된다`);
    });
    assert.equal(env.getStoredRules("www.youtube.com").length, 0, "scope를 선택하기 전에는 아무 것도 저장되면 안 된다");
  });

  test("클릭 후 범위 선택 UI가 열린 상태에서 미리보기(outline)만 표시되고, 아직 storage에는 아무 것도 저장되지 않는다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 6, 0);
    env.loadContentScript({ entitlementOverride: PRO_ENTITLEMENT });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[0].img, "click");

    // picker가 열려 있는 동안에는 실제 가림(cloakli-masked)이 아직 생기면 안 된다.
    longCards.forEach((c, i) => {
      assert.equal(c.img.classList.contains("cloakli-masked"), false, `범위를 고르기 전에 카드 ${i}가 가려지면 안 된다`);
    });
    assert.equal(env.getStoredRules("www.youtube.com").length, 0);

    // 취소하면 미리보기(outline)도 모두 사라진다.
    const picker = env.document.getElementById("cloakli-scope-picker-root");
    const cancelBtn = picker.children.find((c) => c.className === "cloakli-scope-picker-cancel");
    env.dispatch(cancelBtn, "click");
    longCards.forEach((c) => {
      assert.equal(c.img.classList.contains("cloakli-preview-outline"), false);
    });
  });
});

describe("YouTube 유사 fixture: 동적 카드 추가 (무한 스크롤)에도 element 범위는 안전하다", () => {
  test("element 범위로 저장한 뒤 카드가 더 늘어나도, 저장한 카드 하나만 계속 가려진다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { grid, longCards } = buildFixture(env, 5, 0);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[1].img, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(longCards[1].img));

    // 무한 스크롤로 구조가 완전히 같은 카드가 5개 더 추가된다.
    const newCards = [];
    for (let i = 5; i < 10; i++) {
      const built = buildLongFormCard(env, i);
      grid.appendChild(built.card);
      newCards.push(built);
    }
    env.flushMutations();
    await wait(650); // debounce(300ms) 대기

    assert.equal(isMasked(longCards[1].img), true, "원래 저장한 카드는 계속 가려져 있어야 한다");
    [...longCards.filter((_, i) => i !== 1), ...newCards].forEach((c, idx) => {
      assert.equal(isMasked(c.img), false, `카드 ${idx}는 가려지면 안 된다`);
    });
  });
});

// 이번 단계(역할/종류 분류)에서 추가된 대상별 선택 테스트: 썸네일·제목·채널명을 각각
// 독립적으로 정확히 선택/가림할 수 있어야 한다.
describe("YouTube 유사 fixture: 영상 제목 선택", () => {
  test("제목 링크를 클릭하면 실제 제목 텍스트 요소가 대상이 되고, '이 요소만'은 그 제목 하나만 가린다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 10, 6);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[2].titleLink, "click");

    // 인식된 대상이 "제목"으로 표시된다.
    const picker = env.document.getElementById("cloakli-scope-picker-root");
    const targetLine = picker.children.find((c) => c.className === "cloakli-scope-picker-target");
    assert.ok(targetLine, "선택한 대상 표시가 있어야 한다");
    assert.match(targetLine.textContent, /제목/);

    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(longCards[2].title));

    const saved = env.getStoredRules("www.youtube.com")[0];
    assert.equal(saved.role, "title");
    assert.equal(saved.family, "longform-card");

    // 제목 텍스트 요소만 가려지고, 주변 wrapper/썸네일/채널명은 그대로다.
    longCards.forEach((c, i) => {
      assert.equal(isMasked(c.title), i === 2, `카드 ${i}의 제목 가림 상태가 예상과 다르다`);
      assert.equal(c.titleLink.classList.contains("cloakli-masked"), false, "제목 링크 전체가 가려지면 안 된다");
      assert.equal(isMasked(c.img), false, "썸네일은 영향받으면 안 된다");
      assert.equal(isMasked(c.channel), false, "채널명은 영향받으면 안 된다");
      assert.equal(c.card.classList.contains("cloakli-masked"), false, "카드 전체가 가려지면 안 된다");
    });
  });

  test("제목의 page 범위는 같은 family의 제목만 가린다 (썸네일/채널명/Shorts 제목 제외)", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards, shortsCards } = buildFixture(env, 10, 8);
    env.loadContentScript({ entitlementOverride: PRO_ENTITLEMENT });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[0].title, "click");
    chooseScopeOption(env, 1); // 현재 페이지 유형의 같은 요소
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => longCards.every((c) => isMasked(c.title)));

    longCards.forEach((c, i) => {
      assert.equal(isMasked(c.title), true, `롱폼 카드 ${i}의 제목이 가려져야 한다`);
      assert.equal(isMasked(c.img), false, `롱폼 카드 ${i}의 썸네일은 가려지면 안 된다`);
      assert.equal(isMasked(c.channel), false, `롱폼 카드 ${i}의 채널명은 가려지면 안 된다`);
    });
    shortsCards.forEach((c, i) => {
      assert.equal(isMasked(c.title), false, `Shorts 카드 ${i}의 제목은 가려지면 안 된다 (family가 다름)`);
    });
  });
});

describe("YouTube 유사 fixture: 채널명 선택", () => {
  test("채널명을 클릭하면 '이 요소만' 버튼이 활성화되고, 해당 채널명 하나만 가린다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 10, 6);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[5].channel, "click");

    const picker = env.document.getElementById("cloakli-scope-picker-root");
    const buttons = picker.children.filter((c) => c.tagName === "BUTTON" && c.className === "cloakli-scope-picker-option");
    assert.ok(!buttons[0].disabled, "'이 요소만' 버튼이 활성화되어야 한다");

    const targetLine = picker.children.find((c) => c.className === "cloakli-scope-picker-target");
    assert.match(targetLine.textContent, /채널명/);

    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(longCards[5].channel));

    const saved = env.getStoredRules("www.youtube.com")[0];
    assert.equal(saved.role, "channel-name");

    longCards.forEach((c, i) => {
      assert.equal(isMasked(c.channel), i === 5, `카드 ${i}의 채널명 가림 상태가 예상과 다르다`);
      assert.equal(isMasked(c.title), false, "제목은 영향받으면 안 된다");
      assert.equal(isMasked(c.img), false, "썸네일은 영향받으면 안 된다");
    });
  });

  test("채널명의 site 범위는 같은 family의 채널명만 가린다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards, shortsCards } = buildFixture(env, 10, 8);
    env.loadContentScript({ entitlementOverride: PRO_ENTITLEMENT });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[0].channel, "click");
    chooseScopeOption(env, 2);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => longCards.every((c) => isMasked(c.channel)));

    longCards.forEach((c, i) => {
      assert.equal(isMasked(c.channel), true, `롱폼 카드 ${i}의 채널명이 가려져야 한다`);
      assert.equal(isMasked(c.title), false, `롱폼 카드 ${i}의 제목은 가려지면 안 된다`);
    });
    shortsCards.forEach((c, i) => {
      assert.equal(isMasked(c.channel), false, `Shorts 카드 ${i}의 채널명은 가려지면 안 된다`);
    });
  });
});

describe("YouTube 유사 fixture: role 분류와 범위 버튼 독립성", () => {
  test("썸네일 규칙에는 role=thumbnail, family=longform-card가 저장된다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 10, 0);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[0].img, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);

    const saved = env.getStoredRules("www.youtube.com")[0];
    assert.equal(saved.role, "thumbnail");
    assert.equal(saved.family, "longform-card");
  });

  test("일반화 selector 생성이 불가능해도 '이 요소만' 버튼은 활성화된다", async () => {
    const env = createEnv("https://example.com/");
    // 반복 구조/class 없는 고유 id 요소: element selector는 성공, 일반화는 실패해야 한다.
    const widget = env.document.createElement("div");
    widget.id = "unique-widget";
    env.document.body.appendChild(widget);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(widget, "click");

    const picker = env.document.getElementById("cloakli-scope-picker-root");
    const buttons = picker.children.filter((c) => c.tagName === "BUTTON" && c.className === "cloakli-scope-picker-option");
    assert.ok(!buttons[0].disabled, "element 버튼은 일반화 실패와 무관하게 활성화되어야 한다");
    assert.equal(buttons[1].disabled, true, "일반화 실패 시 page 버튼은 비활성화된다");
    assert.equal(buttons[2].disabled, true, "일반화 실패 시 site 버튼은 비활성화된다");
  });

  test("저장 후 다른 썸네일에 mouseover해도 HIDDEN 가림이 새로 생기지 않는다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { longCards } = buildFixture(env, 6, 0);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(longCards[0].img, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(longCards[0].img));

    // 선택 모드가 끝난 뒤 다른 썸네일 위로 마우스를 움직여도(hover) 아무 일도 일어나지 않는다.
    for (let i = 1; i < 6; i++) {
      env.dispatch(longCards[i].img, "mouseover");
      env.dispatch(longCards[i].img, "mouseout");
      assert.equal(isMasked(longCards[i].img), false, `카드 ${i}에 hover만으로 가림이 생기면 안 된다`);
    }
    assert.equal(isMasked(longCards[0].img), true, "저장된 가림은 hover와 무관하게 유지된다");
  });
});
