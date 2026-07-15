"use strict";

// License Pro entitlement 유지에 대한 회귀 테스트.
//
// 실제 license-client.js/entitlement.js 소스를 vm으로 그대로 실행하고, fetch는
// 실제 서버 코드(server/src, Mock provider + 메모리 저장소)에 연결한다 — 클라이언트와
// 서버의 응답 형태가 어긋나면 여기서 바로 실패한다.
//
// "팝업 재오픈/서비스 워커 재시작/새 브라우저 세션"은 모두 "새 JS 실행 컨텍스트가
// chrome.storage.local에 남아 있는 값으로 primeLicenseEntitlementCache()를 호출하는 것"
// 이므로, 이전 컨텍스트의 storage 스냅샷으로 새 vm 컨텍스트를 만들어 모의한다.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");
const { createChromeMock } = require("./helpers/fake-popup-env.js");

const ROOT_DIR = path.join(__dirname, "..");
const CORE_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "content-core.js"), "utf8");
const ENTITLEMENT_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "entitlement.js"), "utf8");
const LICENSE_CLIENT_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "license-client.js"), "utf8");

const BUILD_CONFIG_SOURCE = [
  "(function (root) {",
  '  root.CloakliBuildConfig = { mode: "development", developerPro: false, debug: false, licenseServerUrl: "https://license.example.com", checkoutUrl: "" };',
  '})(typeof self !== "undefined" ? self : this);',
].join("\n");

// ---------------------------------------------------------------------
// 실제 서버(server/src) 연결: Mock provider + 메모리 저장소
// ---------------------------------------------------------------------
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

// 새 실행 컨텍스트(팝업/서비스 워커/콘텐츠 스크립트 각각에 해당)를 만든다.
function createLicenseContext(options) {
  const opts = options || {};
  const chromeMock = opts.chrome || createChromeMock({ initialStorage: opts.initialStorage });
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    chrome: chromeMock,
    crypto: globalThis.crypto,
    AbortController: globalThis.AbortController,
    fetch: opts.fetchImpl || (() => Promise.reject(new TypeError("no network"))),
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(CORE_SOURCE, context, { filename: "content-core.js" });
  vm.runInContext(BUILD_CONFIG_SOURCE, context, { filename: "build-config.js" });
  vm.runInContext(ENTITLEMENT_SOURCE, context, { filename: "entitlement.js" });
  vm.runInContext(LICENSE_CLIENT_SOURCE, context, { filename: "license-client.js" });
  return {
    chrome: chromeMock,
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

test("활성화 성공 시 통합 레코드(v1)에 세션 토큰/tier/검증 시각/유예 기한이 저장되고 원본 키는 저장되지 않는다", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const ctx = createLicenseContext({ fetchImpl: fetchToWorker(serverEnv) });

  const result = await ctx.client.activateLicense("CLOAKLI-TEST-PRO");
  assert.equal(result.ok, true);
  assert.ok(!("sessionToken" in (result.entitlement || {})), "activate 반환값(공개 형식)에 세션 토큰이 없어야 한다");

  const stored = ctx.chrome.__storageData;
  const record = stored[ctx.client.ENTITLEMENT_STORAGE_KEY];
  assert.ok(record, "통합 레코드가 저장되어야 한다 (cloakli.entitlement.v1)");
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.tier, "pro");
  assert.equal(record.source, "license");
  assert.equal(record.status, "active");
  assert.ok(typeof record.sessionToken === "string" && record.sessionToken.length >= 32, "세션 토큰 저장");
  assert.equal(record.licenseDisplaySuffix, "-PRO", "표시용 마지막 4자만 저장");
  assert.ok(typeof record.activatedAt === "number");
  assert.ok(typeof record.lastValidatedAt === "number", "마지막 검증 시각 저장");
  assert.ok(typeof record.graceUntil === "number" && record.graceUntil > Date.now(), "오프라인 유예 기한 저장");
  assert.ok(typeof stored[ctx.client.INSTALLATION_ID_KEY] === "string" && stored[ctx.client.INSTALLATION_ID_KEY], "installation ID 저장");
  assert.ok(!stored[ctx.client.LEGACY_SESSION_KEY] && !stored[ctx.client.LEGACY_CACHE_KEY], "이전 버전 키를 새로 만들면 안 된다");

  // 원본 라이선스 키가 storage 어디에도 남지 않는다 (세션 토큰의 우연한 부분 문자열까지 검사하지 않도록 키 전체 문자열로 확인).
  assert.ok(!JSON.stringify(stored).includes("CLOAKLI-TEST-PRO"), "원본 라이선스 키를 저장하면 안 된다");

  assert.equal(ctx.entitlement.getEntitlementState().plan, "pro", "활성화 직후 이 컨텍스트가 Pro로 판정");
  // 인메모리 캐시(공개 부분)에는 세션 토큰이 들어가면 안 된다.
  const cached = ctx.entitlement.getCachedLicenseEntitlement();
  assert.ok(cached && !("sessionToken" in cached), "인메모리 캐시에 세션 토큰을 넣으면 안 된다");
});

