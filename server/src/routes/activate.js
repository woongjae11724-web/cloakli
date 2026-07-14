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
import { buildEntitlementResponse } from "../services/entitlement.js";
import { RATE_LIMITS } from "../utils/constants.js";

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
