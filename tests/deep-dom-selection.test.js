// 깊게 중첩된 최신 웹사이트(YouTube/Instagram DM 유사) DOM에서 "이 요소만" 선택 엔진이
// 실제로 동작하는지 검증한다. 이전에는 unique selector를 얕은 깊이(5단계) 안에서만 찾아
// 깊은 DOM에서는 selector가 null이 되어 버튼이 비활성화되던 문제를, 위치 기반 fallback +
// fingerprint 재적용으로 해결했다. content.js는 한 줄도 바꾸지 않고 fake-browser-env에서 실행한다.
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createEnv, wait, waitUntil } = require("./helpers/fake-browser-env");

const PRO = { plan: "pro", source: "developer", isPro: true };

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

function scopeButtons(env) {
  const root = env.document.getElementById("cloakli-scope-picker-root");
  return root.children.filter((c) => c.tagName === "BUTTON" && c.className === "cloakli-scope-picker-option");
}

function el(env, tag, opts) {
  const node = env.document.createElement(tag);
  opts = opts || {};
  if (opts.id) node.id = opts.id;
  if (opts.className) node.className = opts.className;
  if (opts.href) node.setAttribute("href", opts.href);
  if (opts.src) node.setAttribute("src", opts.src);
  if (opts.role) node.setAttribute("role", opts.role);
  if (opts.text) node.textContent = opts.text;
  return node;
}

function append(parent, ...children) {
  children.forEach((c) => parent.appendChild(c));
  return parent;
}

// 실제 YouTube 홈과 유사하게 "깊게 중첩 + 카드마다 같은 id/class 재사용" 구조를 만든다.
// 제목/채널명/썸네일은 각각 6~8단계 아래에 있고, id(video-title/channel-name/thumbnail/text)와
// class(style-scope ...)는 모든 카드가 공유한다. 유일한 anchor는 최상위 #contents 뿐이다.
// 카드 하나만 만든다(컨테이너는 만들지 않는다). 가상화 목록의 언마운트/재마운트처럼
// "같은 항목(i)"을 다시 만들어 붙이는 시나리오를 테스트에서 재현하기 위해 분리했다.
function buildYouTubeCard(env, i) {
  {
    const card = el(env, "ytd-rich-item-renderer", { className: "style-scope ytd-rich-grid-renderer" });

    // 썸네일: a#thumbnail > yt-image > img.yt-core-image
    const thumbContainer = el(env, "div", { className: "style-scope ytd-rich-grid-media" });
    const thumbLink = el(env, "a", { id: "thumbnail", className: "yt-simple-endpoint", href: "/watch?v=vid-" + i });
    const ytImage = el(env, "yt-image", { className: "style-scope ytd-thumbnail" });
    const img = el(env, "img", { className: "yt-core-image", src: "https://i.ytimg.com/thumb-" + i + ".jpg" });
    append(ytImage, img);
    append(thumbLink, ytImage);
    append(thumbContainer, thumbLink);

    // 상세: 제목/채널명 (깊게 중첩)
    const details = el(env, "div", { id: "details", className: "style-scope ytd-rich-grid-media" });
    const meta = el(env, "div", { id: "meta", className: "style-scope ytd-rich-grid-media" });

    const h3 = el(env, "h3", { className: "style-scope ytd-rich-grid-media" });
    const titleLink = el(env, "a", { id: "video-title-link", className: "yt-simple-endpoint", href: "/watch?v=vid-" + i });
    const title = el(env, "yt-formatted-string", { id: "video-title", className: "style-scope ytd-rich-grid-media", text: "제목 " + i });
    append(titleLink, title);
    append(h3, titleLink);

    const channelName = el(env, "ytd-channel-name", { id: "channel-name", className: "style-scope ytd-rich-grid-media" });
    const chContainer = el(env, "div", { id: "container", className: "style-scope ytd-channel-name" });
    const chTextContainer = el(env, "div", { id: "text-container", className: "style-scope ytd-channel-name" });
    const chText = el(env, "yt-formatted-string", { id: "text", className: "style-scope ytd-channel-name" });
    const chLink = el(env, "a", { className: "yt-simple-endpoint", href: "/@channel-" + i, text: "채널 " + i });
    append(chText, chLink);
    append(chTextContainer, chText);
    append(chContainer, chTextContainer);
    append(channelName, chContainer);

    append(meta, h3, channelName);
    append(details, meta);
    append(card, thumbContainer, details);

    return { card, thumbLink, img, titleLink, title, channelName, chText, chLink };
  }
}

