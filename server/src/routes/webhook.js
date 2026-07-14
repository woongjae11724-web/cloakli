// POST /v1/webhooks/lemonsqueezy
//
// 원문 body를 기준으로 서명을 먼저 검증한 뒤에만 JSON을 파싱한다. 동일한 payload가
// 여러 번 전달돼도(Lemon Squeezy는 실패 시 재시도한다) payload_hash로 한 번만 처리한다.
//
// 정확도에 대한 솔직한 한계: license_key_created/updated 이벤트는 Lemon Squeezy License
// API 문서에 명시된 필드(`data.attributes.key` 등)를 기준으로 안정적으로 처리한다.
// 반면 구독 생명주기 이벤트(subscription_*)의 payload만으로 관련 라이선스 키를 항상
// 안정적으로 상관관계 지을 수 있는지는 실제 계정의 테스트 webhook으로 확인이 필요하다
// (server/SETUP.md 참고) — 이 저장소에는 실제 Lemon Squeezy 계정이 없어 실제 payload로
// 검증하지 못했다. 찾지 못하면 조용히 무시하지 않고 처리 결과를 webhook_events에 사유와
// 함께 기록한다.
import { jsonResponse } from "../utils/json.js";
import { sha256Hex, hmacSha256Hex, timingSafeEqualHex } from "../utils/hash.js";
import { getRepo } from "../services/repoAccess.js";
import { LEMONSQUEEZY_EVENTS, LICENSE_STATUS } from "../utils/constants.js";

const LICENSE_KEY_EVENTS = [LEMONSQUEEZY_EVENTS.LICENSE_KEY_CREATED, LEMONSQUEEZY_EVENTS.LICENSE_KEY_UPDATED];

const SUBSCRIPTION_EVENTS = [
  LEMONSQUEEZY_EVENTS.SUBSCRIPTION_CREATED,
  LEMONSQUEEZY_EVENTS.SUBSCRIPTION_UPDATED,
  LEMONSQUEEZY_EVENTS.SUBSCRIPTION_CANCELLED,
  LEMONSQUEEZY_EVENTS.SUBSCRIPTION_RESUMED,
  LEMONSQUEEZY_EVENTS.SUBSCRIPTION_EXPIRED,
  LEMONSQUEEZY_EVENTS.SUBSCRIPTION_PAUSED,
  LEMONSQUEEZY_EVENTS.SUBSCRIPTION_UNPAUSED,
  LEMONSQUEEZY_EVENTS.SUBSCRIPTION_PAYMENT_FAILED,
  LEMONSQUEEZY_EVENTS.SUBSCRIPTION_PAYMENT_SUCCESS,
];

function extractLicenseKeyFromPayload(payload) {
  const attrs = (payload && payload.data && payload.data.attributes) || {};
  return typeof attrs.key === "string" ? attrs.key : null;
}

function extractSubscriptionLicenseHint(payload) {
  const attrs = (payload && payload.data && payload.data.attributes) || {};
  if (typeof attrs.license_key === "string") return attrs.license_key;
  if (attrs.license_key && typeof attrs.license_key.key === "string") return attrs.license_key.key;
  return null;
}

// Lemon Squeezy 구독 status(on_trial/active/paused/past_due/unpaid/cancelled/expired)를
// 우리 licenses.status(active/inactive/expired/disabled) 값으로 옮긴다.
function mapSubscriptionStatusToLicenseStatus(status) {
  if (status === "active" || status === "on_trial") return LICENSE_STATUS.ACTIVE;
  if (status === "expired") return LICENSE_STATUS.EXPIRED;
  return LICENSE_STATUS.INACTIVE;
}

async function applyLicenseKeyEvent(repo, payload) {
  const key = extractLicenseKeyFromPayload(payload);
  if (!key) return { applied: false, reason: "missing_key_in_payload" };

  const attrs = payload.data.attributes;
  const keyHash = await sha256Hex(key);
  await repo.upsertLicenseFromProvider({
    keyHash,
    provider: "lemonsqueezy",
    providerLicenseId: payload.data.id != null ? String(payload.data.id) : null,
    status: attrs.status || LICENSE_STATUS.INACTIVE,
    productId: attrs.product_id != null ? String(attrs.product_id) : null,
    variantId: attrs.variant_id != null ? String(attrs.variant_id) : null,
    activationLimit: typeof attrs.activation_limit === "number" ? attrs.activation_limit : 1,
    expiresAt: attrs.expires_at ? Date.parse(attrs.expires_at) : null,
  });
  return { applied: true };
}

async function applySubscriptionEvent(repo, payload) {
  const key = extractSubscriptionLicenseHint(payload);
  if (!key) return { applied: false, reason: "no_matching_license_in_payload" };

  const attrs = payload.data.attributes;
  const keyHash = await sha256Hex(key);
  const existing = await repo.findLicenseByKeyHash(keyHash);
  if (!existing) return { applied: false, reason: "license_not_found" };

  await repo.upsertLicenseFromProvider({
    keyHash,
    provider: "lemonsqueezy",
    providerLicenseId: existing.provider_license_id,
    status: mapSubscriptionStatusToLicenseStatus(attrs.status),
    productId: existing.product_id,
    variantId: existing.variant_id,
    activationLimit: existing.activation_limit,
    expiresAt: attrs.ends_at ? Date.parse(attrs.ends_at) : existing.expires_at,
  });
  return { applied: true };
}

export async function handleWebhook(request, env) {
  const rawBody = await request.text();
  const signature = request.headers.get("X-Signature");
  const secret = env.LEMONSQUEEZY_WEBHOOK_SECRET;

  if (!secret) return jsonResponse({ ok: false, error: "webhook_not_configured" }, 500);
  if (!signature) return jsonResponse({ ok: false, error: "missing_signature" }, 401);

  const expectedSignature = await hmacSha256Hex(secret, rawBody);
  if (!timingSafeEqualHex(expectedSignature, signature)) {
    return jsonResponse({ ok: false, error: "invalid_signature" }, 401);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  const repo = getRepo(env);
  const payloadHash = await sha256Hex(rawBody);

  const alreadyProcessed = await repo.hasProcessedWebhookEvent(payloadHash);
  if (alreadyProcessed) {
    return jsonResponse({ ok: true, duplicate: true });
  }

  const eventName = (payload && payload.meta && payload.meta.event_name) || null;
  const providerEventId = payload && payload.data && payload.data.id != null ? String(payload.data.id) : null;

  try {
    let result = { applied: false, reason: "unhandled_event" };
    if (LICENSE_KEY_EVENTS.indexOf(eventName) !== -1) {
      result = await applyLicenseKeyEvent(repo, payload);
    } else if (SUBSCRIPTION_EVENTS.indexOf(eventName) !== -1) {
      result = await applySubscriptionEvent(repo, payload);
    } else if (eventName === LEMONSQUEEZY_EVENTS.ORDER_CREATED) {
      result = { applied: false, reason: "informational_only" };
    }

    await repo.recordWebhookEvent({
      eventName: eventName || "unknown",
      providerEventId,
      payloadHash,
      status: "processed",
      errorMessage: result.applied ? null : result.reason,
    });

    return jsonResponse({ ok: true });
  } catch (err) {
    await repo.recordWebhookEvent({
      eventName: eventName || "unknown",
      providerEventId,
      payloadHash,
      status: "failed",
      errorMessage: "processing_error",
    });
    return jsonResponse({ ok: false, error: "processing_error" }, 500);
  }
}
