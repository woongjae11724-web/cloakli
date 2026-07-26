"use strict";

// 다국어 감사 5·6번 항목: "영어 Chrome → 전체 UI 영어", "한국어 Chrome → 전체 UI 한국어",
// "지원하지 않는 언어(예: 프랑스어) → 영어로 fallback"을 실제 _locales/*/messages.json 값과
// 대조해 검증한다(msg()의 두 번째 인자인 한국어 fallback 문자열과 비교하는 게 아니라,
// 실제 로케일 파일 내용과 정확히 일치하는지 확인한다).
//
// "지원하지 않는 언어"는 확장 코드가 구현하는 게 아니라 Chrome 자체가 보장하는 동작
// (manifest의 default_locale로 자동 폴백)이므로, mock도 실제 브라우저처럼 getUILanguage()는
// "fr"을 보고하되 getMessage()는 en 메시지를 돌려주도록 구성한다(real-i18n-mock.js 참고).
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPopupEnv } = require("./helpers/fake-popup-env.js");
const { createOptionsEnv } = require("./helpers/fake-options-env.js");
const { createEnv, wait, waitUntil } = require("./helpers/fake-browser-env");
const { createRealI18nMock, loadMessages } = require("./helpers/real-i18n-mock.js");

const EN = loadMessages("en");
const KO = loadMessages("ko");

const LOCALES = [
  { kind: "en", label: "영어 Chrome", messages: EN, expectHtmlLang: "en-US" },
  { kind: "ko", label: "한국어 Chrome", messages: KO, expectHtmlLang: "ko" },
  { kind: "unsupported", label: "지원하지 않는 언어(프랑스어) Chrome → 영어로 폴백", messages: EN, expectHtmlLang: "fr" },
];

// ---------------------------------------------------------------------
// popup.js
// ---------------------------------------------------------------------
for (const { kind, label, messages, expectHtmlLang } of LOCALES) {
  test(`popup: ${label} — 상태 표시줄/배지/데이터-i18n 텍스트가 실제 로케일 값과 일치한다`, async () => {
    const env = createPopupEnv({ chrome: { i18n: createRealI18nMock(kind) } });
    env.loadPopupScript();
    await env.wait(150);

    // <html lang>이 실제 브라우저 언어로 갱신된다 (접근성 — 오늘 발견/수정한 버그의 회귀 방지).
    assert.equal(env.document.documentElement.lang, expectHtmlLang, "html lang이 chrome.i18n.getUILanguage()를 반영해야 한다");

    // data-i18n 정적 텍스트 치환 (localizeDocument)
    assert.equal(
      env.document.getElementById("cloakli-onboarding-start-btn").textContent,
      messages.onboardingStart.message
    );
    assert.equal(env.document.getElementById("cloakli-help-btn").textContent, messages.helpBtn.message);
    assert.equal(env.document.getElementById("cloakli-toggle-license-visibility-btn").textContent, messages.licenseVisibilityShow.message);
    assert.equal(
      env.document.getElementById("cloakli-toggle-license-visibility-btn").getAttribute("aria-label"),
      messages.licenseVisibilityToggleAria.message
    );
  });
}

test("popup: 지원하지 않는 페이지(chrome://)에서 상태 문구가 로케일별로 정확하다 (영어/한국어/폴백)", async () => {
  for (const { kind, messages } of LOCALES) {
    const env = createPopupEnv({
      chrome: { i18n: createRealI18nMock(kind), activeTab: { id: 1, url: "chrome://extensions" } },
    });
    env.loadPopupScript();
    await env.wait(150);

    assert.equal(
      env.document.getElementById("cloakli-status-hostname").textContent,
      messages.statusUnsupportedPage.message,
      kind + ": 지원하지 않는 페이지 문구"
    );
    assert.equal(
      env.document.getElementById("cloakli-status-state").textContent,
      messages.statusTryNormalSite.message,
      kind + ": 안내 문구"
    );
  }
});

test("popup: Free 요금제 배지 문구($1/$2 치환 포함)가 로케일별로 정확하다", async () => {
  for (const { kind, messages } of LOCALES) {
    const env = createPopupEnv({ chrome: { i18n: createRealI18nMock(kind) } });
    env.loadPopupScript();
    await env.wait(150);

    const expected = messages.planBadgeFree.message
      .replace("$1", "0")
      .replace("$2", "3")
      .replace("$3", "0")
      .replace("$4", "1");
    assert.equal(env.document.getElementById("cloakli-plan-badge").textContent, expected, kind);
  }
});

test("popup: 라이선스 활성화 실패 메시지(licenseErrInvalidLicense)가 로케일별로 정확하다", async () => {
  for (const { kind, messages } of LOCALES) {
    const env = createPopupEnv({
      chrome: { i18n: createRealI18nMock(kind) },
      fetchImpl: () => Promise.resolve({ status: 400, json: async () => ({ ok: false, error: "invalid_license" }) }),
    });
    env.loadPopupScript();
    await env.wait(150);

    env.click(env.document.getElementById("cloakli-show-license-input-btn"));
    env.document.getElementById("cloakli-license-key-input").value = "BAD-KEY";
    env.click(env.document.getElementById("cloakli-activate-license-btn"));
    await env.wait(200);

    assert.equal(
      env.document.getElementById("cloakli-license-message").textContent,
      messages.licenseErrInvalidLicense.message,
      kind
    );
  }
});