function buildYouTubeDeep(env, count) {
  const contents = el(env, "div", { id: "contents" });
  env.document.body.appendChild(contents);
  const cards = [];
  for (let i = 0; i < count; i++) {
    const built = buildYouTubeCard(env, i);
    append(contents, built.card);
    cards.push(built);
  }
  return { contents, cards };
}

describe("깊은 YouTube 유사 DOM: element 범위 선택이 실제로 동작한다", () => {
  test("깊게 중첩된 영상 제목을 클릭하면 '이 요소만' 버튼이 활성화되고 제목 텍스트 요소 하나만 가려진다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { cards } = buildYouTubeDeep(env, 10);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[4].title, "click");

    const buttons = scopeButtons(env);
    assert.ok(!buttons[0].disabled, "'이 요소만' 버튼이 활성화되어야 한다(깊은 DOM에서도)");

    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(cards[4].title));

    const saved = env.getStoredRules("www.youtube.com")[0];
    assert.equal(saved.scope, "element");
    assert.equal(saved.role, "title");
    assert.ok(saved.selector && saved.selector.length > 0, "element selector가 생성되어야 한다");
    assert.ok(saved.fingerprint, "fingerprint가 저장되어야 한다");

    cards.forEach((c, i) => {
      assert.equal(isMasked(c.title), i === 4, `카드 ${i}의 제목 가림 상태가 예상과 다르다`);
      assert.equal(isMasked(c.img), false, "썸네일은 영향받으면 안 된다");
      assert.equal(isMasked(c.chText), false, "채널명은 영향받으면 안 된다");
      assert.equal(c.card.classList.contains("cloakli-masked"), false, "카드 전체가 가려지면 안 된다");
    });
  });

  test("깊게 중첩된 채널명을 클릭해도 '이 요소만'이 제공되고 해당 채널명 하나만 가려진다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { cards } = buildYouTubeDeep(env, 10);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[6].chText, "click");

    const buttons = scopeButtons(env);
    assert.ok(!buttons[0].disabled, "채널명에서도 '이 요소만' 버튼이 활성화되어야 한다");

    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    // 채널명 텍스트를 실제로 표시하는 최소 요소는 yt-formatted-string(빈 wrapper)이 아니라
    // 그 안의 <a>다. resolveVisualMaskTarget이 wrapper가 아닌 그 <a>를 대상으로 잡아야 한다.
    await waitUntil(() => isMasked(cards[6].chLink));

    const saved = env.getStoredRules("www.youtube.com")[0];
    assert.equal(saved.role, "channel-name");

    cards.forEach((c, i) => {
      assert.equal(isMasked(c.chLink), i === 6, `카드 ${i}의 채널명 가림 상태가 예상과 다르다`);
      assert.equal(isMasked(c.title), false, "제목은 영향받으면 안 된다");
      assert.equal(isMasked(c.img), false, "썸네일은 영향받으면 안 된다");
      assert.equal(c.card.classList.contains("cloakli-masked"), false, "카드 전체가 가려지면 안 된다");
    });
  });

  test("깊게 중첩된 썸네일 이미지를 클릭하면 이미지 하나만 가려지고 링크 전체는 가려지지 않는다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { cards } = buildYouTubeDeep(env, 10);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[2].img, "click");

    const buttons = scopeButtons(env);
    assert.ok(!buttons[0].disabled, "썸네일에서도 '이 요소만' 버튼이 활성화되어야 한다");

    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(cards[2].img));

    cards.forEach((c, i) => {
      assert.equal(isMasked(c.img), i === 2, `카드 ${i}의 썸네일 가림 상태가 예상과 다르다`);
      assert.equal(c.thumbLink.classList.contains("cloakli-masked"), false, "썸네일 링크 전체가 가려지면 안 된다");
    });
  });

  test("클릭한 노드가 채널 링크(a) 안의 텍스트여도 카드 전체가 아니라 텍스트 영역만 잡힌다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { cards } = buildYouTubeDeep(env, 8);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    // 채널 링크(a) 자체를 클릭 - 실제로는 그 안의 텍스트 표시 요소가 대상이 되어야 한다.
    env.dispatch(cards[0].chLink, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);

    assert.equal(cards[0].card.classList.contains("cloakli-masked"), false, "카드 전체가 잡히면 안 된다");
    assert.equal(cards[0].channelName.classList.contains("cloakli-masked"), false, "채널명 컨테이너 전체가 잡히면 안 된다");
  });
});

