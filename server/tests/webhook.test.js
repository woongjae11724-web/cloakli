import { test, describe } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { createTestEnv, makeRequest, TEST_WEBHOOK_SECRET } from "./helpers/test-env.js";
import { hmacSha256Hex, sha256Hex } from "../src/utils/hash.js";

function licenseKeyPayload(eventName, overrides) {
  return {
    meta: { event_name: eventName, test_mode: true },
    data: {
      id: "1",
      attributes: Object.assign(
        {
          key: "REAL-LOOKING-LICENSE-KEY",
          status: "active",
          activation_limit: 5,
          activation_usage: 0,
          expires_at: null,
          product_id: 111,
          variant_id: 222,
        },
        overrides
      ),
    },
  };
}

async function signedRequest(path, payloadObj, secret) {
  const rawBody = JSON.stringify(payloadObj);
  const signature = secret != null ? await hmacSha256Hex(secret, rawBody) : undefined;
  return makeRequest(path, {
    method: "POST",
    body: rawBody,
    headers: signature ? { "X-Signature": signature } : {},
  });
}

describe("POST /v1/webhooks/lemonsqueezy", () => {
  test("서명이 없으면 401을 반환한다", async () => {
    const env = createTestEnv();
    const payload = licenseKeyPayload("license_key_created");
    const res = await worker.fetch(await signedRequest("/v1/webhooks/lemonsqueezy", payload, null), env);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "missing_signature");
  });

  test("잘못된 서명은 401을 반환한다", async () => {
    const env = createTestEnv();
    const payload = licenseKeyPayload("license_key_created");
    const res = await worker.fetch(await signedRequest("/v1/webhooks/lemonsqueezy", payload, "wrong-secret"), env);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "invalid_signature");
  });

  test("올바른 서명의 license_key_created는 라이선스를 저장하고 200을 반환한다", async () => {
    const env = createTestEnv();
    const payload = licenseKeyPayload("license_key_created");
    const res = await worker.fetch(await signedRequest("/v1/webhooks/lemonsqueezy", payload, TEST_WEBHOOK_SECRET), env);
    assert.equal(res.status, 200);

    const keyHash = await sha256Hex("REAL-LOOKING-LICENSE-KEY");
    const license = await env.__testRepo.findLicenseByKeyHash(keyHash);
    assert.ok(license, "webhook으로 라이선스가 D1(메모리)에 생성되어야 한다");
    assert.equal(license.status, "active");
  });

  test("동일 payload를 다시 보내면 중복 처리 없이 duplicate:true를 반환한다", async () => {
    const env = createTestEnv();
    const payload = licenseKeyPayload("license_key_created", { activation_limit: 3 });
    const req1 = await signedRequest("/v1/webhooks/lemonsqueezy", payload, TEST_WEBHOOK_SECRET);
    await worker.fetch(req1, env);

    const req2 = await signedRequest("/v1/webhooks/lemonsqueezy", payload, TEST_WEBHOOK_SECRET);
    const res2 = await worker.fetch(req2, env);
    const body2 = await res2.json();
    assert.equal(res2.status, 200);
    assert.equal(body2.duplicate, true);
  });

  test("subscription_cancelled 이벤트로 취소 상태를 반영한다(license_key 힌트가 있는 경우)", async () => {
    const env = createTestEnv();
    // 먼저 license_key_created로 라이선스를 만든다.
    await worker.fetch(
      await signedRequest("/v1/webhooks/lemonsqueezy", licenseKeyPayload("license_key_created"), TEST_WEBHOOK_SECRET),
      env
    );

    const cancelPayload = {
      meta: { event_name: "subscription_cancelled" },
      data: {
        id: "999",
        attributes: { status: "cancelled", license_key: "REAL-LOOKING-LICENSE-KEY", ends_at: null },
      },
    };
    const res = await worker.fetch(await signedRequest("/v1/webhooks/lemonsqueezy", cancelPayload, TEST_WEBHOOK_SECRET), env);
    assert.equal(res.status, 200);

    const keyHash = await sha256Hex("REAL-LOOKING-LICENSE-KEY");
    const license = await env.__testRepo.findLicenseByKeyHash(keyHash);
    assert.equal(license.status, "inactive");
  });

  test("subscription_expired 이벤트로 만료 상태를 반영한다", async () => {
    const env = createTestEnv();
    await worker.fetch(
      await signedRequest("/v1/webhooks/lemonsqueezy", licenseKeyPayload("license_key_created"), TEST_WEBHOOK_SECRET),
      env
    );
    const expiredPayload = {
      meta: { event_name: "subscription_expired" },
      data: { id: "998", attributes: { status: "expired", license_key: "REAL-LOOKING-LICENSE-KEY" } },
    };
    await worker.fetch(await signedRequest("/v1/webhooks/lemonsqueezy", expiredPayload, TEST_WEBHOOK_SECRET), env);
    const keyHash = await sha256Hex("REAL-LOOKING-LICENSE-KEY");
    const license = await env.__testRepo.findLicenseByKeyHash(keyHash);
    assert.equal(license.status, "expired");
  });

  test("subscription_payment_failed 이벤트도 오류 없이 처리된다", async () => {
    const env = createTestEnv();
    const payload = {
      meta: { event_name: "subscription_payment_failed" },
      data: { id: "997", attributes: { status: "past_due" } },
    };
    const res = await worker.fetch(await signedRequest("/v1/webhooks/lemonsqueezy", payload, TEST_WEBHOOK_SECRET), env);
    assert.equal(res.status, 200);
  });

  test("subscription_resumed 이벤트도 오류 없이 처리된다", async () => {
    const env = createTestEnv();
    const payload = {
      meta: { event_name: "subscription_resumed" },
      data: { id: "996", attributes: { status: "active", license_key: "REAL-LOOKING-LICENSE-KEY" } },
    };
    const res = await worker.fetch(await signedRequest("/v1/webhooks/lemonsqueezy", payload, TEST_WEBHOOK_SECRET), env);
    assert.equal(res.status, 200);
  });

  test("payload 일부가 누락되어도(license_key 힌트 없음) 서버가 죽지 않고 200을 반환한다", async () => {
    const env = createTestEnv();
    const payload = { meta: { event_name: "subscription_updated" }, data: { id: "1", attributes: { status: "active" } } };
    const res = await worker.fetch(await signedRequest("/v1/webhooks/lemonsqueezy", payload, TEST_WEBHOOK_SECRET), env);
    assert.equal(res.status, 200);
  });

  test("secret이 설정되어 있지 않으면 500을 반환한다(오조작 방지)", async () => {
    const env = createTestEnv({ LEMONSQUEEZY_WEBHOOK_SECRET: "" });
    const payload = licenseKeyPayload("license_key_created");
    const res = await worker.fetch(await signedRequest("/v1/webhooks/lemonsqueezy", payload, "anything"), env);
    assert.equal(res.status, 500);
  });

  test("깨진 JSON body는 400을 반환한다(서명은 원문 기준으로 먼저 검증됨)", async () => {
    const env = createTestEnv();
    const rawBody = "{ not valid json";
    const signature = await hmacSha256Hex(TEST_WEBHOOK_SECRET, rawBody);
    const res = await worker.fetch(
      makeRequest("/v1/webhooks/lemonsqueezy", { method: "POST", body: rawBody, headers: { "X-Signature": signature } }),
      env
    );
    assert.equal(res.status, 400);
  });

  test("개인정보나 원본 payload가 오류 응답에 포함되지 않는다", async () => {
    const env = createTestEnv();
    const payload = licenseKeyPayload("license_key_created", { key: "SUPER-SECRET-KEY-TEXT" });
    const res = await worker.fetch(await signedRequest("/v1/webhooks/lemonsqueezy", payload, "wrong"), env);
    const text = await res.text();
    assert.ok(!text.includes("SUPER-SECRET-KEY-TEXT"));
    assert.ok(!text.includes(TEST_WEBHOOK_SECRET));
  });
});
