// POST /v1/license/deactivate
// Authorization: Bearer <sessionToken>
//
// 현재 세션(=현재 Chrome 설치본)에 해당하는 instance 하나만 비활성화한다. 다른 사용자
// 설치본은 건드리지 않는다. 알려진 제한: 원본 라이선스 키를 저장하지 않으므로, 이 endpoint는
// Lemon Squeezy License API의 deactivate(license_key + instance_id 필요)를 호출하지
// 못한다 — D1의 로컬 instance 기록만 비활성화한다(README/SETUP.md에 명시).
import { jsonResponse } from "../utils/json.js";
import { sha256Hex } from "../utils/hash.js";
import { getRepo } from "../services/repoAccess.js";

function extractBearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  return match ? match[1].trim() : null;
}

export async function handleDeactivate(request, env) {
  const token = extractBearerToken(request);
  if (!token) return jsonResponse({ ok: false, error: "missing_token" }, 401);

  const repo = getRepo(env);
  const tokenHash = await sha256Hex(token);
  const instance = await repo.findInstanceBySessionTokenHash(tokenHash);
  if (!instance) return jsonResponse({ ok: false, error: "invalid_token" }, 401);

  if (instance.deactivated_at) {
    // 이미 비활성화되어 있음: 같은 결과를 다시 요청한 것으로 보고 성공 처리한다(idempotent).
    return jsonResponse({ ok: true, alreadyDeactivated: true });
  }

  const now = Date.now();
  await repo.deactivateInstance(instance.id, now);
  await repo.incrementActivationUsage(instance.license_id, -1);

  return jsonResponse({ ok: true });
}
