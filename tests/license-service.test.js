"use strict";

// background 라이선스 서비스(license-service.js) — 단일 source of truth — 검증.
//
// 실제 license-service.js/license-client.js/entitlement.js를 background와 같은 구성으로
// 실행하고, fetch는 실제 서버 코드(server/src, Mock provider)에 연결한다. popup/options/
// content script가 받는 GET_ENTITLEMENT 응답이 항상 storage 레코드 하나에서 나오는지,
// 응답에 비밀값이 절대 없는지 확인한다.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");
const { createChromeMock, createPopupEnv } = require("./helpers/fake-popup-env.js");

const ROOT_DIR = path.join(__dirname, "..");
const SOURCES = ["content-core.js", "entitlement.js", "license-client.js", "license-service.js"].map((f) => ({
  name: f,
  code: fs.readFileSync(path.join(ROOT_DIR, f), "utf8"),
}));

const BUILD_CONFIG_SOURCE = [
  "(function (root) {",
  '  root.CloakliBuildConfig = { mode: "development", developerPro: false, debug: false, licenseServerUrl: "https://license.example.com", checkoutUrl: "" };',
  '})(typeof self !== "undefined" ? self : this);',
].join("\n");

let worker = null;
let makeServerEnv = null;
let TEST_ORIGIN = null;

async function loadServer() {
  if (worker) return;
  const workerMod = await import(pathToFileURL(path.join(ROOT_DIR, "server", "src", "index.js")).href);
  const testEnvMod = await import(pathToFileURL(path.join(ROOT_DIR, "server", "tests", "helpers", "test-env.js")).href);
  worker = workerMod.default;
  makeServerEnv = testEnvMod.createTestEnv;
  TEST_ORIGIN = testEnvMod.TEST_ORIGIN;
}

function fetchToWorker(serverEnv) {
  return async (url, init) => {
    const headers = new Headers((init && init.headers) || {});
    headers.set("Origin", TEST_ORIGIN);
    const req = new Request(url, { method: (init && init.method) || "GET", headers, body: init && init.body });
    const res = await worker.fetch(req, serverEnv);
    return { status: res.status, json: async () => res.json() };
  };
}

// background(서비스 워커)와 같은 구성의 컨텍스트를 만든다.
function createServiceContext(options) {
  const opts = options || {};
  const chromeMock = opts.chrome || createChromeMock({ initialStorage: opts.initialStorage });
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    chrome: chromeMock,
    crypto: globalThis.crypto,
    AbortController: globalThis.AbortController,
    URL: URL,
    fetch: opts.fetchImpl || (() => Promise.reject(new TypeError("no network"))),
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(SOURCES[0].code, context, { filename: "content-core.js" });
  vm.runInContext(BUILD_CONFIG_SOURCE, context, { filename: "build-config.js" });
  for (const { name, code } of SOURCES.slice(1)) {
    vm.runInContext(code, context, { filename: name });
  }
  return {
    chrome: chromeMock,
    service: sandbox.CloakliLicenseService,
    client: sandbox.CloakliLicenseClient,
    entitlement: sandbox.CloakliEntitlement,
    setFetch(impl) {
      sandbox.fetch = impl;
    },
  };
}

function jsonResponseStub(status, body) {
  return async () => ({ status, json: async () => body });
}

test("GET_ENTITLEMENT: 라이선스가 없으면 tier free / status none을 반환한다", async () => {
  await loadServer();
  const ctx = createServiceContext({});
  const res = await ctx.service.handleLicenseServiceMessage({ type: "GET_ENTITLEMENT" });
  assert.equal(res.ok, true);
  assert.equal(res.entitlement.tier, "free");
  assert.equal(res.entitlement.status, "none");
});

test("ACTIVATE_LICENSE 성공: 응답이 실제 Pro이고, 응답 JSON에 세션 토큰/원본 키가 없다", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const ctx = createServiceContext({ fetchImpl: fetchToWorker(serverEnv) });

  const res = await ctx.service.handleLicenseServiceMessage({ type: "ACTIVATE_LICENSE", licenseKey: "CLOAKLI-TEST-PRO" });
  assert.equal(res.ok, true);
  assert.equal(res.entitlement.tier, "pro");
  assert.equal(res.entitlement.source, "license");
  assert.equal(res.entitlement.status, "active");
  assert.equal(res.entitlement.licenseDisplaySuffix, "-PRO");

  const record = ctx.chrome.__storageData[ctx.client.ENTITLEMENT_STORAGE_KEY];
  const responseJson = JSON.stringify(res);
  assert.ok(record && record.sessionToken, "레코드에는 세션 토큰이 있어야 한다");
  assert.ok(!responseJson.includes(record.sessionToken), "응답에 세션 토큰 원문이 있으면 안 된다");
  assert.ok(!responseJson.includes("CLOAKLI-TEST-PRO"), "응답에 원본 라이선스 키가 있으면 안 된다");

  // 성공 응답과 GET_ENTITLEMENT가 항상 같은 결과를 준다.
  const after = await ctx.service.handleLicenseServiceMessage({ type: "GET_ENTITLEMENT" });
  assert.equal(after.entitlement.tier, "pro");
});