describe("깊은 YouTube 유사 DOM: fingerprint 재적용", () => {
  test("카드 순서가 바뀌어(앞에 새 카드 삽입) selector가 어긋나도 fingerprint로 원래 제목을 다시 찾는다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { contents, cards } = buildYouTubeDeep(env, 6);
    env.loadContentScript();
    await wait(20);

    // 3번 카드의 제목을 element 범위로 저장한다.
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[3].title, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(cards[3].title));

    const targetTitle = cards[3].title;

    // 무한 스크롤/재렌더링으로 맨 앞에 새 카드(다른 영상)가 삽입되어 nth-of-type 위치가 전부 밀린다.
    const fresh = buildYouTubeCard(env, 99);
    contents.insertBefore(fresh.card, contents.firstElementChild);
    env.flushMutations();
    await wait(650); // 재적용 debounce 대기

    // 위치 기반 selector는 이제 다른 카드를 가리키지만, fingerprint(href 해시)로 원래 제목을
    // 다시 찾아 그 하나만 계속 가려져 있어야 한다.
    assert.equal(isMasked(targetTitle), true, "순서가 바뀌어도 원래 제목이 계속 가려져 있어야 한다");
    // 다른 카드 제목은 가려지지 않는다.
    let otherMasked = 0;
    contents.querySelectorAll("yt-formatted-string#video-title").forEach((t) => {
      if (t !== targetTitle && isMasked(t)) otherMasked++;
    });
    assert.equal(otherMasked, 0, "다른 카드 제목이 잘못 가려지면 안 된다");
  });

  test("완전한 새로고침(새 문서)에서도 저장된 규칙으로 같은 영상의 제목을 다시 가린다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { cards } = buildYouTubeDeep(env, 6);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[2].title, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    const savedRule = env.getStoredRules("www.youtube.com")[0];

    // 새 문서에서 같은 구조를 다시 만들고 저장 규칙만 재적용한다.
    const env2 = createEnv("https://www.youtube.com/");
    const fixture2 = buildYouTubeDeep(env2, 6);
    env2.seedRules("www.youtube.com", [savedRule]);
    env2.loadContentScript();
    await wait(40);

    fixture2.cards.forEach((c, i) => {
      assert.equal(isMasked(c.title), i === 2, `새로고침 후 카드 ${i}의 제목 가림 상태가 예상과 다르다`);
    });
  });
});

// Instagram DM 유사: 가상화된 메시지 목록, 자동 생성 atomic class, 깊은 중첩.
function buildInstagramDM(env, count) {
  const thread = el(env, "div", { className: "x1n2onr6 xh8yej3", role: "grid" });
  env.document.body.appendChild(thread);

  const messages = [];
  for (let i = 0; i < count; i++) {
    const row = el(env, "div", { className: "x9f619 x1ja2u2z", role: "row" });
    const group = el(env, "div", { className: "x78zum5 xdt5ytf" });
    const bubbleWrap = el(env, "div", { className: "x1lliihq x1iyjqo2" });
    const bubble = el(env, "div", { className: "xzsf02u x1a2a7pz" });
    const textSpan = el(env, "span", { className: "x1lliihq x6ikm8r x10wlt62", text: "메시지 " + i });
    append(bubble, textSpan);
    append(bubbleWrap, bubble);
    append(group, bubbleWrap);
    append(row, group);
    append(thread, row);
    messages.push({ row, bubble, textSpan });
  }
  return { thread, messages };
}