test("이전 버전의 두 키(cloakliLicenseSession/cloakliLicenseCache)는 통합 레코드로 migration되고 Pro가 유지된다", async () => {
  await loadServer();
  const legacy = {
    cloakliLicenseSession: { sessionToken: "legacy-token-0123456789abcdef0123456789abcdef", licenseKeyLast4: "1234", activatedAt: Date.now() - 1000 },
    cloakliLicenseCache: {
      plan: "pro",
      source: "license_server",
      isPro: true,
      status: "active",
      expiresAt: null,
      validatedAt: Date.now() - 1000,
      offlineValidUntil: Date.now() + 6 * 24 * 60 * 60 * 1000,
    },
  };
  const ctx = createLicenseContext({ initialStorage: legacy });
  await ctx.client.primeLicenseEntitlementCache();

  assert.equal(ctx.entitlement.getEntitlementState().plan, "pro", "migration 후 Pro 유지");
  const stored = ctx.chrome.__storageData;
  const record = stored[ctx.client.ENTITLEMENT_STORAGE_KEY];
  assert.ok(record && record.schemaVersion === 1 && record.tier === "pro", "통합 레코드 생성");
  assert.equal(record.sessionToken, legacy.cloakliLicenseSession.sessionToken, "세션 토큰 이전");
  assert.equal(record.licenseDisplaySuffix, "1234");
  assert.ok(!stored.cloakliLicenseSession && !stored.cloakliLicenseCache, "이전 키는 제거되어야 한다");

  // migration은 여러 번 실행해도 안전하다.
  await ctx.client.primeLicenseEntitlementCache();
  assert.equal(ctx.entitlement.getEntitlementState().plan, "pro");
});

test("세션 토큰 없이 캐시만 남은 손상된 legacy 상태는 Pro로 복원하지 않고 정리한다", async () => {
  await loadServer();
  const ctx = createLicenseContext({
    initialStorage: {
      cloakliLicenseCache: { plan: "pro", isPro: true, status: "active", validatedAt: Date.now(), offlineValidUntil: Date.now() + 1000000 },
    },
  });
  await ctx.client.primeLicenseEntitlementCache();
  assert.equal(ctx.entitlement.getEntitlementState().plan, "free");
  assert.ok(!ctx.chrome.__storageData[ctx.client.ENTITLEMENT_STORAGE_KEY], "손상 상태에서 레코드를 만들면 안 된다");
});

test("구조가 손상된 통합 레코드(스키마 불일치)는 항상 free로 판정되고 status는 invalid다", async () => {
  await loadServer();
  const ctx = createLicenseContext({
    initialStorage: {
      "cloakli.entitlement.v1": { schemaVersion: 99, tier: "pro", status: "active", sessionToken: "x".repeat(40), graceUntil: Date.now() + 1000000 },
    },
  });
  await ctx.client.primeLicenseEntitlementCache();
  assert.equal(ctx.entitlement.getEntitlementState().plan, "free", "손상 레코드는 free");
  assert.equal(ctx.entitlement.toPublicEntitlement().status, "invalid");
});