test("ACTIVATE_LICENSE: storage 저장이 실패하면 성공을 반환하지 않는다", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const ctx = createServiceContext({ fetchImpl: fetchToWorker(serverEnv) });
  await ctx.client.getOrCreateInstallationId();
  ctx.chrome.__storageSetFails = true;

  const res = await ctx.service.handleLicenseServiceMessage({ type: "ACTIVATE_LICENSE", licenseKey: "CLOAKLI-TEST-PRO" });
  assert.equal(res.ok, false);
  assert.equal(res.error, "storage_write_failed");
  assert.ok(!ctx.chrome.__storageData[ctx.client.ENTITLEMENT_STORAGE_KEY]);
});

test("ACTIVATE_LICENSE: 유효하지 않은 키는 실패로 응답하고 상태는 free 그대로다", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const ctx = createServiceContext({ fetchImpl: fetchToWorker(serverEnv) });

  const res = await ctx.service.handleLicenseServiceMessage({ type: "ACTIVATE_LICENSE", licenseKey: "NOT-A-KEY" });
  assert.equal(res.ok, false);
  assert.equal(res.error, "invalid_license");
  assert.equal(res.entitlement.tier, "free");
});

test("RECHECK_LICENSE: 일시 오류(500)에는 Pro가 유지되고, 명시 거부(invalid_token)에만 free로 바뀐다", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const ctx = createServiceContext({ fetchImpl: fetchToWorker(serverEnv) });
  await ctx.service.handleLicenseServiceMessage({ type: "ACTIVATE_LICENSE", licenseKey: "CLOAKLI-TEST-PRO" });

  ctx.setFetch(jsonResponseStub(500, { ok: false, error: "internal_error" }));
  const transient = await ctx.service.handleLicenseServiceMessage({ type: "RECHECK_LICENSE" });
  assert.equal(transient.ok, false);
  assert.equal(transient.transient, true);
  assert.equal(transient.entitlement.tier, "pro", "일시 오류에는 grace 안에서 Pro 유지");

  ctx.setFetch(jsonResponseStub(401, { ok: false, error: "invalid_token" }));
  const definitive = await ctx.service.handleLicenseServiceMessage({ type: "RECHECK_LICENSE" });
  assert.equal(definitive.ok, false);
  assert.equal(definitive.entitlement.tier, "free", "명시 거부에만 free 전환");
  assert.equal(definitive.entitlement.status, "none");
});

test("DEACTIVATE_LICENSE: 레코드가 제거되고 free를 반환한다", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const ctx = createServiceContext({ fetchImpl: fetchToWorker(serverEnv) });
  await ctx.service.handleLicenseServiceMessage({ type: "ACTIVATE_LICENSE", licenseKey: "CLOAKLI-TEST-PRO" });

  const res = await ctx.service.handleLicenseServiceMessage({ type: "DEACTIVATE_LICENSE" });
  assert.equal(res.ok, true);
  assert.equal(res.entitlement.tier, "free");
  assert.ok(!ctx.chrome.__storageData[ctx.client.ENTITLEMENT_STORAGE_KEY]);
});

test("GET_LICENSE_DIAGNOSTICS: 진단 정보에 비밀값이 없고 필요한 필드가 있다", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const ctx = createServiceContext({ fetchImpl: fetchToWorker(serverEnv) });
  await ctx.service.handleLicenseServiceMessage({ type: "ACTIVATE_LICENSE", licenseKey: "CLOAKLI-TEST-PRO" });

  const res = await ctx.service.handleLicenseServiceMessage({ type: "GET_LICENSE_DIAGNOSTICS" });
  assert.equal(res.ok, true);
  const d = res.diagnostics;
  assert.equal(d.tier, "pro");
  assert.equal(d.hasSessionToken, true);
  assert.equal(d.schemaVersion, 1);
  assert.ok(typeof d.lastValidatedAt === "number");
  assert.ok(typeof d.graceUntil === "number");
  assert.equal(d.buildMode, "development");
  assert.equal(d.licenseServerHost, "license.example.com");

  const record = ctx.chrome.__storageData[ctx.client.ENTITLEMENT_STORAGE_KEY];
  assert.ok(!JSON.stringify(res).includes(record.sessionToken), "진단에 세션 토큰 원문이 있으면 안 된다");
});

