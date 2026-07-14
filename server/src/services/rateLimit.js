// 최소한의 남용 방지. Cloudflare의 고급 rate limiting 제품 없이도, D1(또는 테스트에서는
// 메모리 repository)의 rate_limit_events 테이블만으로 "창(window) 안 요청 수 제한"을 구현한다.
// 정상 사용자가 일시적인 오류로 영구 차단되지는 않도록, 창이 지나면 자동으로 다시 허용된다.

// repo: LicenseRepository, bucketKey: 제한 기준이 되는 문자열(예: "activate:<installationIdHash>")
// limit: { windowMs, maxRequests }
// 반환값: { allowed: boolean }
export async function checkRateLimit(repo, bucketKey, limit) {
  const now = Date.now();
  const since = now - limit.windowMs;
  const count = await repo.countRateLimitEvents(bucketKey, since);
  if (count >= limit.maxRequests) {
    return { allowed: false };
  }
  await repo.recordRateLimitEvent(bucketKey, now);
  return { allowed: true };
}
