import { test, describe } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { createTestEnv, makeRequest } from "./helpers/test-env.js";
import { createLicenseProvider } from "../src/services/licenseProviders/index.js";
import { createMockLicenseProvider, MOCK_TEST_KEYS } from "../src/services/licenseProviders/MockLicenseProvider.js";

describe("MockLicenseProvider", () => {
  test("CLOAKLI-TEST-PRO는 activate/validate 모두 유효하다", async () => {
    const provider = createMockLicenseProvider();
    const activateResult = await provider.activate("CLOAKLI-TEST-PRO", "install-1");
    assert.equal(activateResult.valid, true);
    assert.equal(activateResult.licenseData.status, "active");

    const validateResult = await provider.validate("CLOAKLI-TEST-PRO");
    assert.equal(validateResult.valid, true);
  });

  test("CLOAKLI-TEST-EXPIRED는 activate는 성공하지만 만료 상태를 돌려준다", async () => {
    const provider = createMockLicenseProvider();
    const result = await provider.activate("CLOAKLI-TEST-EXPIRED", "install-1");
    assert.equal(result.valid, true);
    assert.ok(result.licenseData.expiresAt < Date.now());
  });

  test("CLOAKLI-TEST-LIMIT은 activation_limit이 1이다", async () => {
    const provider = createMockLicenseProvider();
    const result = await provider.activate("CLOAKLI-TEST-LIMIT", "install-1");
    assert.equal(result.licenseData.activationLimit, 1);
  });

  test("알 수 없는 키는 항상 invalid다", async () => {
    const provider = createMockLicenseProvider();
    const result = await provider.activate("SOME-RANDOM-KEY", "install-1");
    assert.equal(result.valid, false);
  });

  test("정의된 테스트 키 목록이 문서화된 3개와 일치한다", () => {
    assert.deepEqual(
      MOCK_TEST_KEYS.slice().sort(),
      ["CLOAKLI-TEST-DISABLED", "CLOAKLI-TEST-EXPIRED", "CLOAKLI-TEST-INACTIVE", "CLOAKLI-TEST-LIMIT", "CLOAKLI-TEST-PRO"].sort()
    );
  });
});

describe("createLicenseProvider: production에서 mock 사용을 차단한다", () => {
  test("ENVIRONMENT=production, LICENSE_PROVIDER=mock이면 예외를 던진다", () => {
    assert.throws(() => createLicenseProvider({ ENVIRONMENT: "production", LICENSE_PROVIDER: "mock" }));
  });

  test("ENVIRONMENT=development, LICENSE_PROVIDER=mock이면 정상적으로 mock provider를 돌려준다", () => {
    const provider = createLicenseProvider({ ENVIRONMENT: "development", LICENSE_PROVIDER: "mock" });
    assert.equal(provider.name, "mock");
  });

  test("LICENSE_PROVIDER가 없으면 기본값은 lemonsqueezy다", () => {
    const provider = createLicenseProvider({ ENVIRONMENT: "development" });
    assert.equal(provider.name, "lemonsqueezy");
  });

  test("production + LICENSE_PROVIDER 미설정(기본 lemonsqueezy)은 예외를 던지지 않는다", () => {
    assert.doesNotThrow(() => createLicenseProvider({ ENVIRONMENT: "production" }));
  });

  test("실제 /v1/license/activate 요청도 production+mock 조합에서는 500으로 안전하게 실패한다 (서버가 죽지 않음)", async () => {
    const env = createTestEnv({ ENVIRONMENT: "production", LICENSE_PROVIDER: "mock" });
    const res = await worker.fetch(
      makeRequest("/v1/license/activate", {
        method: "POST",
        body: { licenseKey: "CLOAKLI-TEST-PRO", installationId: "install-1", extensionVersion: "0.1.0" },
      }),
      env
    );
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "provider_unavailable");
  });
});
