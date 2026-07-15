// POST /v1/license/activate
// 사용자가 popup에 입력한 라이선스 키를 최초 1회 provider(Lemon Squeezy 또는 Mock)로
// 검증하고, 성공하면 이 설치(installationId) 전용 session token을 발급한다. 원본
// 라이선스 키는 이 함수 호출이 끝나면(응답을 만든 뒤) 더 이상 어디에도 남지 않는다 —
// D1에는 해시만 저장하고, 이후 재검증(/v1/license/validate)은 session token으로만 한다.
import { parseJsonSafely, requireStringFields, jsonResponse } from "../utils/json.js";
import { sha256Hex, generateSessionToken } from "../utils/hash.js";
import { createLicenseProvider } from "../services/licenseProviders/index.js";
import { getRepo } from "../services/repoAccess.js";
import { checkRateLimit } from "../services/rateLimit.js";
import { buildEntitlementResponse, isLicenseCurrentlyActive } from "../services/entitlement.js";
import { RATE_LIMITS, LICENSE_STATUS } from "../utils/constants.js";

// 현재 active가 아닌 라이선스의 상태를 활성화 거부 오류 코드로 옮긴다. 확장 프로그램
// popup이 이 코드를 사용자 문구로 변환한다(내부 사정은 노출하지 않는다).
function describeInactiveLicenseError(license) {
  if (!license) return "license_not_active";
  if (license.status === LICENSE_STATUS.EXPIRED) return "license_expired";
  if (license.status === LICENSE_STATUS.DISABLED) return "license_disabled";
  if (license.expires_at && license.expires_at <= Date.now()) return "license_expired";
  return "license_not_active";
}

export async function handleActivate(request, env) {
  const body = await parseJsonSafely(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json" }, 400);

  const missing = requireStringFields(body, ["licenseKey", "installationId", "extensionVersion"]);
  if (missing.length > 0) {
    return jsonResponse({ ok: false, error: "missing_fields", fields: missing }, 400);
  }

  const repo = getRepo(env);
  const now = Date.now();
  const installationIdHash = await sha256Hex(body.installationId);
  const keyHash = await sha256Hex(body.licenseKey);

  const instanceRate = await checkRateLimit(repo, "activate:" + installationIdHash, RATE_LIMITS.ACTIVATE_PER_INSTALLATION);
  if (!instanceRate.allowed) {
    return jsonResponse({ ok: false, error: "rate_limited" }, 429);
  }

  const failedSince = now - RATE_LIMITS.FAILED_KEY_ATTEMPTS.windowMs;
  const failedCount = await repo.countRateLimitEvents("failed_key:" + keyHash, failedSince);
  if (failedCount >= RATE_LIMITS.FAILED_KEY_ATTEMPTS.maxRequests) {
    // 존재 여부를 구체적으로 드러내지 않고 일반적인 차단 사유만 알린다.
    return jsonResponse({ ok: false, error: "too_many_attempts" }, 429);
  }

  let provider;
  try {
    provider = createLicenseProvider(env);
  } catch (err) {
    return jsonResponse({ ok: false, error: "provider_unavailable" }, 500);
  }

  let providerResult;
  try {
    providerResult = await provider.activate(body.licenseKey, body.installationId);
  } catch (err) {
    return jsonResponse({ ok: false, error: "provider_error" }, 502);
  }

  if (!providerResult || !providerResult.valid) {
    await repo.recordRateLimitEvent("failed_key:" + keyHash, now);
    return jsonResponse({ ok: false, error: "invalid_license" }, 400);
  }

  const data = providerResult.licenseData || {};

  if (env.LEMONSQUEEZY_PRODUCT_ID && data.productId && String(data.productId) !== String(env.LEMONSQUEEZY_PRODUCT_ID)) {
    return jsonResponse({ ok: false, error: "product_mismatch" }, 400);
  }
  if (env.LEMONSQUEEZY_VARIANT_ID && data.variantId && String(data.variantId) !== String(env.LEMONSQUEEZY_VARIANT_ID)) {
    return jsonResponse({ ok: false, error: "variant_mismatch" }, 400);
  }

  const license = await repo.upsertLicenseFromProvider({
    keyHash,
    provider: provider.name,
    providerLicenseId: data.providerLicenseId || null,
    status: data.status,
    productId: data.productId || null,
    variantId: data.variantId || null,
    activationLimit: typeof data.activationLimit === "number" ? data.activationLimit : 1,
    expiresAt: data.expiresAt || null,
  });

  // 현재 유효(active, 미만료)하지 않은 라이선스에는 세션 토큰을 발급하지 않는다.
  // 여기서 ok:true를 돌려주면 확장 프로그램이 "Pro 활성화 성공"으로 표시한 뒤 실제
  // entitlement는 free가 되는 모순이 생긴다 — 반드시 명확한 오류로 거부한다.
  if (!isLicenseCurrentlyActive(license, now)) {
    return jsonResponse({ ok: false, error: describeInactiveLicenseError(license) }, 400);
  }

  const existingInstance = await repo.findInstance({ licenseId: license.id, installationIdHash });
  const isReactivation = !!(existingInstance && existingInstance.deactivated_at);
  const isNewSlot = !existingInstance || isReactivation;

  if (isNewSlot) {
    const activeCount = await repo.countActiveInstances(license.id);
    if (activeCount >= (license.activation_limit || 1)) {
      return jsonResponse({ ok: false, error: "activation_limit_reached" }, 409);
    }
  }

  const sessionToken = generateSessionToken();
  const sessionTokenHash = await sha256Hex(sessionToken);

  await repo.upsertInstance({
    licenseId: license.id,
    installationIdHash,
    providerInstanceId: providerResult.providerInstanceId || null,
    sessionTokenHash,
  });

  await repo.touchLicenseVerifiedAt(license.id, now);

  const entitlement = buildEntitlementResponse(license, now);
  return jsonResponse({ ok: true, sessionToken, entitlement });
}
