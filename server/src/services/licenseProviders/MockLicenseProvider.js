// 개발용 Mock LicenseProvider. 실제 Lemon Squeezy 계정이 없어도 activate/validate/
// deactivate 전체 흐름을 테스트할 수 있게 해 준다. index.js(createLicenseProvider)가
// production 환경에서는 이 provider를 선택하지 못하도록 강제한다.
const TEST_KEYS = {
  "CLOAKLI-TEST-PRO": { status: "active", activationLimit: 5, expiresAt: null },
  "CLOAKLI-TEST-EXPIRED": { status: "expired", activationLimit: 5, expiresAt: Date.now() - 1000 * 60 * 60 },
  "CLOAKLI-TEST-INACTIVE": { status: "inactive", activationLimit: 5, expiresAt: null },
  "CLOAKLI-TEST-DISABLED": { status: "disabled", activationLimit: 5, expiresAt: null },
  "CLOAKLI-TEST-LIMIT": { status: "active", activationLimit: 1, expiresAt: null },
};

function licenseDataFor(licenseKey, def) {
  return {
    providerLicenseId: "mock-license-" + licenseKey,
    status: def.status,
    productId: "mock-product",
    variantId: "mock-variant",
    activationLimit: def.activationLimit,
    expiresAt: def.expiresAt,
  };
}

export function createMockLicenseProvider() {
  return {
    name: "mock",

    async activate(licenseKey) {
      const def = TEST_KEYS[licenseKey];
      if (!def) return { valid: false, reason: "not_found" };
      return {
        valid: true,
        providerInstanceId: "mock-instance-" + Math.random().toString(36).slice(2, 10),
        licenseData: licenseDataFor(licenseKey, def),
      };
    },

    async validate(licenseKey) {
      const def = TEST_KEYS[licenseKey];
      if (!def) return { valid: false, reason: "not_found" };
      return { valid: true, licenseData: licenseDataFor(licenseKey, def) };
    },

    async deactivate() {
      return { ok: true };
    },
  };
}

export const MOCK_TEST_KEYS = Object.freeze(Object.keys(TEST_KEYS));
