// Cloakli 라이선스 서버의 진입점. Cloudflare Workers의 표준 "module worker" 형식
// (export default { fetch }) 만 사용하며, 무거운 라우팅 프레임워크는 쓰지 않는다.
// 이 파일은 Node의 표준 Request/Response(둘 다 Node 18+ 전역으로 존재)로도 그대로
// 동작하므로, wrangler/Miniflare 없이 `node --test`만으로 라우팅과 각 핸들러를
// 검증할 수 있다.
import { handleHealth } from "./routes/health.js";
import { handleActivate } from "./routes/activate.js";
import { handleValidate } from "./routes/validate.js";
import { handleDeactivate } from "./routes/deactivate.js";
import { handleWebhook } from "./routes/webhook.js";
import { handleAdminSummary } from "./routes/admin.js";
import { resolveCors, corsHeaders } from "./services/cors.js";
import { jsonResponse } from "./utils/json.js";

async function routeRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/health" && request.method === "GET") {
    return handleHealth(env);
  }
  if (url.pathname === "/v1/license/activate" && request.method === "POST") {
    return handleActivate(request, env);
  }
  if (url.pathname === "/v1/license/validate" && request.method === "POST") {
    return handleValidate(request, env);
  }
  if (url.pathname === "/v1/license/deactivate" && request.method === "POST") {
    return handleDeactivate(request, env);
  }
  if (url.pathname === "/v1/webhooks/lemonsqueezy" && request.method === "POST") {
    return handleWebhook(request, env);
  }
  if (url.pathname === "/v1/admin/license-summary" && request.method === "GET") {
    return handleAdminSummary(request, env);
  }
  return jsonResponse({ ok: false, error: "not_found" }, 404);
}

export default {
  async fetch(request, env) {
    const cors = resolveCors(request, env);

    if (request.method === "OPTIONS") {
      if (!cors.allowed) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(cors.originToEcho) });
    }

    const url = new URL(request.url);
    if (!cors.allowed && url.pathname !== "/health") {
      return jsonResponse({ ok: false, error: "origin_not_allowed" }, 403);
    }

    let response;
    try {
      response = await routeRequest(request, env);
    } catch (err) {
      // 예상하지 못한 예외를 사용자에게 그대로 노출하지 않는다(스택 트레이스/개인정보 없음).
      response = jsonResponse({ ok: false, error: "internal_error" }, 500);
    }

    const headers = corsHeaders(cors.originToEcho);
    headers.forEach((value, key) => {
      response.headers.set(key, value);
    });
    return response;
  },
};
