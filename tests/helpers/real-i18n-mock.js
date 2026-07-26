"use strict";

// 실제 _locales/*/messages.json을 그대로 사용하는 chrome.i18n mock.
// "영어 Chrome에서는 전체 UI가 영어로, 한국어 Chrome에서는 한국어로 표시되는지"를 검증하려면
// msg()의 두 번째 인자(한국어 fallback 문자열)가 아니라 실제 로케일 파일 내용과 대조해야
// 의미가 있다 — 이 mock은 그 실제 대조를 가능하게 한다.
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..", "..");

function loadMessages(locale) {
  return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "_locales", locale, "messages.json"), "utf8"));
}

// kind:
//   "en" - 영어 Chrome (지원 언어)
//   "ko" - 한국어 Chrome (지원 언어)
//   "unsupported" - 확장이 지원하지 않는 언어(예: 프랑스어)의 Chrome. 실제 Chrome은 이 경우
//     내부적으로 manifest의 default_locale(en) 메시지를 자동으로 돌려준다 — 이건 확장 코드가
//     구현하는 게 아니라 Chrome 자체의 보장 동작이므로, mock도 그 실제 동작을 그대로 재현한다
//     (getUILanguage()는 실제 브라우저 언어인 "fr"을 보고하지만, getMessage()는 en 메시지를 준다).
function createRealI18nMock(kind) {
  const uiLanguage = kind === "ko" ? "ko" : kind === "unsupported" ? "fr" : "en-US";
  const messages = loadMessages(kind === "ko" ? "ko" : "en"); // unsupported도 en으로 폴백

  return {
    getUILanguage: () => uiLanguage,
    getMessage(key, substitutions) {
      const entry = messages[key];
      if (!entry) return "";
      let text = entry.message;
      const subs = Array.isArray(substitutions) ? substitutions : substitutions != null ? [substitutions] : [];
      subs.forEach((value, i) => {
        text = text.split("$" + (i + 1)).join(String(value));
      });
      return text;
    },
  };
}

module.exports = { createRealI18nMock, loadMessages };