describe("Instagram DM 유사 DOM: 메시지 버블 선택", () => {
  test("깊게 중첩된 메시지 텍스트를 클릭하면 '이 요소만'으로 그 메시지 하나만 가려진다", async () => {
    const env = createEnv("https://www.instagram.com/direct/t/123/");
    const { messages } = buildInstagramDM(env, 12);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(messages[5].textSpan, "click");

    const buttons = scopeButtons(env);
    assert.ok(!buttons[0].disabled, "메시지에서도 '이 요소만' 버튼이 활성화되어야 한다");

    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.instagram.com").length === 1);
    await waitUntil(() => isMasked(messages[5].textSpan));

    messages.forEach((m, i) => {
      assert.equal(isMasked(m.textSpan), i === 5, `메시지 ${i}의 가림 상태가 예상과 다르다`);
      assert.equal(m.row.classList.contains("cloakli-masked"), false, "대화 행 전체가 가려지면 안 된다");
    });
  });

  test("메시지 버블 자체를 클릭해도 목록 전체가 아니라 그 버블만 잡힌다", async () => {
    const env = createEnv("https://www.instagram.com/direct/t/123/");
    const { thread, messages } = buildInstagramDM(env, 12);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(messages[8].bubble, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.instagram.com").length === 1);

    assert.equal(thread.classList.contains("cloakli-masked"), false, "대화 목록 전체가 가려지면 안 된다");
    // 저장된 selector가 정확히 하나만 가리키는지(다른 버블은 잡히지 않는지) 확인한다.
    const saved = env.getStoredRules("www.instagram.com")[0];
    const matches = env.document.querySelectorAll(saved.selector);
    assert.equal(Array.from(matches).length, 1, "element selector는 정확히 하나만 가리켜야 한다");
  });
});

// Gmail 유사(비교적 얕고 안정적인 구조): 기존에 동작하던 방식이 계속 유지되는지 회귀 확인.
function buildGmailLike(env, count) {
  const list = el(env, "div", { role: "main" });
  env.document.body.appendChild(list);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const row = el(env, "tr", { className: "zA yO", id: "row-" + i }); // Gmail은 행마다 고유 id를 갖는 편
    const sender = el(env, "span", { className: "yP", text: "보낸사람 " + i });
    const subject = el(env, "span", { className: "bog", text: "제목 " + i });
    append(row, sender, subject);
    append(list, row);
    rows.push({ row, sender, subject });
  }
  return { list, rows };
}

describe("Gmail 유사 DOM: 기존 선택 동작 회귀 없음", () => {
  test("얕고 안정적인 구조(고유 id 행)에서 제목을 element 범위로 선택/저장한다", async () => {
    const env = createEnv("https://mail.google.com/");
    const { rows } = buildGmailLike(env, 8);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(rows[3].subject, "click");

    const buttons = scopeButtons(env);
    assert.ok(!buttons[0].disabled, "'이 요소만' 버튼이 활성화되어야 한다");

    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("mail.google.com").length === 1);
    await waitUntil(() => isMasked(rows[3].subject));

    rows.forEach((r, i) => {
      assert.equal(isMasked(r.subject), i === 3, `행 ${i}의 제목 가림 상태가 예상과 다르다`);
      assert.equal(isMasked(r.sender), false, "보낸사람은 영향받으면 안 된다");
    });
  });
});

describe("무료 3개 제한 / 4번째 차단이 깊은 DOM 선택에도 그대로 적용된다", () => {
  test("무료 사용자는 3개까지 element 저장 성공, 4번째는 차단되고 실제 가림도 남지 않는다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { cards } = buildYouTubeDeep(env, 6);
    env.loadContentScript(); // 기본 free
    await wait(20);

    // 1~3번째 제목 선택/저장(성공).
    for (let i = 0; i < 3; i++) {
      await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
      env.dispatch(cards[i].title, "click");
      chooseScopeOption(env, 0);
      await waitUntil(() => env.getStoredRules("www.youtube.com").length === i + 1);
      await waitUntil(() => isMasked(cards[i].title));
    }
    assert.equal(env.getStoredRules("www.youtube.com").length, 3);

    // 4번째: 차단되어 저장되지 않고, 임시 가림도 즉시 제거된다.
    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[3].title, "click");
    chooseScopeOption(env, 0);
    await wait(80);

    assert.equal(env.getStoredRules("www.youtube.com").length, 3, "4번째는 저장되면 안 된다");
    const toast = env.document.getElementById("cloakli-toast-root");
    assert.ok(toast && /최대 3개까지/.test(toast.textContent), "3개 제한 안내가 표시되어야 한다");
    await waitUntil(() => !isMasked(cards[3].title)).catch(() => {});
    assert.equal(isMasked(cards[3].title), false, "차단된 4번째는 실제 가림이 남으면 안 된다");
  });

  test("무료 사용자는 깊은 DOM에서도 page/site(Pro) 범위가 계속 차단된다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { cards } = buildYouTubeDeep(env, 6);
    env.loadContentScript(); // free
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[0].title, "click");

    const buttons = scopeButtons(env);
    // page/site 버튼에는 PRO 배지가 있고, 눌러도 저장되지 않는다.
    const pageHasBadge = buttons[1].children.some((c) => c.className === "cloakli-scope-picker-pro-badge");
    assert.ok(pageHasBadge, "무료 사용자에게 page 범위는 PRO로 표시되어야 한다");

    chooseScopeOption(env, 1); // page 시도
    await wait(60);
    assert.equal(env.getStoredRules("www.youtube.com").length, 0, "무료 사용자의 page 범위는 저장되면 안 된다");
  });

  test("Pro 사용자는 깊은 DOM에서도 element/page 범위 모두 사용할 수 있다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { cards } = buildYouTubeDeep(env, 6);
    env.loadContentScript({ entitlementOverride: PRO });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[0].title, "click");

    const buttons = scopeButtons(env);
    assert.ok(!buttons[0].disabled, "element 버튼 활성화");
    // 제목은 반복 카드 안에 있으므로 일반화(page/site)도 가능해야 한다.
    assert.ok(!buttons[1].disabled, "Pro는 page 범위도 사용 가능해야 한다");
  });
});