test("팝업 재오픈/서비스 워커 재시작/새 브라우저 세션을 모의해도 Pro가 유지된다", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const first = createLicenseContext({ fetchImpl: fetchToWorker(serverEnv) });
  await first.client.activateLicense("CLOAKLI-TEST-PRO");

  // 팝업 재오픈: 새 컨텍스트 + 같은 storage + prime
  const reopened = createLicenseContext({ initialStorage: first.chrome.__storageData, fetchImpl: fetchToWorker(serverEnv) });
  assert.equal(reopened.entitlement.getEntitlementState().plan, "free", "prime 전 초기값은 free(안전한 기본값)");
  await reopened.client.primeLicenseEntitlementCache();
  assert.equal(reopened.entitlement.getEntitlementState().plan, "pro", "재오픈 후 Pro 복원");

  // 서비스 워커 재시작: 또 다른 새 컨텍스트에서 background와 같은 순서(prime → validate)
  const restartedSw = createLicenseContext({ initialStorage: first.chrome.__storageData, fetchImpl: fetchToWorker(serverEnv) });
  await restartedSw.client.primeLicenseEntitlementCache();
  const validated = await restartedSw.client.validateLicense();
  assert.equal(validated.ok, true, "재시작 후 서버 재검증 성공");
  assert.equal(restartedSw.entitlement.getEntitlementState().plan, "pro");

  // 새 브라우저 세션: 네트워크가 아직 없어도(offline) 저장된 캐시로 Pro가 복원되어야 한다.
  const newSession = createLicenseContext({ initialStorage: first.chrome.__storageData });
  await newSession.client.primeLicenseEntitlementCache();
  assert.equal(newSession.entitlement.getEntitlementState().plan, "pro", "오프라인 새 세션에서도 유예 기간 내 Pro 유지");
});

test("활성화 후 실제 Pro 기능이 열린다: Free 한도(사이트 1/규칙 3/element 범위)가 적용되지 않는다", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const ctx = createLicenseContext({ fetchImpl: fetchToWorker(serverEnv) });
  await ctx.client.activateLicense("CLOAKLI-TEST-PRO");

  const state = ctx.entitlement.getEntitlementState();
  const manyRules = {
    "a.example.com": [1, 2, 3].map((i) => ({ hostname: "a.example.com", selector: "#a" + i, scope: "element" })),
    "b.example.com": [{ hostname: "b.example.com", selector: "#b1", scope: "element" }],
  };
  // Free라면 전부 차단되는 조합: 새 hostname + site 범위 + 총 규칙 4개 초과
  const decision = ctx.entitlement.canCreateRule({
    entitlementState: state,
    allRulesByHostname: manyRules,
    hostname: "c.example.com",
    scope: "site",
  });
  // vm 컨텍스트에서 만들어진 객체는 프로토타입이 달라 deepStrictEqual을 쓸 수 없다.
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, null);

  // 같은 조건이 Free에서는 차단되는지 대조 확인(테스트 자체의 유효성 확인용)
  const freeDecision = ctx.entitlement.canCreateRule({
    entitlementState: { plan: "free", isPro: false },
    allRulesByHostname: manyRules,
    hostname: "c.example.com",
    scope: "site",
  });
  assert.equal(freeDecision.allowed, false);
});

