// Chrome 확장 프로그램(chrome-extension://<32자 id>)만 허용하는 CORS 정책.
// Origin만 믿고 보안을 주장하지 않는다 — 실제 라이선스 검증(서명/토큰)은 별도로 항상 수행한다.
const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/([a-p]{32})$/;

// request.headers.get("Origin")과 env(ALLOWED_EXTENSION_IDS, ENVIRONMENT)를 보고
// 이 요청을 허용할지 판단한다.
// 반환값: { allowed: boolean, originToEcho: string|null }
export function resolveCors(request, env) {
  const origin = request.headers.get("Origin");
  const isDev = (env.ENVIRONMENT || "development") !== "production";
  const allowedIds = String(env.ALLOWED_EXTENSION_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!origin) {
    // curl 등 브라우저가 아닌 요청(개발 중 서버 자체 테스트 목적). production에서는 허용하지 않는다.
    return { allowed: isDev, originToEcho: null };
  }

  const match = EXTENSION_ORIGIN_PATTERN.exec(origin);
  if (!match) {
    return { allowed: false, originToEcho: null };
  }

  const extensionId = match[1];
  if (allowedIds.length === 0) {
    // allowlist가 아직 설정되지 않은 개발 초기 단계: 개발 환경에서만 관대하게 허용한다.
    // production에서는 allowlist가 비어 있으면 항상 거부한다("*" 허용 금지).
    return { allowed: isDev, originToEcho: isDev ? origin : null };
  }

  const allowed = allowedIds.indexOf(extensionId) !== -1;
  return { allowed, originToEcho: allowed ? origin : null };
}

export function corsHeaders(originToEcho) {
  const headers = new Headers();
  if (originToEcho) {
    headers.set("Access-Control-Allow-Origin", originToEcho);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Signature");
  return headers;
}
