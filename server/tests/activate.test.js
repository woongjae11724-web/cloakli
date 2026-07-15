import { test, describe } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { createTestEnv, makeRequest } from "./helpers/test-env.js";

function activateBody(overrides) {
  return Object.assign(
    { licenseKey: "CLOAKLI-TEST-PRO", installationId: "install-1", extensionVersion: "0.1.0" },
    overrides
  );
}

describe("POST /v1/license/activate", () => {
  test("잘못된 JSON은 400을 반환한다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(makeRequest("/v1/license/activate", { method: "POST", body: "not json" }), env);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "invalid_json");
  });

  test("필수 필드가 없으면 400과 필드 목록을 반환한다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(makeRequest("/v1/license/activate", { method: "POST", body: { licenseKey: "x" } }), env);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "missing_fields");
    assert.ok(body.fields.includes("installationId"));
  });

  test("유효한 테스트 키(CLOAKLI-TEST-PRO)로 활성화하면 sessionToken과 pro entitlement를 받는다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(makeRequest("/v1/license/activate", { method: "POST", body: activateBody() }), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.sessionToken && body.sessionToken.length >= 32);
    assert.equal(body.entitlement.plan, "pro");
    assert.equal(body.entitlement.source, "license_server");
    assert.equal(body.entitlement.isPro, true);
  });

  test("만료된 키(CLOAKLI-TEST-EXPIRED)는 세션 토큰 없이 400 license_expired로 거부된다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(
      makeRequest("/v1/license/activate", { method: "POST", body: activateBody({ licenseKey: "CLOAKLI-TEST-EXPIRED" }) }),
      env
    );
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error, "license_expired");
    assert.equal(body.sessionToken, undefined, "유효하지 않은 라이선스에 세션 토큰을 발급하면 안 된다");
  });

  test("inactive 키(CLOAKLI-TEST-INACTIVE)는 400 license_not_active로 거부된다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(
      makeRequest("/v1/license/activate", { method: "POST", body: activateBody({ licenseKey: "CLOAKLI-TEST-INACTIVE" }) }),
      env
    );
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, "license_not_active");
    assert.equal(body.sessionToken, undefined);
  });

  test("disabled 키(CLOAKLI-TEST-DISABLED)는 400 license_disabled로 거부된다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(
      makeRequest("/v1/license/activate", { method: "POST", body: activateBody({ licenseKey: "CLOAKLI-TEST-DISABLED" }) }),
      env
    );
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, "license_disabled");
    assert.equal(body.sessionToken, undefined);
  });

  test("비활성 라이선스 활성화 거부는 기기 슬롯(instance)을 만들지 않는다", async () => {
    const env = createTestEnv();
    await worker.fetch(
      makeRequest("/v1/license/activate", { method: "POST", body: activateBody({ licenseKey: "CLOAKLI-TEST-EXPIRED" }) }),
      env
    );
    const summary = await env.__testRepo.getAdminSummary();
    assert.equal(summary.activeInstances, 0, "거부된 활성화가 instance를 남기면 안 된다");
  });

  test("허용되지 않은 확장 프로그램 ID(Origin)의 활성화는 403 origin_not_allowed로 거부된다", async () => {
    const env = createTestEnv({ ENVIRONMENT: "production" });
    const res = await worker.fetch(
      makeRequest("/v1/license/activate", {
        method: "POST",
        body: activateBody(),
        origin: "chrome-extension://" + "b".repeat(32),
      }),
      env
    );
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "origin_not_allowed");
  });

  test("production 환경에서 Mock provider 설정(test/live 불일치)은 요청을 처리하지 않는다", async () => {
    const env = createTestEnv({ ENVIRONMENT: "production", LICENSE_PROVIDER: "mock" });
    const res = await worker.fetch(makeRequest("/v1/license/activate", { method: "POST", body: activateBody() }), env);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "provider_unavailable");
    assert.equal(body.sessionToken, undefined);
  });

  test("존재하지 않는 라이선스 키는 400 invalid_license를 반환한다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(
      makeRequest("/v1/license/activate", { method: "POST", body: activateBody({ licenseKey: "NOT-A-REAL-KEY" }) }),
      env
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "invalid_license");
  });

  test("activation_limit을 초과하면 409를 반환한다(CLOAKLI-TEST-LIMIT은 한도 1)", async () => {
    const env = createTestEnv();
    const first = await worker.fetch(
      makeRequest("/v1/license/activate", { method: "POST", body: activateBody({ licenseKey: "CLOAKLI-TEST-LIMIT", installationId: "install-A" }) }),
      env
    );
    assert.equal(first.status, 200);

    const second = await worker.fetch(
      makeRequest("/v1/license/activate", { method: "POST", body: activateBody({ licenseKey: "CLOAKLI-TEST-LIMIT", installationId: "install-B" }) }),
      env
    );
    assert.equal(second.status, 409);
    const body = await second.json();
    assert.equal(body.error, "activation_limit_reached");
  });

  test("같은 설치가 같은 키로 다시 활성화하면 한도 초과로 막히지 않는다(재활성화)", async () => {
    const env = createTestEnv();
    const first = await worker.fetch(
      makeRequest("/v1/license/activate", { method: "POST", body: activateBody({ licenseKey: "CLOAKLI-TEST-LIMIT", installationId: "install-same" }) }),
      env
    );
    assert.equal(first.status, 200);

    const second = await worker.fetch(
      makeRequest("/v1/license/activate", { method: "POST", body: activateBody({ licenseKey: "CLOAKLI-TEST-LIMIT", installationId: "install-same" }) }),
      env
    );
    assert.equal(second.status, 200, "같은 설치의 재활성화는 activation_limit을 새로 소비하지 않아야 한다");
  });

  test("product/variant 설정과 다른 라이선스는 거부된다", async () => {
    const env = createTestEnv({ LEMONSQUEEZY_PRODUCT_ID: "some-other-product" });
    const res = await worker.fetch(makeRequest("/v1/license/activate", { method: "POST", body: activateBody() }), env);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "product_mismatch");
  });

  test("설치별 활성화 요청이 rate limit을 초과하면 429를 반환한다", async () => {
    const env = createTestEnv();
    let lastStatus = 200;
    for (let i = 0; i < 12; i++) {
      const res = await worker.fetch(
        makeRequest("/v1/license/activate", { method: "POST", body: activateBody({ installationId: "rate-test-install" }) }),
        env
      );
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 429);
  });

  test("반복적으로 실패하는 라이선스 키는 결국 too_many_attempts로 차단된다", async () => {
    const env = createTestEnv();
    let lastBody = null;
    for (let i = 0; i < 22; i++) {
      const res = await worker.fetch(
        makeRequest("/v1/license/activate", {
          method: "POST",
          body: activateBody({ licenseKey: "ALWAYS-WRONG-KEY", installationId: "install-" + i }),
        }),
        env
      );
      lastBody = await res.json();
    }
    assert.equal(lastBody.error, "too_many_attempts");
  });

  test("동일한 요청을 중복 전송해도 각각 정상 처리된다(활성화 자체는 멱등이 아니라 재검증 가능해야 함)", async () => {
    const env = createTestEnv();
    const res1 = await worker.fetch(
      makeRequest("/v1/license/activate", { method: "POST", body: activateBody({ installationId: "dup-install" }) }),
      env
    );
    const body1 = await res1.json();
    const res2 = await worker.fetch(
      makeRequest("/v1/license/activate", { method: "POST", body: activateBody({ installationId: "dup-install" }) }),
      env
    );
    const body2 = await res2.json();
    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    assert.notEqual(body1.sessionToken, body2.sessionToken, "재요청 시 세션 토큰이 회전해야 한다");
  });
});