// ---------------------------------------------------------------------
// options.js
// ---------------------------------------------------------------------
for (const { kind, label, messages, expectHtmlLang } of LOCALES) {
  test(`options: ${label} — 정적 텍스트/검색창/요금제 요약이 실제 로케일 값과 일치한다`, async () => {
    const env = createOptionsEnv({ chrome: { i18n: createRealI18nMock(kind) } });
    env.loadOptionsScript();
    await env.wait(150);

    assert.equal(env.document.documentElement.lang, expectHtmlLang, "html lang");
    assert.equal(env.document.getElementById("cloakli-options-desc").textContent, messages.optionsIntro.message);
    assert.equal(env.document.getElementById("cloakli-options-pro-info-btn").textContent, messages.proInfoBtn.message);
    assert.equal(env.document.getElementById("cloakli-options-search").getAttribute("placeholder"), messages.optionsSearchPlaceholder.message);
    assert.equal(env.document.getElementById("cloakli-options-search").getAttribute("aria-label"), messages.optionsSearchAria.message);
    assert.equal(env.document.getElementById("cloakli-options-empty").textContent, messages.optionsEmpty.message.replace(/<br\s*\/?>/g, ""));
    assert.equal(env.document.getElementById("cloakli-reset-all-btn").textContent, messages.optionsResetAll.message);

    // 요금제 요약(Free, background GET_ENTITLEMENT 응답 반영 후)
    await waitUntil2(() => env.document.getElementById("cloakli-options-plan").children.length > 0);
    const planText = env.document.getElementById("cloakli-options-plan").children.map((c) => c.textContent).join("\n");
    assert.ok(planText.includes(messages.optionsPlanFreeTitle.message), kind + ": " + planText);
  });
}

function waitUntil2(fn, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function check() {
      if (fn()) return resolve();
      if (Date.now() - start > (timeoutMs || 2000)) return reject(new Error("timeout"));
      setTimeout(check, 10);
    })();
  });
}

// ---------------------------------------------------------------------
// content.js: 선택 모드 배너 / 저장 성공 토스트
// ---------------------------------------------------------------------
for (const { kind, label, messages } of LOCALES) {
  test(`content script: ${label} — 화면 고정 배너 문구가 실제 로케일 값과 일치한다`, async () => {
    const env = createEnv("https://example.com/", { i18n: createRealI18nMock(kind) });
    const p = env.document.createElement("p");
    p.className = "intro";
    p.textContent = "hello";
    env.document.body.appendChild(p);
    env.loadContentScript({ entitlementOverride: { plan: "pro", source: "license_server", isPro: true } });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    const banner = env.document.getElementById("cloakli-selection-banner-root");
    assert.ok(banner, kind + ": 배너가 있어야 한다");
    assert.equal(banner.textContent, messages.bannerFrozenSelection.message, kind);

    // content script는 호스트 페이지의 <html lang>을 절대 건드리면 안 된다(그 페이지 소유).
    assert.notEqual(env.document.documentElement.lang, "en-US", kind + ": content script가 페이지 lang을 임의로 바꾸면 안 된다(원래 값 유지 확인용 no-op)");
  });

  test(`content script: ${label} — '이 요소만' 저장 성공 토스트가 실제 로케일 값과 일치한다`, async () => {
    const env = createEnv("https://example.com/", { i18n: createRealI18nMock(kind) });
    const p = env.document.createElement("p");
    p.className = "intro";
    p.textContent = "hello";
    env.document.body.appendChild(p);
    env.loadContentScript({ entitlementOverride: { plan: "pro", source: "license_server", isPro: true } });
    await wait(20);

    await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
    env.dispatch(p, "click");
    await waitUntil(() => env.document.getElementById("cloakli-scope-picker-root"));
    const root = env.document.getElementById("cloakli-scope-picker-root");
    const btn = root.children.find((c) => c.tagName === "BUTTON" && c.className === "cloakli-scope-picker-option");
    env.dispatch(btn, "click");
    await waitUntil(() => env.getStoredRules("example.com").length === 1);
    // 저장 완료(storage 반영)와 토스트 표시는 별도 비동기 타이밍이라, 토스트 자체가
    // 나타날 때까지 기다린다(반환 즉시 있다고 가정하지 않는다).
    await waitUntil(() => env.document.getElementById("cloakli-toast-root"));

    const toast = env.document.getElementById("cloakli-toast-root");
    assert.ok(toast, kind + ": 토스트가 있어야 한다");
    assert.equal(toast.textContent, messages.toastSavedElement.message, kind);
  });
}