describe("텍스트 요소 정규화: 중첩 span / 링크 안 텍스트", () => {
  // 제목이 여러 내부 span으로 쪼개진 경우: 조각 하나가 아니라 그 조각들을 담는
  // 최소 공통 wrapper가 대상이 되어야 한다.
  function buildSplitTitle(env) {
    const contents = el(env, "div", { id: "contents" });
    env.document.body.appendChild(contents);
    const cards = [];
    for (let i = 0; i < 5; i++) {
      const card = el(env, "article", { className: "post-card" });
      const h2 = el(env, "h2", { className: "post-title" });
      const p1 = el(env, "span", { className: "seg", text: "앞부분 " + i });
      const p2 = el(env, "span", { className: "seg", text: "뒷부분 " + i });
      append(h2, p1, p2);
      append(card, h2);
      append(contents, card);
      cards.push({ card, h2, p1, p2 });
    }
    return { contents, cards };
  }

  test("여러 span으로 나뉜 제목의 wrapper를 클릭하면 조각이 아닌 제목 영역 전체가 대상이 된다", async () => {
    const env = createEnv("https://blog.example.com/");
    const { cards } = buildSplitTitle(env);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[2].h2, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("blog.example.com").length === 1);
    await waitUntil(() => isMasked(cards[2].h2));

    // 가림은 제목 wrapper(h2) 자신에 걸려야 한다. 조각(span)에 따로 걸리면 안 된다
    // (h2가 가려지면 두 조각이 함께 덮이므로, 조각 자신에는 class가 붙지 않아야 정상이다).
    assert.equal(cards[2].h2.classList.contains("cloakli-masked"), true, "제목 wrapper(h2)가 대상이어야 한다");
    assert.equal(cards[2].p1.classList.contains("cloakli-masked"), false, "조각 하나에 따로 가림이 걸리면 안 된다");
    assert.equal(cards[2].p2.classList.contains("cloakli-masked"), false, "조각 하나에 따로 가림이 걸리면 안 된다");
    assert.equal(cards[2].card.classList.contains("cloakli-masked"), false, "카드 전체가 가려지면 안 된다");
    cards.forEach((c, i) => {
      if (i !== 2) assert.equal(c.h2.classList.contains("cloakli-masked"), false, `카드 ${i}의 제목은 가려지면 안 된다`);
    });
  });

  test("조각 span 하나를 직접 클릭하면 그 조각이 대상이 된다(의도적으로 더 작은 단위 선택 허용)", async () => {
    const env = createEnv("https://blog.example.com/");
    const { cards } = buildSplitTitle(env);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[1].p2, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("blog.example.com").length === 1);
    await waitUntil(() => isMasked(cards[1].p2));

    assert.equal(isMasked(cards[1].p2), true);
    assert.equal(isMasked(cards[1].p1), false, "다른 조각은 가려지면 안 된다");
  });
});

