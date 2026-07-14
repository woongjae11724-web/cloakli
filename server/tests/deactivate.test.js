import { test, describe } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { createTestEnv, makeRequest } from "./helpers/test-env.js";

async function activateAndGetToken(env, installationId) {
  const res = await worker.fetch(
    makeRequest("/v1/license/activate", {
      method: "POST",
      body: { licenseKey: "CLOAKLI-TEST-PRO", installationId: installationId || "install-1", extensionVersion: "0.1.0" },
    }),
    env
  );
  return (await res.json()).sessionToken;
}

describe("POST /v1/license/deactivate", () => {
  test("토큰 없이 요청하면 401을 반환한다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(makeRequest("/v1/license/deactivate", { method: "POST" }), env);
    assert.equal(res.status, 401);
  });

  test("유효한 토큰으로 비활성화하면 ok:true를 반환하고, 이후 validate는 거부된다", async () => {
    const env = createTestEnv();
    const token = await activateAndGetToken(env);

    const res = await worker.fetch(
      makeRequest("/v1/license/deactivate", { method: "POST", headers: { Authorization: "Bearer " + token } }),
      env
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    const validateRes = await worker.fetch(
      makeRequest("/v1/license/validate", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: { installationId: "install-1" },
      }),
      env
    );
    assert.equal(validateRes.status, 403);
  });

  test("같은 설치본만 비활성화되고 다른 설치본은 영향받지 않는다", async () => {
    const env = createTestEnv();
    const tokenA = await activateAndGetToken(env, "install-A");
    const tokenB = await activateAndGetToken(env, "install-B");

    await worker.fetch(makeRequest("/v1/license/deactivate", { method: "POST", headers: { Authorization: "Bearer " + tokenA } }), env);

    const resB = await worker.fetch(
      makeRequest("/v1/license/validate", {
        method: "POST",
        headers: { Authorization: "Bearer " + tokenB },
        body: { installationId: "install-B" },
      }),
      env
    );
    assert.equal(resB.status, 200, "다른 설치본(B)은 비활성화되면 안 된다");
    const bodyB = await resB.json();
    assert.equal(bodyB.entitlement.isPro, true);
  });

  test("이미 비활성화된 토큰을 다시 비활성화해도 안전하다(idempotent)", async () => {
    const env = createTestEnv();
    const token = await activateAndGetToken(env);
    await worker.fetch(makeRequest("/v1/license/deactivate", { method: "POST", headers: { Authorization: "Bearer " + token } }), env);
    const second = await worker.fetch(
      makeRequest("/v1/license/deactivate", { method: "POST", headers: { Authorization: "Bearer " + token } }),
      env
    );
    assert.equal(second.status, 200);
    const body = await second.json();
    assert.equal(body.alreadyDeactivated, true);
  });
});
