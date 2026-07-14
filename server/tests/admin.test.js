import { test, describe } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { createTestEnv, makeRequest, TEST_ADMIN_SECRET } from "./helpers/test-env.js";

describe("GET /v1/admin/license-summary", () => {
  test("Authorization 헤더 없이 요청하면 401을 반환한다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(makeRequest("/v1/admin/license-summary"), env);
    assert.equal(res.status, 401);
  });

  test("잘못된 admin secret은 401을 반환한다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(makeRequest("/v1/admin/license-summary", { headers: { Authorization: "Bearer wrong-secret-value" } }), env);
    assert.equal(res.status, 401);
  });

  test("올바른 admin secret은 집계 숫자만 돌려주고 원본 데이터를 포함하지 않는다", async () => {
    const env = createTestEnv();
    await worker.fetch(
      makeRequest("/v1/license/activate", {
        method: "POST",
        body: { licenseKey: "CLOAKLI-TEST-PRO", installationId: "install-1", extensionVersion: "0.1.0" },
      }),
      env
    );

    const res = await worker.fetch(
      makeRequest("/v1/admin/license-summary", { headers: { Authorization: "Bearer " + TEST_ADMIN_SECRET } }),
      env
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.summary.activeLicenses, "number");
    assert.equal(typeof body.summary.activeInstances, "number");

    const text = JSON.stringify(body);
    assert.ok(!text.includes("CLOAKLI-TEST-PRO"), "라이선스 키 원문이 포함되면 안 된다");
    assert.ok(!text.includes("install-1"), "installation ID 원문이 포함되면 안 된다");
  });
});