test("validate 일시 실패(500/429/파싱 불가 응답/origin 거부)에는 세션과 캐시를 보존하고 유예 기간 동안 Pro를 유지한다", async () => {
  await loadServer();
  for (const [name, stub] of [
    ["500 internal_error", jsonResponseStub(500, { ok: false, error: "internal_error" })],
    ["429 rate_limited", jsonResponseStub(429, { ok: false, error: "rate_limited" })],
    ["파싱 불가 응답", async () => ({ status: 522, json: async () => { throw new Error("not json"); } })],
    ["403 origin_not_allowed", jsonResponseStub(403, { ok: false, error: "origin_not_allowed" })],
  ]) {
    const serverEnv = makeServerEnv();
    const ctx = createLicenseContext({ fetchImpl: fetchToWorker(serverEnv) });
    await ctx.client.activateLicense("CLOAKLI-TEST-PRO");

    ctx.setFetch(stub);
    const result = await ctx.client.validateLicense();
    assert.equal(result.ok, false, name);
    assert.ok(!result.offline, name + ": 네트워크 단절과는 구분된다");
    assert.ok(ctx.chrome.__storageData[ctx.client.ENTITLEMENT_STORAGE_KEY], name + ": 통합 레코드 보존");
    assert.equal(ctx.entitlement.getEntitlementState().plan, "pro", name + ": grace 동안 Pro 유지");
  }
});

test("네트워크 단절(fetch 실패)에도 즉시 Free로 강등하지 않는다", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const ctx = createLicenseContext({ fetchImpl: fetchToWorker(serverEnv) });
  await ctx.client.activateLicense("CLOAKLI-TEST-PRO");

  ctx.setFetch(() => Promise.reject(new TypeError("network down")));
  const result = await ctx.client.validateLicense();
  assert.equal(result.ok, false);
  assert.equal(result.offline, true);
  assert.equal(ctx.entitlement.getEntitlementState().plan, "pro");
});

test("서버가 세션을 명확히 거부(invalid_token/instance_deactivated)한 경우에만 로컬 세션을 정리하고 Free로 전환한다", async () => {
  await loadServer();
  for (const [code, status] of [["invalid_token", 401], ["instance_deactivated", 403]]) {
    const serverEnv = makeServerEnv();
    const ctx = createLicenseContext({ fetchImpl: fetchToWorker(serverEnv) });
    await ctx.client.activateLicense("CLOAKLI-TEST-PRO");

    ctx.setFetch(jsonResponseStub(status, { ok: false, error: code }));
    const result = await ctx.client.validateLicense();
    assert.equal(result.ok, false);
    assert.equal(result.error, code);
    assert.ok(!ctx.chrome.__storageData[ctx.client.ENTITLEMENT_STORAGE_KEY], code + ": 통합 레코드 제거");
    assert.equal(ctx.entitlement.getEntitlementState().plan, "free");
  }
});

test("오프라인 유예 기한이 지난 캐시는 재검증 없이는 Free로 판정된다(완전 만료 시 Free 전환)", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const ctx = createLicenseContext({ fetchImpl: fetchToWorker(serverEnv) });
  await ctx.client.activateLicense("CLOAKLI-TEST-PRO");

  // 저장된 캐시의 유예 기한을 과거로 조작한 뒤 새 컨텍스트에서 prime — 시간 경과를 모의한다.
  const stored = ctx.chrome.__storageData;
  stored[ctx.client.ENTITLEMENT_STORAGE_KEY].graceUntil = Date.now() - 1000;
  const later = createLicenseContext({ initialStorage: stored });
  await later.client.primeLicenseEntitlementCache();
  assert.equal(later.entitlement.getEntitlementState().plan, "free");
});

test("명시적 비활성화(deactivateLicense)는 세션을 정리하고 Free로 전환한다", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const ctx = createLicenseContext({ fetchImpl: fetchToWorker(serverEnv) });
  await ctx.client.activateLicense("CLOAKLI-TEST-PRO");

  const result = await ctx.client.deactivateLicense();
  assert.equal(result.ok, true);
  assert.ok(!ctx.chrome.__storageData[ctx.client.ENTITLEMENT_STORAGE_KEY]);
  assert.equal(ctx.entitlement.getEntitlementState().plan, "free");
});

