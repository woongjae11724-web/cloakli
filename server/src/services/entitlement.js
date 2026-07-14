// D1의 license row로부터 확장 프로그램에 돌려줄 entitlement 객체를 만드는 순수 함수.
// 서버 쪽 "판정" 로직도 이 함수 하나로만 모아, activate/validate 라우트가 서로 다른
// 기준으로 계산하지 않게 한다(확장 프로그램 쪽 entitlement.js와 같은 원칙).
import { PLAN, ENTITLEMENT_SOURCE, LICENSE_STATUS, OFFLINE_GRACE_PERIOD_MS } from "../utils/constants.js";

export function isLicenseCurrentlyActive(license, now) {
  const t = now == null ? Date.now() : now;
  if (!license) return false;
  if (license.status !== LICENSE_STATUS.ACTIVE) return false;
  if (license.expires_at && license.expires_at <= t) return false;
  return true;
}

// now: 서버 시각(ms). 클라이언트 시계를 신뢰하지 않기 위해 항상 서버에서 계산한 값을 쓴다.
export function buildEntitlementResponse(license, now) {
  const t = now == null ? Date.now() : now;
  const active = isLicenseCurrentlyActive(license, t);

  if (!active) {
    return {
      plan: PLAN.FREE,
      source: ENTITLEMENT_SOURCE.DEFAULT,
      isPro: false,
      status: license ? license.status : null,
      expiresAt: license ? license.expires_at || null : null,
      validatedAt: t,
      offlineValidUntil: t,
    };
  }

  return {
    plan: PLAN.PRO,
    source: ENTITLEMENT_SOURCE.LICENSE_SERVER,
    isPro: true,
    status: license.status,
    expiresAt: license.expires_at || null,
    validatedAt: t,
    offlineValidUntil: t + OFFLINE_GRACE_PERIOD_MS,
  };
}
