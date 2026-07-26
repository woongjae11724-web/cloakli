"use strict";

// 확장 프로그램 다국어(_locales) 검증:
// - en/ko messages.json이 유효한 JSON이고 구조가 올바른지
// - 두 로케일의 키가 완전히 일치하는지 (parity)
// - manifest의 __MSG_...__ 참조가 실제 키로 존재하는지
// - en/ko 간 $1..$n 치환자 개수가 일치하는지

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function loadLocale(lang) {
  const file = path.join(ROOT, "_locales", lang, "messages.json");
  assert.ok(fs.existsSync(file), `_locales/${lang}/messages.json 존재해야 함`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("en/ko messages.json이 유효하고 모든 항목에 message 문자열이 있다", () => {
  for (const lang of ["en", "ko"]) {
    const messages = loadLocale(lang);
    const keys = Object.keys(messages);
    assert.ok(keys.length > 100, `${lang} 로케일 키가 충분해야 함 (현재 ${keys.length})`);
    for (const key of keys) {
      assert.strictEqual(typeof messages[key].message, "string", `${lang}:${key} message는 문자열`);
      assert.ok(messages[key].message.length > 0, `${lang}:${key} message가 비어 있으면 안 됨`);
    }
  }
});

test("en과 ko의 키가 완전히 일치한다", () => {
  const en = Object.keys(loadLocale("en")).sort();
  const ko = Object.keys(loadLocale("ko")).sort();
  assert.deepStrictEqual(en, ko);
});

test("en/ko 간 $n 치환자 개수가 일치한다", () => {
  const en = loadLocale("en");
  const ko = loadLocale("ko");
  for (const key of Object.keys(en)) {
    const count = (value) => {
      const matches = value.match(/\$\d/g) || [];
      return new Set(matches).size;
    };
    assert.strictEqual(
      count(en[key].message),
      count(ko[key].message),
      `${key}: en/ko 치환자 개수 불일치 (en="${en[key].message}", ko="${ko[key].message}")`
    );
  }
});

test("manifest의 __MSG__ 참조가 en 로케일에 모두 존재한다", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const en = loadLocale("en");
  const refs = [];
  const collect = (value) => {
    if (typeof value === "string") {
      const m = value.match(/^__MSG_(\w+)__$/);
      if (m) refs.push(m[1]);
    } else if (value && typeof value === "object") {
      for (const v of Object.values(value)) collect(v);
    }
  };
  collect(manifest);
  assert.ok(refs.includes("extensionName"), "manifest name은 __MSG_extensionName__");
  assert.strictEqual(manifest.default_locale, "en");
  for (const ref of refs) {
    assert.ok(en[ref], `manifest 참조 키 누락: ${ref}`);
  }
});

test("manifest 아이콘 파일이 실제로 존재한다", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  for (const [size, icon] of Object.entries(manifest.icons)) {
    const file = path.join(ROOT, icon);
    assert.ok(fs.existsSync(file), `아이콘 누락: ${icon} (${size}px)`);
    const buf = fs.readFileSync(file);
    assert.strictEqual(buf.readUInt32BE(0), 0x89504e47, `${icon}은 PNG여야 함`);
  }
});

// popup.html/options.html의 모든 data-i18n / data-i18n-aria / data-i18n-placeholder 키가
// en/ko 로케일 모두에 실제로 존재하는지 정적으로 대조한다. 새 UI 텍스트를 HTML에 추가하면서
// 로케일 파일에 키를 빠뜨리는 회귀를 잡는다(website.test.js의 같은 취지의 검사를 확장에도 적용).
test("popup.html/options.html의 모든 data-i18n* 키가 en/ko 로케일에 존재한다", () => {
  const en = loadLocale("en");
  const ko = loadLocale("ko");
  const missing = [];
  for (const file of ["popup.html", "options.html"]) {
    const content = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const m of content.matchAll(/data-i18n(?:-aria|-placeholder)?=["'](\w+)["']/g)) {
      if (!en[m[1]]) missing.push(`${file} → ${m[1]} (en 누락)`);
      if (!ko[m[1]]) missing.push(`${file} → ${m[1]} (ko 누락)`);
    }
  }
  assert.deepStrictEqual(missing, [], "로케일에 없는 data-i18n 키: " + missing.join(", "));
});

// popup.html/options.html의 <html lang>은 실제 Chrome에서 localizeDocument()가
// chrome.i18n.getUILanguage()로 즉시 덮어쓰므로, 소스에 박힌 정적 값은 "chrome.i18n이 없는
// 테스트/폴백 환경"에서만 의미가 있다 — 그 환경에서는 fallback 텍스트가 한국어이므로 "ko"가
// 맞다. 실제 로케일별 렌더링(영어/한국어/미지원 언어 폴백) 검증은 i18n-locale-rendering.test.js가
// chrome.i18n mock으로 수행한다.
test("popup.html/options.html의 정적 lang 속성은 fallback 텍스트(한국어)와 일치하는 'ko'다", () => {
  for (const file of ["popup.html", "options.html"]) {
    const content = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(content, /<html lang="ko">/, `${file}의 정적 lang 속성`);
  }
});
