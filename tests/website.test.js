"use strict";

// website/ 와 store-assets/ 검증:
// - 필수 라우트/파일 존재
// - HTML의 data-i18n 키가 locales/ko.js에 모두 존재
// - 내부 링크가 실제 파일로 연결되고 외부 링크는 https만 사용
// - 과장 문구/추적 스크립트 부재
// - 정책 문서가 코드 동작과 일치하는 핵심 서술을 포함
// - 스토어 자료 존재 + 금지 문구 부재, 데모 픽스처는 허구 데이터만 사용

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SITE = path.join(ROOT, "website");
const STORE = path.join(ROOT, "store-assets");

const ROUTES = ["index.html", "privacy/index.html", "terms/index.html", "refund/index.html", "support/index.html", "download/index.html"];

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function loadWindowGlobal(relPath) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, relPath), "utf8"), context);
  return context.window;
}

function htmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

test("website: 6개 라우트와 필수 자산이 존재한다", () => {
  for (const route of ROUTES) {
    assert.ok(fs.existsSync(path.join(SITE, route)), `누락: website/${route}`);
  }
  for (const file of ["site-config.js", "locales/ko.js", "assets/i18n.js", "assets/site.css", "assets/favicon.svg", "robots.txt", "sitemap.xml", "README.md"]) {
    assert.ok(fs.existsSync(path.join(SITE, file)), `누락: website/${file}`);
  }
});

test("website: site-config.js와 ko.js가 문법 오류 없이 로드된다", () => {
  const cfg = loadWindowGlobal("website/site-config.js").CLOAKLI_SITE;
  assert.ok(cfg, "CLOAKLI_SITE 정의 필요");
  assert.ok(cfg.checkoutUrl.startsWith("https://"), "checkoutUrl은 https");
  const ko = loadWindowGlobal("website/locales/ko.js").CLOAKLI_KO;
  assert.ok(ko && typeof ko.heroTitle === "string");
});