test("서비스 메시지가 아닌 것은 isLicenseServiceMessage가 걸러낸다 (content 메시지와 충돌 없음)", async () => {
  await loadServer();
  const ctx = createServiceContext({});
  assert.equal(ctx.service.isLicenseServiceMessage({ type: "GET_ENTITLEMENT" }), true);
  assert.equal(ctx.service.isLicenseServiceMessage({ type: "START_SELECTION_MODE" }), false);
  assert.equal(ctx.service.isLicenseServiceMessage(null), false);
  const res = await ctx.service.handleLicenseServiceMessage({ type: "SOMETHING_ELSE" });
  assert.equal(res.ok, false);
  assert.equal(res.error, "unknown_message");
});

test("popup과 content script(다른 컨텍스트)가 같은 storage에서 같은 Pro 판정을 받는다", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const bg = createServiceContext({ fetchImpl: fetchToWorker(serverEnv) });
  await bg.service.handleLicenseServiceMessage({ type: "ACTIVATE_LICENSE", licenseKey: "CLOAKLI-TEST-PRO" });

  // popup이 받을 응답
  const popupView = await bg.service.handleLicenseServiceMessage({ type: "GET_ENTITLEMENT" });
  // content script: 같은 storage를 prime한 별도 컨텍스트
  const content = createServiceContext({ initialStorage: bg.chrome.__storageData });
  await content.client.primeLicenseEntitlementCache();
  const contentState = content.entitlement.getEntitlementState();

  assert.equal(popupView.entitlement.tier, "pro");
  assert.equal(contentState.plan, "pro");
  assert.equal(content.entitlement.isProUser(popupView.entitlement), content.entitlement.isProUser(contentState), "두 컨텍스트의 판정이 같아야 한다");
});

// ---------------------------------------------------------------------
// popup 로딩 상태: 응답 전 Free로 표시하지 않는다
// ---------------------------------------------------------------------

test("popup은 background 응답 전에 Free가 아니라 '요금제 확인 중…'을 표시하고, 응답 후 Pro를 표시한다", async () => {
  const entitlementRecord = {
    schemaVersion: 1,
    tier: "pro",
    source: "license",
    status: "active",
    sessionToken: "tok-".padEnd(40, "x"),
    licenseDisplaySuffix: "1234",
    expiresAt: null,
    lastValidatedAt: Date.now(),
    graceUntil: Date.now() + 6 * 24 * 60 * 60 * 1000,
    activatedAt: Date.now(),
  };
  const env = createPopupEnv({
    chrome: { initialStorage: { "cloakli.entitlement.v1": entitlementRecord } },
    backgroundDelayMs: 120, // background 응답을 일부러 늦춘다
  });
  env.loadPopupScript({ buildConfig: { mode: "development", developerPro: false, debug: false, licenseServerUrl: "https://license.example.com" } });
  await new Promise((r) => setTimeout(r, 40)); // 응답(120ms) 전

  const badge = env.document.getElementById("cloakli-plan-badge");
  assert.equal(badge.textContent, "요금제 확인 중…", "응답 전에는 확인 중으로 표시");
  assert.ok(!/Free/.test(badge.textContent), "응답 전에 Free로 표시하면 안 된다");
  assert.equal(env.document.getElementById("cloakli-license-free-actions").hidden, true, "응답 전에 Free용 버튼을 보여주면 안 된다");

  await new Promise((r) => setTimeout(r, 250));
  assert.match(badge.textContent, /Pro/, "응답 후 Pro 표시");
  assert.equal(env.document.getElementById("cloakli-license-active-info").hidden, false);
  assert.equal(env.document.getElementById("cloakli-license-masked-key").textContent, "•••• 1234");
});

test("popup 재오픈: 이전 팝업이 활성화한 상태를 새 팝업이 background 응답으로 그대로 복원한다 (통합 레코드 경유)", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const first = createPopupEnv({ fetchImpl: fetchToWorker(serverEnv) });
  first.loadPopupScript({ buildConfig: { mode: "development", developerPro: false, debug: false, licenseServerUrl: "https://license.example.com" } });
  await new Promise((r) => setTimeout(r, 60));

  first.click(first.document.getElementById("cloakli-show-license-input-btn"));
  first.document.getElementById("cloakli-license-key-input").value = "CLOAKLI-TEST-PRO";
  first.click(first.document.getElementById("cloakli-activate-license-btn"));
  await new Promise((r) => setTimeout(r, 300));
  assert.match(first.document.getElementById("cloakli-license-message").textContent, /Pro가 활성화되었습니다/);

  // 팝업 재오픈: 같은 storage, 완전히 새로운 popup+background 컨텍스트. 네트워크는 죽어
  // 있어도(오프라인) 저장된 레코드만으로 Pro가 복원되어야 한다.
  const reopened = createPopupEnv({
    chrome: { initialStorage: first.chrome.__storageData },
    fetchImpl: () => Promise.reject(new TypeError("offline")),
  });
  reopened.loadPopupScript({ buildConfig: { mode: "development", developerPro: false, debug: false, licenseServerUrl: "https://license.example.com" } });
  await new Promise((r) => setTimeout(r, 100));

  assert.match(reopened.document.getElementById("cloakli-plan-badge").textContent, /Pro/);
  assert.equal(reopened.document.getElementById("cloakli-license-active-info").hidden, false);
  assert.equal(reopened.document.getElementById("cloakli-license-masked-key").textContent, "•••• -PRO");
});