test("chrome.storage 저장이 실패하면 활성화를 성공으로 처리하지 않는다", async () => {
  await loadServer();
  const serverEnv = makeServerEnv();
  const ctx = createLicenseContext({ fetchImpl: fetchToWorker(serverEnv) });
  // installation ID 생성 저장은 성공시키고, 활성화 결과 저장부터 실패시킨다.
  await ctx.client.getOrCreateInstallationId();
  ctx.chrome.__storageSetFails = true;

  const result = await ctx.client.activateLicense("CLOAKLI-TEST-PRO");
  assert.equal(result.ok, false);
  assert.equal(result.error, "storage_write_failed");
  assert.ok(!ctx.chrome.__storageData[ctx.client.ENTITLEMENT_STORAGE_KEY], "레코드가 저장되지 않았어야 한다");
  assert.equal(ctx.entitlement.getEntitlementState().plan, "free", "인메모리도 Pro로 표시하면 안 된다(팝업에서만 Pro인 상태 금지)");
});

test("서버가 세션 토큰과 함께 비활성 entitlement를 돌려주는 이상 응답은 활성화 실패로 처리한다", async () => {
  await loadServer();
  for (const [status, expectedError] of [["expired", "license_expired"], ["disabled", "license_disabled"], ["inactive", "license_not_active"]]) {
    const ctx = createLicenseContext({
      fetchImpl: jsonResponseStub(200, {
        ok: true,
        sessionToken: "x".repeat(40),
        entitlement: { plan: "free", source: "default", isPro: false, status, expiresAt: null, validatedAt: Date.now(), offlineValidUntil: Date.now() },
      }),
    });
    const result = await ctx.client.activateLicense("SOME-KEY-1234");
    assert.equal(result.ok, false, status);
    assert.equal(result.error, expectedError, status);
    assert.ok(!ctx.chrome.__storageData[ctx.client.ENTITLEMENT_STORAGE_KEY], status + ": 레코드 미저장");
    assert.equal(ctx.entitlement.getEntitlementState().plan, "free", status);
  }
});

test("만료/비활성 라이선스 활성화는 서버가 거부하고 클라이언트는 아무것도 저장하지 않는다 (end-to-end)", async () => {
  await loadServer();
  for (const [key, expectedError] of [
    ["CLOAKLI-TEST-EXPIRED", "license_expired"],
    ["CLOAKLI-TEST-INACTIVE", "license_not_active"],
    ["CLOAKLI-TEST-DISABLED", "license_disabled"],
  ]) {
    const serverEnv = makeServerEnv();
    const ctx = createLicenseContext({ fetchImpl: fetchToWorker(serverEnv) });
    const result = await ctx.client.activateLicense(key);
    assert.equal(result.ok, false, key);
    assert.equal(result.error, expectedError, key);
    assert.ok(!ctx.chrome.__storageData[ctx.client.ENTITLEMENT_STORAGE_KEY], key);
    assert.equal(ctx.entitlement.getEntitlementState().plan, "free", key);
  }
});

test("허용되지 않은 확장 프로그램 ID로는 활성화가 거부되고(origin_not_allowed) 세션이 저장되지 않는다", async () => {
  await loadServer();
  const serverEnv = makeServerEnv({ ENVIRONMENT: "production", ALLOWED_EXTENSION_IDS: "a".repeat(32) });
  // TEST_ORIGIN(b...가 아닌 abcdefghijklmnop...)은 allowlist에 없다 → 403
  const ctx = createLicenseContext({ fetchImpl: fetchToWorker(serverEnv) });
  const result = await ctx.client.activateLicense("CLOAKLI-TEST-PRO");
  assert.equal(result.ok, false);
  assert.equal(result.error, "origin_not_allowed");
  assert.ok(!ctx.chrome.__storageData[ctx.client.ENTITLEMENT_STORAGE_KEY]);
});

test("클라이언트와 서버의 오프라인 유예/재검증 주기 상수가 일치한다", async () => {
  await loadServer();
  const constants = await import(pathToFileURL(path.join(ROOT_DIR, "server", "src", "utils", "constants.js")).href);
  const ctx = createLicenseContext({});
  assert.equal(ctx.client.OFFLINE_GRACE_PERIOD_MS, constants.OFFLINE_GRACE_PERIOD_MS);
  assert.equal(ctx.client.LICENSE_REVALIDATE_INTERVAL_MS, constants.LICENSE_REVALIDATE_INTERVAL_MS);
});