test("website: 가짜 Chrome Store URL을 쓰지 않는다 (빈 값 또는 실제 스토어 도메인만 허용)", () => {
  const cfg = loadWindowGlobal("website/site-config.js").CLOAKLI_SITE;
  if (cfg.chromeStoreUrl !== "") {
    assert.match(cfg.chromeStoreUrl, /^https:\/\/chromewebstore\.google\.com\//);
  }
});

test("website: HTML의 모든 data-i18n 키가 ko.js에 존재한다", () => {
  const ko = loadWindowGlobal("website/locales/ko.js").CLOAKLI_KO;
  const missing = [];
  for (const file of htmlFiles(SITE)) {
    const content = fs.readFileSync(file, "utf8");
    for (const m of content.matchAll(/data-i18n(?:-aria|-placeholder)?=["'](\w+)["']/g)) {
      if (typeof ko[m[1]] !== "string") missing.push(`${path.relative(SITE, file)} → ${m[1]}`);
    }
  }
  assert.deepStrictEqual(missing, [], "ko.js에 없는 data-i18n 키: " + missing.join(", "));
});

test("website: 페이지별 __title__/__description__ 키가 body[data-page]와 일치한다", () => {
  const ko = loadWindowGlobal("website/locales/ko.js").CLOAKLI_KO;
  for (const route of ROUTES) {
    const content = read(path.join("website", route));
    const m = content.match(/<body[^>]*data-page=["'](\w+)["']/);
    assert.ok(m, `${route}에 body[data-page] 필요`);
    assert.ok(ko.__title__[m[1]], `__title__.${m[1]} 누락`);
    assert.ok(ko.__description__[m[1]], `__description__.${m[1]} 누락`);
  }
});

test("website: 내부 링크가 유효하고 외부 링크는 https만 사용한다", () => {
  for (const file of htmlFiles(SITE)) {
    const content = fs.readFileSync(file, "utf8");
    for (const m of content.matchAll(/(?:href|src)=["']([^"']+)["']/g)) {
      const href = m[1];
      if (href.startsWith("#") || href.startsWith("mailto:")) continue;
      if (/^https:\/\//.test(href)) continue;
      assert.ok(!href.startsWith("http://"), `${path.relative(SITE, file)}: http 링크 금지 → ${href}`);
      assert.ok(href.startsWith("/"), `${path.relative(SITE, file)}: 내부 링크는 절대 경로 → ${href}`);
      const clean = href.split(/[?#]/)[0];
      let target = path.join(SITE, clean);
      if (clean.endsWith("/")) target = path.join(target, "index.html");
      assert.ok(fs.existsSync(target), `${path.relative(SITE, file)}: 깨진 링크 → ${href}`);
    }
  }
});

test("website + store-assets: 과장 문구와 추적 스크립트가 없다", () => {
  const forbidden = [
    /100%\s*(secure|safe|안전)/i, /unhackable/i, /guaranteed\s+privacy/i,
    /works\s+on\s+every\s+website/i, /military[- ]grade/i, /AI[- ]powered/i,
    /해킹\s*불가/, /완벽(하게|히)?\s*보장/
  ];
  const tracking = [/googletagmanager|google-analytics|gtag\(/i, /hotjar|mixpanel|amplitude/i];
  const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { scan(full); continue; }
      if (!/\.(html|js|md|css)$/.test(entry.name)) continue;
      const content = fs.readFileSync(full, "utf8");
      for (const p of forbidden) {
        assert.ok(!p.test(content), `${path.relative(ROOT, full)}: 금지 문구 ${p}`);
      }
      if (entry.name.endsWith(".html")) {
        for (const p of tracking) {
          assert.ok(!p.test(content), `${path.relative(ROOT, full)}: 추적 스크립트 ${p}`);
        }
        assert.ok(!/<script[^>]+src=["']https?:\/\//i.test(content), `${path.relative(ROOT, full)}: 외부 스크립트 금지`);
      }
    }
  };
  scan(SITE);
  scan(STORE);
});

test("privacy: 코드 동작과 일치하는 핵심 서술을 포함한다", () => {
  const content = read("website/privacy/index.html");
  assert.match(content, /SHA-256/, "라이선스 키 해시 전송 설명 필요");
  assert.match(content, /Lemon Squeezy/, "결제 처리자 명시 필요");
  assert.ok(/cloakli-license\.mycloakli\.workers\.dev/.test(content), "라이선스 서버 호스트 명시 필요");
  assert.ok(content.includes("페이지") || content.includes("page content"), "페이지 내용 미전송 설명 필요");
});

test("terms: 가림 한계와 사용자 확인 책임을 명시한다", () => {
  const content = read("website/terms/index.html");
  assert.ok(content.includes("삭제하거나 변경하지 않습니다") || /does not delete/.test(content));
  assert.ok(content.includes("직접 확인") && /verify/.test(content), "사용자 확인 책임 필요 (영/한)");
});

test("refund: 환불 기간은 확정 전까지 placeholder로 표시한다", () => {
  const content = read("website/refund/index.html");
  const cfg = loadWindowGlobal("website/site-config.js").CLOAKLI_SITE;
  assert.match(content, /data-refund-days/, "data-refund-days 요소 필요");
  if (cfg.refundWindowDays === null) {
    assert.match(content, /REFUND_WINDOW_DAYS/, "미확정이면 placeholder 문구 필요");
  } else {
    assert.strictEqual(typeof cfg.refundWindowDays, "number");
  }
});

test("store-assets: 필수 문서가 존재하고 짧은 설명이 규격(132자)을 지킨다", () => {
  for (const file of ["en/listing.md", "ko/listing.md", "PERMISSIONS.md", "PRIVACY-DISCLOSURE.md", "STORE-SUBMISSION.md", "SCREENSHOTS.md", "demo/index.html"]) {
    assert.ok(fs.existsSync(path.join(STORE, file)), `누락: store-assets/${file}`);
  }
  const shortEn = "Hide sensitive information on websites before sharing your screen.";
  const shortKo = "화면 공유 전에 웹페이지의 민감한 정보를 간편하게 가립니다.";
  assert.ok(read("store-assets/en/listing.md").includes(shortEn));
  assert.ok(read("store-assets/ko/listing.md").includes(shortKo));
  assert.ok(shortEn.length <= 132 && shortKo.length <= 132);
});

test("store-assets: PERMISSIONS.md가 manifest의 실제 권한과 일치한다", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const doc = read("store-assets/PERMISSIONS.md");
  for (const perm of manifest.permissions) {
    assert.ok(doc.includes("`" + perm + "`"), `PERMISSIONS.md에 ${perm} 설명 필요`);
  }
  assert.deepStrictEqual(manifest.permissions.sort(), ["activeTab", "alarms", "scripting", "storage"], "권한이 늘었다면 문서/스토어 답안도 갱신해야 함");
});

test("demo 픽스처: 허구 도메인만 사용하고 실존 서비스명이 없다", () => {
  const content = read("store-assets/demo/index.html");
  for (const m of content.matchAll(/[\w.+-]+@([\w-]+\.[\w.]+)/g)) {
    assert.match(m[1], /^example\.(com|org|net)$/, `허구 도메인만 허용: ${m[0]}`);
  }
  for (const brand of [/gmail/i, /youtube/i, /netflix/i, /naver/i, /kakao/i, /toss/i, /\bchase\b/i, /paypal/i]) {
    assert.ok(!brand.test(content), `실존 브랜드 금지: ${brand}`);
  }
  assert.ok(/fiction/i.test(content), "허구 데이터임을 표기해야 함");
});

test("check-website 스크립트가 경고 모드에서 통과한다", () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, "scripts", "check-website.js")], { encoding: "utf8" });
  assert.match(out, /website 검사 통과/);
});
