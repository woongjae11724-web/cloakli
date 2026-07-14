// 라이선스 데이터 접근 계층의 "인터페이스" 문서.
//
// 라우트 핸들러(src/routes/*.js)는 아래 메서드 이름만 알고 있으면 되고, 실제로 D1을
// 쓰는지(운영), 메모리 안 객체를 쓰는지(테스트)는 신경 쓰지 않는다. 이렇게 분리해 두면
// Cloudflare D1 바인딩 없이도(즉 wrangler/Miniflare 없이도) Node의 `node --test`만으로
// 핵심 로직을 그대로 검증할 수 있다.
//
// 실제 운영에서는 d1Repository.js(createD1Repository)를 쓰고, 자동 테스트에서는
// tests/helpers/memory-repository.js(createMemoryRepository)를 쓴다. 두 구현 모두
// 아래 메서드를 전부 구현해야 한다.
//
// interface LicenseRepository {
//   findLicenseByKeyHash(keyHash): Promise<LicenseRow | null>
//   findLicenseById(id): Promise<LicenseRow | null>
//   upsertLicenseFromProvider(input): Promise<LicenseRow>
//   touchLicenseVerifiedAt(id, timestamp): Promise<void>
//   incrementActivationUsage(id, delta): Promise<void>
//   findInstance({ licenseId, installationIdHash }): Promise<InstanceRow | null>  (활성/비활성 무관, 존재 여부 확인용)
//   findInstanceBySessionTokenHash(sessionTokenHash): Promise<InstanceRow | null>
//   upsertInstance(input): Promise<InstanceRow>  (없으면 생성, 있으면 세션 토큰 회전 + 재활성화)
//   touchInstanceSeenAt(id, timestamp): Promise<void>
//   deactivateInstance(id, timestamp): Promise<void>
//   countActiveInstances(licenseId): Promise<number>
//   hasProcessedWebhookEvent(payloadHash): Promise<boolean>
//   recordWebhookEvent(input): Promise<void>
//   countRateLimitEvents(bucketKey, sinceTimestamp): Promise<number>
//   recordRateLimitEvent(bucketKey, timestamp): Promise<void>
//   getAdminSummary(): Promise<{ activeLicenses, inactiveLicenses, activeInstances, recentWebhookSuccess, recentWebhookFailure }>
// }
export {};
