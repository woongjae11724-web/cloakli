// Cloakli 라이선스 서버 상수. 확장 프로그램(entitlement.js/license-client.js)에도 같은
// 밀리초 값이 상수로 존재하며, 두 값이 어긋나지 않는지는 각 프로젝트의 자동 테스트가
// (같은 저장소 안에서) 서로의 소스 텍스트를 읽어 비교하는 방식으로 확인한다 — 서버와
// 확장 프로그램은 별도로 배포되는 런타임이라 모듈을 직접 공유할 수 없기 때문이다.

export const PLAN = { FREE: "free", PRO: "pro" };

export const ENTITLEMENT_SOURCE = {
  DEFAULT: "default",
  DEVELOPER: "developer",
  LICENSE_SERVER: "license_server",
};

// Lemon Squeezy license_key.status 값 (공식 문서 기준: active/inactive/expired/disabled).
export const LICENSE_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  EXPIRED: "expired",
  DISABLED: "disabled",
};

// Lemon Squeezy가 실제로 보내는 webhook 이벤트 이름(meta.event_name). 설치 시점의
// 공식 문서와 다르면 이 상수만 고치면 된다 - 문자열이 코드 여러 곳에 흩어지지 않는다.
export const LEMONSQUEEZY_EVENTS = {
  ORDER_CREATED: "order_created",
  SUBSCRIPTION_CREATED: "subscription_created",
  SUBSCRIPTION_UPDATED: "subscription_updated",
  SUBSCRIPTION_CANCELLED: "subscription_cancelled",
  SUBSCRIPTION_RESUMED: "subscription_resumed",
  SUBSCRIPTION_EXPIRED: "subscription_expired",
  SUBSCRIPTION_PAUSED: "subscription_paused",
  SUBSCRIPTION_UNPAUSED: "subscription_unpaused",
  SUBSCRIPTION_PAYMENT_FAILED: "subscription_payment_failed",
  SUBSCRIPTION_PAYMENT_SUCCESS: "subscription_payment_success",
  LICENSE_KEY_CREATED: "license_key_created",
  LICENSE_KEY_UPDATED: "license_key_updated",
};

// 오프라인 유예 기간(마지막 성공 검증 후 이 기간까지는 네트워크 실패해도 Pro 유지) - 7일.
export const OFFLINE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

// 백그라운드 재검증 주기 - 24시간. (확장 프로그램의 background.js가 사용)
export const LICENSE_REVALIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// rate limit 기준값. 정상 사용자가 일시적 오류로 영구 차단되지 않도록 창(window)을 짧게 둔다.
export const RATE_LIMITS = {
  ACTIVATE_PER_INSTALLATION: { windowMs: 60 * 60 * 1000, maxRequests: 10 }, // 설치당 1시간에 10회
  VALIDATE_PER_INSTANCE: { windowMs: 5 * 60 * 1000, maxRequests: 30 }, // 세션당 5분에 30회
  FAILED_KEY_ATTEMPTS: { windowMs: 60 * 60 * 1000, maxRequests: 20 }, // 실패한 키 시도, 1시간에 20회
};
