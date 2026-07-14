import { test, describe } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { createTestEnv, makeRequest } from "./helpers/test-env.js";

describe("GET /health", () => {
  test("ok:true와 서비스 이름/환경을 돌려주고 비밀값을 노출하지 않는다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(makeRequest("/health"), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, "cloakli-license");
    assert.equal(body.environment, "development");
    assert.ok(!JSON.stringify(body).includes("secret"));
  });

  test("Origin이 허용되지 않아도 /health는 접근 가능하다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(makeRequest("/health", { origin: "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" }), env);
    assert.equal(res.status, 200);
  });

  test("존재하지 않는 경로는 404를 반환한다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(makeRequest("/nope"), env);
    assert.equal(res.status, 404);
  });
});

describe("CORS", () => {
  test("허용된 확장 프로그램 Origin은 Access-Control-Allow-Origin을 그대로 돌려받는다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(makeRequest("/health"), env);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "chrome-extension://abcdefghijklmnopabcdefghijklmnop");
  });

  test("allowlist에 없는 확장 프로그램 Origin은 거부된다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(
      makeRequest("/v1/license/activate", { method: "POST", origin: "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", body: {} }),
      env
    );
    assert.equal(res.status, 403);
  });

  test("production 환경에서는 allowlist가 비어 있으면 모두 거부한다(* 허용 금지)", async () => {
    const env = createTestEnv({ ENVIRONMENT: "production", ALLOWED_EXTENSION_IDS: "" });
    const res = await worker.fetch(makeRequest("/v1/license/activate", { method: "POST", body: {} }), env);
    assert.equal(res.status, 403);
  });

  test("OPTIONS 프리플라이트는 허용된 Origin에 204와 CORS 헤더를 돌려준다", async () => {
    const env = createTestEnv();
    const res = await worker.fetch(makeRequest("/v1/license/activate", { method: "OPTIONS" }), env);
    assert.equal(res.status, 204);
    assert.ok(res.headers.get("Access-Control-Allow-Methods"));
  });
});
