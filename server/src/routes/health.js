// 상태 확인. 비밀값이나 내부 상세 정보를 노출하지 않는다.
import { jsonResponse } from "../utils/json.js";

export function handleHealth(env) {
  return jsonResponse({ ok: true, service: "cloakli-license", environment: env.ENVIRONMENT || "development" });
}
