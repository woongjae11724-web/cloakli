// GET /v1/admin/license-summary
// 개발자가 서버 상태를 확인하는 최소 endpoint. 집계 숫자만 돌려주며, 이메일/라이선스
// 키 원문/installation ID 원문은 절대 포함하지 않는다.
import { jsonResponse } from "../utils/json.js";
import { timingSafeEqualHex } from "../utils/hash.js";
import { getRepo } from "../services/repoAccess.js";

function extractBearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  return match ? match[1].trim() : null;
}

// 관리자 secret은 라이선스 키/세션 토큰과 성격이 달라 해시로 저장할 D1 행이 없으므로,
// 길이를 맞춘 뒤 문자 단위 상수 시간 비교로 확인한다(timingSafeEqualHex는 16진수
// 문자열 전용이 아니라 "같은 길이 문자열"이면 그대로 재사용할 수 있다).
export async function handleAdminSummary(request, env) {
  const token = extractBearerToken(request);
  const secret = env.CLOAKLI_ADMIN_SECRET;

  if (!secret || !token || token.length !== secret.length || !timingSafeEqualHex(token, secret)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const repo = getRepo(env);
  const summary = await repo.getAdminSummary();
  return jsonResponse({ ok: true, summary });
}
