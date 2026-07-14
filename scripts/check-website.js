"use strict";

// website/ 정적 검사기.
// 기본(경고 모드): placeholder를 목록으로 보여주되 성공 종료.
// --strict: production 필수값(placeholder)이 남아 있으면 실패 종료.
// 항상 실패로 처리하는 항목: 라우트 누락, 깨진 내부 링크, http:// 외부 링크,
// 금지된 과장 문구, 추적 스크립트 흔적, 가짜 스토어 URL.

const fs = require("fs");
const path = require("path");

const WEBSITE_DIR = path.join(__dirname, "..", "website");
const STRICT = process.argv.includes("--strict");

const REQUIRED_ROUTES = [
  "index.html",
  "privacy/index.html",
  "terms/index.html",
  "refund/index.html",
  "support/index.html",
  "download/index.html"
];

const REQUIRED_FILES = [
  "site-config.js",
  "locales/ko.js",
  "assets/i18n.js",
  "assets/site.css",
  "assets/favicon.svg",
  "robots.txt",
  "sitemap.xml",
  "README.md"
];

// production 배포 전 반드시 실제 값으로 바뀌어야 하는 placeholder 표식
const PLACEHOLDER_TOKENS = [
  "YOUR_SUPPORT_EMAIL",
  "YOUR_EMAIL",
  "YOUR_BUSINESS_NAME",
  "YOUR_JURISDICTION",
  "REFUND_WINDOW_DAYS",
  "YOUR_CHROME_STORE_URL",
  "EFFECTIVE_DATE_PLACEHOLDER"
];

// 과장·허위 표현 금지 (영문은 단어 경계 기준)
const FORBIDDEN_CLAIMS = [
  /100%\s*(secure|safe|안전)/i,
  /unhackable/i,
  /guaranteed\s+privacy/i,
  /works\s+on\s+every\s+website/i,
  /every\s+website\s+guaranteed/i,
  /military[- ]grade/i,
  /AI[- ]powered/i,
  /해킹\s*불가/,
  /모든\s*(웹사이트|사이트)에서\s*(완벽|보장)/
];

// 분석/추적 스크립트 흔적
const TRACKING_PATTERNS = [
  /googletagmanager|google-analytics|gtag\(/i,
  /facebook\.net|fbq\(/i,
  /hotjar|mixpanel|amplitude|segment\.com|plausible\.io|umami/i,
  /<script[^>]+src=["']https?:\/\//i // 외부 CDN 스크립트 자체를 금지
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(WEBSITE_DIR, file).split(path.sep).join("/");
}

const errors = [];
const warnings = [];

// 1. 필수 라우트/파일 존재
for (const route of [...REQUIRED_ROUTES, ...REQUIRED_FILES]) {
  if (!fs.existsSync(path.join(WEBSITE_DIR, route))) {
    errors.push(`필수 파일 누락: website/${route}`);
  }
}

const allFiles = fs.existsSync(WEBSITE_DIR) ? walk(WEBSITE_DIR) : [];
const textFiles = allFiles.filter((f) => /\.(html|js|css|txt|xml|md|svg)$/.test(f));
const htmlFiles = allFiles.filter((f) => f.endsWith(".html"));

// 2. placeholder 스캔
const placeholderHits = [];
for (const file of textFiles) {
  const content = fs.readFileSync(file, "utf8");
  for (const token of PLACEHOLDER_TOKENS) {
    if (content.includes(token)) {
      placeholderHits.push(`${rel(file)} → ${token}`);
    }
  }
}
// site-config.js의 미확정 값(빈 스토어 URL, null 환불 기간)도 placeholder로 취급
const siteConfigPath = path.join(WEBSITE_DIR, "site-config.js");
if (fs.existsSync(siteConfigPath)) {
  const cfg = fs.readFileSync(siteConfigPath, "utf8");
  if (/chromeStoreUrl:\s*["']{2}/.test(cfg)) {
    // 스토어 출시 전에는 빈 값이 정상 동작(버튼 "Coming soon" 비활성)이므로 strict에서도 경고만.
    warnings.push("chromeStoreUrl 비어 있음 — 스토어 출시 후 입력 (버튼은 'Coming soon'으로 비활성 상태)");
  }
  if (/refundWindowDays:\s*null/.test(cfg)) {
    placeholderHits.push("site-config.js → refundWindowDays 미확정 (null)");
  }
  // 가짜 스토어 URL 방지: 값이 있다면 실제 chromewebstore 도메인이어야 함
  const m = cfg.match(/chromeStoreUrl:\s*["']([^"']+)["']/);
  if (m && m[1] && !/^https:\/\/chromewebstore\.google\.com\//.test(m[1])) {
    errors.push(`site-config.js → chromeStoreUrl이 실제 Chrome Web Store URL이 아님: ${m[1]}`);
  }
}
if (placeholderHits.length > 0) {
  const list = [...new Set(placeholderHits)];
  if (STRICT) {
    errors.push(...list.map((h) => `placeholder 미확정: ${h}`));
  } else {
    warnings.push(...list.map((h) => `placeholder: ${h}`));
  }
}

// 3. HTML 링크 검사
for (const file of htmlFiles) {
  const content = fs.readFileSync(file, "utf8");
  const hrefs = [...content.matchAll(/(?:href|src)=["']([^"']+)["']/g)].map((m) => m[1]);
  for (const href of hrefs) {
    if (href.startsWith("#") || href.startsWith("mailto:")) continue;
    if (/^https?:\/\//.test(href)) {
      if (href.startsWith("http://")) {
        errors.push(`${rel(file)} → http:// 외부 링크(https 필수): ${href}`);
      }
      continue;
    }
    // 내부 링크: 절대 경로만 사용
    if (!href.startsWith("/")) {
      // 상대 경로 내부 링크는 라우팅 혼선을 만들므로 금지
      errors.push(`${rel(file)} → 상대 경로 내부 링크 금지(절대 경로 사용): ${href}`);
      continue;
    }
    const clean = href.split(/[?#]/)[0];
    let target = path.join(WEBSITE_DIR, clean);
    if (clean.endsWith("/")) target = path.join(target, "index.html");
    if (!fs.existsSync(target)) {
      errors.push(`${rel(file)} → 깨진 내부 링크: ${href}`);
    }
  }
}

// 4. 금지 문구/추적 스크립트
for (const file of textFiles) {
  const content = fs.readFileSync(file, "utf8");
  for (const pattern of FORBIDDEN_CLAIMS) {
    if (pattern.test(content)) {
      errors.push(`${rel(file)} → 금지된 과장 문구 발견: ${pattern}`);
    }
  }
}
for (const file of htmlFiles) {
  const content = fs.readFileSync(file, "utf8");
  for (const pattern of TRACKING_PATTERNS) {
    if (pattern.test(content)) {
      errors.push(`${rel(file)} → 추적/외부 스크립트 흔적: ${pattern}`);
    }
  }
}

// 결과 출력
if (warnings.length > 0) {
  console.log("⚠ 경고 (production 전 확정 필요):");
  for (const w of warnings) console.log("  - " + w);
}
if (errors.length > 0) {
  console.error("✗ 실패:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`✓ website 검사 통과 (${STRICT ? "strict" : "경고"} 모드, HTML ${htmlFiles.length}개, 경고 ${warnings.length}건)`);
