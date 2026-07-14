// 실제 Cloudflare D1 바인딩(env.DB)을 사용하는 LicenseRepository 구현.
//
// 주의: 이 파일은 실제 D1 인스턴스가 있는 배포 환경(wrangler dev/production)에서만
// 실행되며, 이 저장소의 자동 테스트는 D1이나 Miniflare 없이 동작하도록
// tests/helpers/memory-repository.js(같은 인터페이스의 메모리 구현)를 대신 사용한다.
// 즉 이 파일 자체는 자동 테스트로 직접 실행되지 않았음을 완료 보고에 명시한다.
import { generateId } from "../utils/hash.js";

export function createD1Repository(db) {
  return {
    async findLicenseByKeyHash(keyHash) {
      const row = await db.prepare("SELECT * FROM licenses WHERE license_key_hash = ?").bind(keyHash).first();
      return row || null;
    },

    async findLicenseById(id) {
      const row = await db.prepare("SELECT * FROM licenses WHERE id = ?").bind(id).first();
      return row || null;
    },

    async upsertLicenseFromProvider(input) {
      const existing = await this.findLicenseByKeyHash(input.keyHash);
      const now = Date.now();
      if (existing) {
        await db
          .prepare(
            `UPDATE licenses SET provider = ?, provider_license_id = ?, status = ?, product_id = ?, variant_id = ?,
             activation_limit = ?, expires_at = ?, updated_at = ? WHERE id = ?`
          )
          .bind(
            input.provider,
            input.providerLicenseId,
            input.status,
            input.productId,
            input.variantId,
            input.activationLimit,
            input.expiresAt,
            now,
            existing.id
          )
          .run();
        return this.findLicenseById(existing.id);
      }
      const id = generateId();
      await db
        .prepare(
          `INSERT INTO licenses
           (id, license_key_hash, provider, provider_license_id, status, product_id, variant_id,
            activation_limit, activation_usage, expires_at, created_at, updated_at, last_verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL)`
        )
        .bind(
          id,
          input.keyHash,
          input.provider,
          input.providerLicenseId,
          input.status,
          input.productId,
          input.variantId,
          input.activationLimit,
          input.expiresAt,
          now,
          now
        )
        .run();
      return this.findLicenseById(id);
    },

    async touchLicenseVerifiedAt(id, timestamp) {
      await db.prepare("UPDATE licenses SET last_verified_at = ?, updated_at = ? WHERE id = ?").bind(timestamp, timestamp, id).run();
    },

    async incrementActivationUsage(id, delta) {
      await db
        .prepare("UPDATE licenses SET activation_usage = MAX(0, activation_usage + ?), updated_at = ? WHERE id = ?")
        .bind(delta, Date.now(), id)
        .run();
    },

    // 활성/비활성 상태와 무관하게 이 설치(installationIdHash)의 기존 기록이 있는지 확인한다.
    // activate.js가 "새 설치라 activation_limit을 소비하는지" 판단하는 데 이 정보가 필요하다.
    async findInstance({ licenseId, installationIdHash }) {
      const row = await db
        .prepare("SELECT * FROM license_instances WHERE license_id = ? AND installation_id_hash = ?")
        .bind(licenseId, installationIdHash)
        .first();
      return row || null;
    },

    async findInstanceBySessionTokenHash(sessionTokenHash) {
      const row = await db
        .prepare("SELECT * FROM license_instances WHERE session_token_hash = ?")
        .bind(sessionTokenHash)
        .first();
      return row || null;
    },

    // 같은 (license, installation) 조합의 기존 행이 있으면 세션 토큰을 회전시키고
    // deactivated_at을 지워 재활성화한다(이전 세션 토큰은 즉시 조회 불가능해져 자동 폐기된다).
    // 없으면 새로 만든다.
    async upsertInstance(input) {
      const existing = await this.findInstance({ licenseId: input.licenseId, installationIdHash: input.installationIdHash });
      const now = Date.now();
      if (existing) {
        await db
          .prepare(
            "UPDATE license_instances SET provider_instance_id = ?, session_token_hash = ?, last_seen_at = ?, deactivated_at = NULL WHERE id = ?"
          )
          .bind(input.providerInstanceId, input.sessionTokenHash, now, existing.id)
          .run();
        return db.prepare("SELECT * FROM license_instances WHERE id = ?").bind(existing.id).first();
      }
      const id = generateId();
      await db
        .prepare(
          `INSERT INTO license_instances
           (id, license_id, provider_instance_id, installation_id_hash, session_token_hash, created_at, last_seen_at, deactivated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
        )
        .bind(id, input.licenseId, input.providerInstanceId, input.installationIdHash, input.sessionTokenHash, now, now)
        .run();
      return db.prepare("SELECT * FROM license_instances WHERE id = ?").bind(id).first();
    },

    async touchInstanceSeenAt(id, timestamp) {
      await db.prepare("UPDATE license_instances SET last_seen_at = ? WHERE id = ?").bind(timestamp, id).run();
    },

    async deactivateInstance(id, timestamp) {
      await db.prepare("UPDATE license_instances SET deactivated_at = ? WHERE id = ?").bind(timestamp, id).run();
    },

    async countActiveInstances(licenseId) {
      const row = await db
        .prepare("SELECT COUNT(*) AS count FROM license_instances WHERE license_id = ? AND deactivated_at IS NULL")
        .bind(licenseId)
        .first();
      return row ? Number(row.count) : 0;
    },

    async hasProcessedWebhookEvent(payloadHash) {
      const row = await db
        .prepare("SELECT id FROM webhook_events WHERE payload_hash = ? AND processing_status = 'processed'")
        .bind(payloadHash)
        .first();
      return !!row;
    },

    // payload_hash에 UNIQUE 인덱스가 있으므로 upsert로 구현한다: 첫 시도가 실패(failed)로
    // 기록된 뒤 Lemon Squeezy가 같은 payload를 재전송하면(서명/본문이 동일) 새 행을 또
    // 만들려다 제약 위반이 나는 대신, 기존 행을 갱신해 재처리를 허용한다.
    async recordWebhookEvent(input) {
      const existing = await db
        .prepare("SELECT id FROM webhook_events WHERE payload_hash = ?")
        .bind(input.payloadHash)
        .first();
      const processedAt = input.status === "processed" ? Date.now() : null;
      if (existing) {
        await db
          .prepare(
            "UPDATE webhook_events SET provider_event_name = ?, provider_event_id = ?, processed_at = ?, processing_status = ?, error_message = ? WHERE id = ?"
          )
          .bind(input.eventName, input.providerEventId || null, processedAt, input.status, input.errorMessage || null, existing.id)
          .run();
        return;
      }
      await db
        .prepare(
          `INSERT INTO webhook_events (id, provider_event_name, provider_event_id, payload_hash, processed_at, processing_status, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(generateId(), input.eventName, input.providerEventId || null, input.payloadHash, processedAt, input.status, input.errorMessage || null)
        .run();
    },

    async countRateLimitEvents(bucketKey, sinceTimestamp) {
      const row = await db
        .prepare("SELECT COUNT(*) AS count FROM rate_limit_events WHERE bucket_key = ? AND created_at >= ?")
        .bind(bucketKey, sinceTimestamp)
        .first();
      return row ? Number(row.count) : 0;
    },

    async recordRateLimitEvent(bucketKey, timestamp) {
      await db
        .prepare("INSERT INTO rate_limit_events (id, bucket_key, created_at) VALUES (?, ?, ?)")
        .bind(generateId(), bucketKey, timestamp)
        .run();
    },

    async getAdminSummary() {
      const active = await db.prepare("SELECT COUNT(*) AS count FROM licenses WHERE status = 'active'").first();
      const inactive = await db.prepare("SELECT COUNT(*) AS count FROM licenses WHERE status != 'active'").first();
      const instances = await db
        .prepare("SELECT COUNT(*) AS count FROM license_instances WHERE deactivated_at IS NULL")
        .first();
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const webhookSuccess = await db
        .prepare("SELECT COUNT(*) AS count FROM webhook_events WHERE processing_status = 'processed' AND processed_at >= ?")
        .bind(since)
        .first();
      const webhookFailure = await db
        .prepare("SELECT COUNT(*) AS count FROM webhook_events WHERE processing_status = 'failed' AND processed_at >= ?")
        .bind(since)
        .first();
      return {
        activeLicenses: active ? Number(active.count) : 0,
        inactiveLicenses: inactive ? Number(inactive.count) : 0,
        activeInstances: instances ? Number(instances.count) : 0,
        recentWebhookSuccess: webhookSuccess ? Number(webhookSuccess.count) : 0,
        recentWebhookFailure: webhookFailure ? Number(webhookFailure.count) : 0,
      };
    },
  };
}
