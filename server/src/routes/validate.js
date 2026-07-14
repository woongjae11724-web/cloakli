// POST /v1/license/validate
// Authorization: Bearer <sessionToken>
//
// 원본 라이선스 키를 다시 요구하지 않는다 — session token으로 D1에 저장된 라이선스
// 상태를 확인한다. 이 D1 상태는 webhook(구독 취소/만료/재개 등)이 갱신하므로, "다음
// 검증에서 최신 상태가 반영된다"는 원래 아키텍처를 그대로 만족한다.
import { parseJsonSafely, jsonResponse } from "../utils/json.js";
import { sha256Hex } from "../utils/hash.js";
import { timingSafeEqualHex } from "../utils/hash.js";
import { getRepo } from "../services/repoAccess.js";
import { checkRateLimit } from "../services/rateLimit.js";
import { buildEntitlementResponse } from "../services/entitlement.js";
import { RATE_LIMITS } from "../utils/constants.js";

function extractBearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  return match ? match[1].trim() : null;
}

export async function handleValidate(request, env) {
  const token = extractBearerToken(request);
  if (!token) return jsonResponse({ ok: false, error: "missing_token" }, 401);

  const body = (await parseJsonSafely(request)) || {};
  const repo = getRepo(env);
  const now = Date.now();

  const tokenHash = await sha256Hex(token);
  const instance = await repo.findInstanceBySessionTokenHash(tokenHash);
  if (!instance) return jsonResponse({ ok: false, error: "invalid_token" }, 401);

  const rate = await checkRateLimit(repo, "validate:" + instance.id, RATE_LIMITS.VALIDATE_PER_INSTANCE);
  if (!rate.allowed) return jsonResponse({ ok: false, error: "rate_limited" }, 429);

  if (instance.deactivated_at) {
    return jsonResponse({ ok: false, error: "instance_deactivated" }, 403);
  }

  if (typeof body.installationId === "string" && body.installationId) {
    const installationIdHash = await sha256Hex(body.installationId);
    if (!timingSafeEqualHex(installationIdHash, instance.installation_id_hash)) {
      return jsonResponse({ ok: false, error: "installation_mismatch" }, 403);
    }
  }

  const license = await repo.findLicenseById(instance.license_id);
  if (!license) return jsonResponse({ ok: false, error: "license_not_found" }, 404);

  await repo.touchInstanceSeenAt(instance.id, now);
  await repo.touchLicenseVerifiedAt(license.id, now);

  const entitlement = buildEntitlementResponse(license, now);
  return jsonResponse({ ok: true, entitlement });
}
