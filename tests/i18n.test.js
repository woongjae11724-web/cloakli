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
