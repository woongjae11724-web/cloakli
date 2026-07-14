// 실제 Lemon Squeezy License API를 호출하는 LicenseProvider 구현.
// 참고: https://docs.lemonsqueezy.com/help/licensing/license-api
//
// 이 파일은 실제 Lemon Squeezy 계정/상품이 없는 이 환경에서는 자동 테스트로 실행되지
// 않았다(요청 자체를 만들지 않으므로 실제 API 호출 성공 여부를 이 환경에서 검증할 수
// 없다). MockLicenseProvider와 정확히 같은 반환 형태를 지키는지는 타입 주석과 코드
// 검토로만 확인했다.
const LICENSE_API_BASE = "https://api.lemonsqueezy.com/v1/licenses";

async function callLicenseApi(action, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(LICENSE_API_BASE + "/" + action, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  let json = null;
  try {
    json = await res.json();
  } catch (err) {
    json = null;
  }
  return { httpStatus: res.status, json };
}

function toLicenseData(json) {
  const lic = (json && json.license_key) || {};
  const meta = (json && json.meta) || {};
  return {
    providerLicenseId: lic.id != null ? String(lic.id) : null,
    status: lic.status || null,
    productId: meta.product_id != null ? String(meta.product_id) : null,
    variantId: meta.variant_id != null ? String(meta.variant_id) : null,
    activationLimit: typeof lic.activation_limit === "number" ? lic.activation_limit : null,
    expiresAt: lic.expires_at ? Date.parse(lic.expires_at) : null,
  };
}

export function createLemonSqueezyLicenseProvider(env) {
  return {
    name: "lemonsqueezy",

    async activate(licenseKey, instanceName) {
      const { httpStatus, json } = await callLicenseApi("activate", {
        license_key: licenseKey,
        instance_name: instanceName || "cloakli-installation",
      });
      if (!json) return { valid: false, reason: "provider_unreachable" };
      if (httpStatus >= 500) return { valid: false, reason: "provider_error" };
      if (httpStatus >= 400 || json.activated !== true) {
        return { valid: false, reason: (json.error || "invalid").toString() };
      }
      return {
        valid: true,
        providerInstanceId: json.instance && json.instance.id ? String(json.instance.id) : null,
        licenseData: toLicenseData(json),
      };
    },

    async validate(licenseKey, providerInstanceId) {
      const params = { license_key: licenseKey };
      if (providerInstanceId) params.instance_id = providerInstanceId;
      const { httpStatus, json } = await callLicenseApi("validate", params);
      if (!json) return { valid: false, reason: "provider_unreachable" };
      if (httpStatus >= 500) return { valid: false, reason: "provider_error" };
      if (httpStatus >= 400 || json.valid !== true) {
        return { valid: false, reason: (json.error || "invalid").toString() };
      }
      return { valid: true, licenseData: toLicenseData(json) };
    },

    async deactivate(licenseKey, providerInstanceId) {
      const { httpStatus, json } = await callLicenseApi("deactivate", {
        license_key: licenseKey,
        instance_id: providerInstanceId,
      });
      if (!json) return { ok: false };
      return { ok: httpStatus < 400 && json.deactivated !== false };
    },
  };
}
