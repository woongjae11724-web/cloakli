// Cloakli 홈페이지 다국어 처리 (외부 라이브러리 없음).
//
// 두 가지 방식을 함께 지원한다:
//  1. data-i18n="key"   — 짧은 UI 문구. HTML에는 영어 원문이 들어 있고(SEO/무-JS 대비),
//     한국어일 때 locales/ko.js(window.CLOAKLI_KO)의 값으로 교체한다. 영어로 되돌릴 때는
//     최초 로드 시 저장해 둔 영어 원문 스냅샷을 사용한다(영어를 두 곳에 중복 작성하지 않음).
//  2. data-lang="en|ko" — 정책 문서처럼 긴 블록. 현재 언어의 블록만 표시한다.
//
// 언어 결정: localStorage("cloakli-lang") > navigator.language(ko*) > 영어(fallback).
// 개인정보는 저장하지 않는다(언어 코드 한 글자짜리 선호값만 localStorage에 저장).
(function () {
  "use strict";

  var STORAGE_KEY = "cloakli-lang";
  var SUPPORTED = ["en", "ko"];
  var enSnapshot = null; // key(요소 인덱스) → 영어 원문

  function detectLanguage() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (SUPPORTED.indexOf(saved) !== -1) return saved;
    } catch (err) {}
    var nav = (navigator.language || "").toLowerCase();
    return nav.indexOf("ko") === 0 ? "ko" : "en";
  }

  function snapshotEnglish() {
    if (enSnapshot) return;
    enSnapshot = { texts: [], title: document.title, description: "" };
    var meta = document.querySelector('meta[name="description"]');
    if (meta) enSnapshot.description = meta.getAttribute("content") || "";
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      enSnapshot.texts.push({ el: el, text: el.textContent });
    });
  }

  function applyLanguage(lang) {
    snapshotEnglish();
    var ko = window.CLOAKLI_KO || {};

    // 1) 짧은 문구 교체
    if (lang === "ko") {
      document.querySelectorAll("[data-i18n]").forEach(function (el) {
        var key = el.getAttribute("data-i18n");
        if (ko[key]) el.textContent = ko[key];
      });
      if (ko.__title__ && ko.__title__[pageKey()]) document.title = ko.__title__[pageKey()];
      var meta = document.querySelector('meta[name="description"]');
      if (meta && ko.__description__ && ko.__description__[pageKey()]) {
        meta.setAttribute("content", ko.__description__[pageKey()]);
      }
    } else {
      enSnapshot.texts.forEach(function (item) {
        item.el.textContent = item.text;
      });
      document.title = enSnapshot.title;
      var metaEn = document.querySelector('meta[name="description"]');
      if (metaEn && enSnapshot.description) metaEn.setAttribute("content", enSnapshot.description);
    }

    // 2) 긴 블록 표시/숨김
    document.querySelectorAll("[data-lang]").forEach(function (el) {
      el.hidden = el.getAttribute("data-lang") !== lang;
    });

    // 3) 문서 언어/토글 상태
    document.documentElement.setAttribute("lang", lang);
    document.querySelectorAll("[data-lang-switch]").forEach(function (btn) {
      var target = btn.getAttribute("data-lang-switch");
      btn.setAttribute("aria-pressed", target === lang ? "true" : "false");
      btn.classList.toggle("active", target === lang);
    });
  }

  // 페이지 구분 키 (title/description 언어별 교체용): body[data-page] 값
  function pageKey() {
    return document.body.getAttribute("data-page") || "home";
  }

  function setLanguage(lang) {
    if (SUPPORTED.indexOf(lang) === -1) lang = "en";
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (err) {}
    applyLanguage(lang);
  }

  // 설정값(window.CLOAKLI_SITE)을 data-config="키" 요소에 채운다.
  function applyConfig() {
    var cfg = window.CLOAKLI_SITE || {};
    document.querySelectorAll("[data-config]").forEach(function (el) {
      var key = el.getAttribute("data-config");
      var value = cfg[key];
      if (value === null || value === undefined || value === "") return; // placeholder 상태면 HTML 기본값 유지
      if (el.tagName === "A" && el.hasAttribute("data-config-href")) {
        el.setAttribute("href", String(value));
      } else {
        el.textContent = String(value);
      }
    });

    // Chrome Web Store 설치 버튼: URL이 없으면 비활성(Coming soon) 유지, 있으면 활성화.
    document.querySelectorAll("[data-store-button]").forEach(function (btn) {
      var url = cfg.chromeStoreUrl;
      if (typeof url === "string" && url.indexOf("https://") === 0) {
        btn.classList.remove("disabled");
        btn.removeAttribute("aria-disabled");
        btn.setAttribute("href", url);
        var readyLabel = btn.getAttribute("data-ready-en") || "Add to Chrome";
        btn.setAttribute("data-i18n", "storeButtonReady");
        btn.textContent = readyLabel;
      }
    });

    // 환불 기간: 확정(숫자)이면 채우고, null이면 "확정 예정" 문구 블록을 유지한다.
    document.querySelectorAll("[data-refund-days]").forEach(function (el) {
      if (typeof cfg.refundWindowDays === "number") {
        el.textContent = String(cfg.refundWindowDays);
      }
    });
  }

  function init() {
    applyConfig();
    applyLanguage(detectLanguage());
    document.querySelectorAll("[data-lang-switch]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setLanguage(btn.getAttribute("data-lang-switch"));
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.CloakliSiteI18n = { setLanguage: setLanguage, detectLanguage: detectLanguage };
})();
