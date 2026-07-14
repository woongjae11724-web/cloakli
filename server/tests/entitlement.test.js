import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildEntitlementResponse, isLicenseCurrentlyActive } from "../src/services/entitlement.js";

describe("isLicenseCurrentlyActive", () => {
  test("status가 active이고 만료일이 없으면 활성", () => {
    assert.equal(isLicenseCurrentlyActive({ status: "active", expires_at: null }, 1000), true);
  });

  test("status가 active여도 만료일이 지났으면 비활성", () => {
    assert.equal(isLicenseCurrentlyActive({ status: "active", expires_at: 500 }, 1000), false);
  });

  test("status가 active이고 만료일이 아직이면 활성", () => {
    assert.equal(isLicenseCurrentlyActive({ status: "active", expires_at: 2000 }, 1000), true);
  });

  test("status가 active가 아니면 비활성", () => {
    assert.equal(isLicenseCurrentlyActive({ status: "expired", expires_at: null }, 1000), false);
    assert.equal(isLicenseCurrentlyActive({ status: "inactive", expires_at: null }, 1000), false);
  });

  test("license가 없으면 비활성", () => {
    assert.equal(isLicenseCurrentlyActive(null, 1000), false);
  });
});

describe("buildEntitlementResponse", () => {
  test("활성 라이선스는 pro/license_server를 반환하고 오프라인 유예 기간을 부여한다", () => {
    const now = 1_000_000;
    const result = buildEntitlementResponse({ status: "active", expires_at: null }, now);
    assert.equal(result.plan, "pro");
    assert.equal(result.source, "license_server");
    assert.equal(result.isPro, true);
    assert.equal(result.validatedAt, now);
    assert.ok(result.offlineValidUntil > now, "오프라인 유예 기한이 now보다 미래여야 한다");
  });

  test("비활성/만료 라이선스는 free를 반환하고 오프라인 유예를 주지 않는다", () => {
    const now = 1_000_000;
    const result = buildEntitlementResponse({ status: "expired", expires_at: now - 1 }, now);
    assert.equal(result.plan, "free");
    assert.equal(result.source, "default");
    assert.equal(result.isPro, false);
    assert.equal(result.offlineValidUntil, now);
  });

  test("license가 없어도 안전하게 free를 반환한다", () => {
    const result = buildEntitlementResponse(null, 1000);
    assert.equal(result.isPro, false);
    assert.equal(result.status, null);
  });
});
