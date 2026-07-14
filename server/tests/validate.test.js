import { test, describe } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { createTestEnv, makeRequest } from "./helpers/test-env.js";

async function activateAndGetToken(env, overrides) {
  const res = await worker.fetch(
    makeRequest("/v1/license/activate", {
      method: "POST",
      body: Object.assign({ licenseKey: "CLOAKLI-TEST-PRO", installationId: "install-1", extensionVersion: "0.1.0" }, overrides),
    }),
    env
  );
  const body = await res.json();
  return body.sessionToken;
}

function validateRequest(token, body) {
  return makeRequest("/v1/license/validate", {
    method: "POST",
    headers: token ? { Authorization: "Bearer " + token } : {},
    body: body || {},
  });
}

describe("POST /v1/license/validate", () => {
  test("토큰 없이 요청하면 401을 반환한다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(validateRequest(null), env);
    assert.equal(res.status, 401);
  });

  test("잘못된 토큰은 401을 반환한다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(validateRequest("not-a-real-token"), env);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "invalid_token");
  });

  test("유효한 세션 토큰으로 검증하면 pro entitlement를 받는다", async () => {
    const env = createTestEnv();
    const token = await activateAndGetToken(env);
    const res = await worker.fetch(validateRequest(token, { installationId: "install-1" }), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.entitlement.isPro, true);
  });

  test("다른 installationId로 같은 토큰을 사용하면 거부된다", async () => {
    const env = createTestEnv();
    const token = await activateAndGetToken(env);
    const res = await worker.fetch(validateRequest(token, { installationId: "someone-elses-install" }), env);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "installation_mismatch");
  });

  test("비활성화된 instance의 토큰은 거부된다", async () => {
    const env = createTestEnv();
    const token = await activateAndGetToken(env);
    await worker.fetch(
      makeRequest("/v1/license/deactivate", { method: "POST", headers: { Authorization: "Bearer " + token } }),
      env
    );
    const res = await worker.fetch(validateRequest(token, { installationId: "install-1" }), env);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "instance_deactivated");
  });

  test("webhook이 구독 취소를 반영하면 다음 validate에서 즉시 free로 전환된다", async () => {
    const env = createTestEnv();
    const token = await activateAndGetToken(env, { licenseKey: "CLOAKLI-TEST-PRO" });

    // 서버가 이미 알고 있는 라이선스를 직접 만료 상태로 갱신한다(webhook이 하는 일을 흉내낸다).
    const license = await env.__testRepo.findLicenseByKeyHash(
      await (await import("../src/utils/hash.js")).sha256Hex("CLOAKLI-TEST-PRO")
    );
    await env.__testRepo.upsertLicenseFromProvider({
      keyHash: license.license_key_hash,
      provider: license.provider,
      providerLicenseId: license.provider_license_id,
      status: "expired",
      productId: license.product_id,
      variantId: license.variant_id,
      activationLimit: license.activation_limit,
      expiresAt: license.expires_at,
    });

    const res = await worker.fetch(validateRequest(token, { installationId: "install-1" }), env);
    const body = await res.json();
    assert.equal(body.entitlement.isPro, false, "취소/만료 상태가 반영되면 즉시 free여야 한다");
  });

  test("설치 인스턴스별 검증 요청이 rate limit을 초과하면 429를 반환한다", async () => {
    const env = createTestEnv();
    const token = await activateAndGetToken(env);
    let lastStatus = 200;
    for (let i = 0; i < 35; i++) {
      const res = await worker.fetch(validateRequest(token, { installationId: "install-1" }), env);
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 429);
  });

  test("네트워크 실패는 이 서버 테스트 범위 밖이다 - offline grace는 확장 프로그램 쪽(entitlement.js)에서 검증한다", () => {
    // 서버는 항상 "지금 서버가 아는 최신 상태"만 반환한다. 오프라인 유예는 서버에 도달하지
    // 못했을 때의 클라이언트 정책이므로 tests/popup.test.js 등 확장 프로그램 테스트에서 다룬다.
    assert.ok(true);
  });
});