describe("동적 DOM: 나중에 삽입된 요소 / 제거 후 재생성 / SPA 경로 변경", () => {
  test("선택 후 요소가 제거되었다가 같은 구조로 다시 생성되면 재적용된다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { contents, cards } = buildYouTubeDeep(env, 4);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[1].title, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(cards[1].title));

    // 카드 하나를 통째로 제거했다가(가상화 목록의 언마운트) 같은 항목(같은 영상)을
    // 같은 자리에 다시 만든다 - 실제 가상화 목록이 스크롤 중에 하는 동작이다.
    const removed = cards[1].card;
    const nextSibling = removed.nextElementSibling;
    removed.remove();
    env.flushMutations();
    await wait(400);

    const rebuilt = buildYouTubeCard(env, 1);
    contents.insertBefore(rebuilt.card, nextSibling);
    env.flushMutations();
    await wait(650);

    // 재생성된 카드의 제목이 다시 가려져야 한다.
    assert.equal(isMasked(rebuilt.title), true, "재생성된 요소에 규칙이 다시 적용되어야 한다");
  });

  test("SPA 경로 변경 후에도 element 규칙이 다시 적용된다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { cards } = buildYouTubeDeep(env, 4);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[0].title, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);
    await waitUntil(() => isMasked(cards[0].title));

    // 임시 해제 후 SPA 내부 이동: 새 URL에서 element 규칙(hostname만 일치하면 됨)이 재적용된다.
    await env.sendRuntimeMessage({ type: "CLEAR_ALL_MASKS" });
    await wait(30);
    assert.equal(isMasked(cards[0].title), false, "임시 해제 직후에는 가림이 없다");

    env.sandbox.history.pushState({}, "", "/feed/subscriptions");
    await wait(650);

    assert.equal(isMasked(cards[0].title), true, "SPA 이동 후 규칙이 다시 적용되어야 한다");
  });
});

describe("선택 모드 중 사이트 동작 차단과 종료 후 복구", () => {
  test("선택 모드 중 링크 클릭은 이동하지 않고, 종료 후에는 사이트 클릭이 정상 동작한다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { cards } = buildYouTubeDeep(env, 4);
    let siteClicks = 0;
    cards[0].titleLink.addEventListener("click", () => siteClicks++);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    const evt = env.dispatch(cards[0].titleLink, "click");
    assert.equal(evt.defaultPrevented, true, "선택 모드에서는 기본 동작(링크 이동)이 차단되어야 한다");
    assert.equal(siteClicks, 0, "선택 모드에서는 사이트 자체 클릭 리스너가 실행되면 안 된다");

    // 범위 선택 UI를 ESC로 취소하고 선택 모드를 완전히 종료한다.
    env.dispatch(env.document.body, "keydown", { key: "Escape" });
    await wait(20);

    // 이제 사이트 클릭이 정상 동작해야 한다.
    const evt2 = env.dispatch(cards[0].titleLink, "click");
    assert.equal(evt2.defaultPrevented, false, "선택 모드 종료 후에는 기본 동작을 막으면 안 된다");
    assert.equal(siteClicks, 1, "선택 모드 종료 후 사이트 클릭 리스너가 정상 실행되어야 한다");
    assert.equal(env.document.getElementById("cloakli-selection-shield-root"), null, "선택 레이어가 남으면 안 된다");
  });
});

describe("fingerprint 개인정보: 텍스트/URL 원문을 저장하지 않는다", () => {
  test("저장된 규칙 어디에도 제목/채널명 텍스트나 href/src 원문이 없다", async () => {
    const env = createEnv("https://www.youtube.com/");
    const { cards } = buildYouTubeDeep(env, 4);
    env.loadContentScript();
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(cards[2].title, "click");
    chooseScopeOption(env, 0);
    await waitUntil(() => env.getStoredRules("www.youtube.com").length === 1);

    const serialized = JSON.stringify(env.chrome.storage.__data);
    assert.ok(!/제목 \d/.test(serialized), "제목 텍스트가 저장되면 안 된다");
    assert.ok(!/채널 \d/.test(serialized), "채널명 텍스트가 저장되면 안 된다");
    assert.ok(!/vid-\d/.test(serialized), "href 원문(영상 ID)이 저장되면 안 된다");
    assert.ok(!/i\.ytimg\.com/.test(serialized), "이미지 src 원문이 저장되면 안 된다");

    // 그럼에도 fingerprint에는 구조 정보와 해시 키가 들어 있어야 한다.
    const fp = env.getStoredRules("www.youtube.com")[0].fingerprint;
    assert.equal(fp.tag, "yt-formatted-string");
    assert.ok(fp.hrefKey, "href는 해시 키로만 저장되어야 한다");
    assert.ok(!("text" in fp) && !("textContent" in fp), "텍스트 필드가 있으면 안 된다");
  });
});