// ---------------------------------------------------------------------
// content script의 Pro 게이팅: 판정의 근거는 background 응답 하나다
// ---------------------------------------------------------------------
const { createEnv, wait: waitMs, waitUntil } = require("./helpers/fake-browser-env");

function buildCards(env, hostnameClass) {
  const grid = env.document.createElement("div");
  grid.className = "grid";
  const cards = [];
  for (let i = 0; i < 3; i++) {
    const card = env.document.createElement("div");
    card.className = "gate-card";
    const img = env.document.createElement("img");
    img.className = "gate-visual";
    card.appendChild(img);
    grid.appendChild(card);
    cards.push({ card, img });
  }
  env.document.body.appendChild(grid);
  return cards;
}

function stubBackground(env, entitlement) {
  env.chrome.runtime.sendMessage = (message, cb) => {
    if (message && message.type === "GET_ENTITLEMENT") {
      setTimeout(() => cb({ ok: true, entitlement }), 0);
      return;
    }
    setTimeout(() => cb(undefined), 0);
  };
}

test("content: 로컬 캐시가 free여도 background가 pro라고 답하면 Pro 범위가 열리고 저장까지 된다", async () => {
  const env = createEnv("https://gate.example.com/feed");
  const cards = buildCards(env);
  stubBackground(env, { tier: "pro", source: "license", status: "active", expiresAt: null, lastValidatedAt: Date.now(), licenseDisplaySuffix: "1234" });
  env.loadContentScript(); // 로컬 판정은 기본 free
  await waitMs(20);

  await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
  env.dispatch(cards[0].img, "click");
  await waitUntil(() => env.document.getElementById("cloakli-scope-picker-root"));

  const root = env.document.getElementById("cloakli-scope-picker-root");
  const buttons = root.children.filter((c) => c.tagName === "BUTTON" && c.className === "cloakli-scope-picker-option");
  assert.ok(!buttons[1].disabled, "page 범위 버튼이 열려 있어야 한다");
  const hasProBadge = buttons[1].children.some((c) => c.className === "cloakli-scope-picker-pro-badge");
  assert.equal(hasProBadge, false, "Pro 사용자에게 PRO 잠금 배지를 보여주면 안 된다");

  env.dispatch(buttons[1], "click"); // page 범위 저장
  await waitUntil(() => env.getStoredRules("gate.example.com").length === 1);
  assert.equal(env.getStoredRules("gate.example.com")[0].scope, "page", "background 판정으로 Pro 범위 저장 성공");
});

test("content: background가 free라고 답하면 로컬 캐시가 pro여도 Free 제한이 적용된다", async () => {
  const env = createEnv("https://gate.example.com/feed");
  const cards = buildCards(env);
  stubBackground(env, { tier: "free", source: "free", status: "none", expiresAt: null, lastValidatedAt: null, licenseDisplaySuffix: null });
  env.loadContentScript({ entitlementOverride: { plan: "pro", source: "license_server", isPro: true } });
  await waitMs(20);

  await env.sendRuntimeMessage({ type: "START_SELECTION_MODE" });
  env.dispatch(cards[0].img, "click");
  await waitUntil(() => env.document.getElementById("cloakli-scope-picker-root"));

  const root = env.document.getElementById("cloakli-scope-picker-root");
  const buttons = root.children.filter((c) => c.tagName === "BUTTON" && c.className === "cloakli-scope-picker-option");
  const hasProBadge = buttons[1].children.some((c) => c.className === "cloakli-scope-picker-pro-badge");
  assert.equal(hasProBadge, true, "background가 free면 PRO 잠금 배지가 표시되어야 한다");

  env.dispatch(buttons[1], "click"); // Free에서 page 범위 시도 → 차단
  await waitMs(50);
  assert.equal(env.getStoredRules("gate.example.com").length, 0, "background가 free면 Pro 범위 저장이 차단되어야 한다");
});
