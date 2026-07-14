// D1 없이(Miniflare/wrangler 없이) 라우트 로직을 그대로 검증하기 위한 메모리
// LicenseRepository 구현. src/services/d1Repository.js와 정확히 같은 메서드 이름/
// 반환 형태를 지킨다 — 두 구현이 어긋나면 실제 배포(D1)와 테스트(메모리)의 동작이
//달라질 수 있으므로, 라우트 코드는 반드시 이 인터페이스로만 데이터에 접근해야 한다.
import crypto from "node:crypto";

function generateId() {
  return crypto.randomBytes(16).toString("hex");
}

export function createMemoryRepository() {
  const licenses = new Map();
  const instances = new Map();
  const webhookEvents = new Map(); // key: payload_hash
  const rateLimitEvents = [];

  return {
    async findLicenseByKeyHash(keyHash) {
      for (const license of licenses.values()) {
        if (license.license_key_hash === keyHash) return { ...license };
      }
      return null;
    },

    async findLicenseById(id) {
      const license = licenses.get(id);
      return license ? { ...license } : null;
    },

    async upsertLicenseFromProvider(input) {
      const existing = await this.findLicenseByKeyHash(input.keyHash);
      const now = Date.now();
      if (existing) {
        const updated = {
          ...existing,
          provider: input.provider,
          provider_license_id: input.providerLicenseId,
          status: input.status,
          product_id: input.productId,
          variant_id: input.variantId,
          activation_limit: input.activationLimit,
          expires_at: input.expiresAt,
          updated_at: now,
        };
        licenses.set(existing.id, updated);
        return { ...updated };
      }
      const id = generateId();
      const row = {
        id,
        license_key_hash: input.keyHash,
        provider: input.provider,
        provider_license_id: input.providerLicenseId,
        status: input.status,
        product_id: input.productId,
        variant_id: input.variantId,
        activation_limit: input.activationLimit,
        activation_usage: 0,
        expires_at: input.expiresAt,
        created_at: now,
        updated_at: now,
        last_verified_at: null,
      };
      licenses.set(id, row);
      return { ...row };
    },

    async touchLicenseVerifiedAt(id, timestamp) {
      const license = licenses.get(id);
      if (!license) return;
      license.last_verified_at = timestamp;
      license.updated_at = timestamp;
    },

    async incrementActivationUsage(id, delta) {
      const license = licenses.get(id);
      if (!license) return;
      license.activation_usage = Math.max(0, (license.activation_usage || 0) + delta);
      license.updated_at = Date.now();
    },

    async findInstance({ licenseId, installationIdHash }) {
      for (const instance of instances.values()) {
        if (instance.license_id === licenseId && instance.installation_id_hash === installationIdHash) {
          return { ...instance };
        }
      }
      return null;
    },

    async findInstanceBySessionTokenHash(sessionTokenHash) {
      for (const instance of instances.values()) {
        if (instance.session_token_hash === sessionTokenHash) return { ...instance };
      }
      return null;
    },

    async upsertInstance(input) {
      const existing = await this.findInstance({ licenseId: input.licenseId, installationIdHash: input.installationIdHash });
      const now = Date.now();
      if (existing) {
        const updated = {
          ...existing,
          provider_instance_id: input.providerInstanceId,
          session_token_hash: input.sessionTokenHash,
          last_seen_at: now,
          deactivated_at: null,
        };
        instances.set(existing.id, updated);
        return { ...updated };
      }
      const id = generateId();
      const row = {
        id,
        license_id: input.licenseId,
        provider_instance_id: input.providerInstanceId,
        installation_id_hash: input.installationIdHash,
        session_token_hash: input.sessionTokenHash,
        created_at: now,
        last_seen_at: now,
        deactivated_at: null,
      };
      instances.set(id, row);
      return { ...row };
    },

    async touchInstanceSeenAt(id, timestamp) {
      const instance = instances.get(id);
      if (!instance) return;
      instance.last_seen_at = timestamp;
    },

    async deactivateInstance(id, timestamp) {
      const instance = instances.get(id);
      if (!instance) return;
      instance.deactivated_at = timestamp;
    },

    async countActiveInstances(licenseId) {
      let count = 0;
      for (const instance of instances.values()) {
        if (instance.license_id === licenseId && !instance.deactivated_at) count++;
      }
      return count;
    },

    async hasProcessedWebhookEvent(payloadHash) {
      const event = webhookEvents.get(payloadHash);
      return !!(event && event.processing_status === "processed");
    },

    async recordWebhookEvent(input) {
      const existing = webhookEvents.get(input.payloadHash);
      const processedAt = input.status === "processed" ? Date.now() : null;
      const row = {
        id: existing ? existing.id : generateId(),
        provider_event_name: input.eventName,
        provider_event_id: input.providerEventId || null,
        payload_hash: input.payloadHash,
        processed_at: processedAt,
        processing_status: input.status,
        error_message: input.errorMessage || null,
      };
      webhookEvents.set(input.payloadHash, row);
    },

    async countRateLimitEvents(bucketKey, sinceTimestamp) {
      return rateLimitEvents.filter((e) => e.bucket_key === bucketKey && e.created_at >= sinceTimestamp).length;
    },

    async recordRateLimitEvent(bucketKey, timestamp) {
      rateLimitEvents.push({ bucket_key: bucketKey, created_at: timestamp });
    },

    async getAdminSummary() {
      let activeLicenses = 0;
      let inactiveLicenses = 0;
      for (const license of licenses.values()) {
        if (license.status === "active") activeLicenses++;
        else inactiveLicenses++;
      }
      let activeInstances = 0;
      for (const instance of instances.values()) {
        if (!instance.deactivated_at) activeInstances++;
      }
      const since = Date.now() - 24 * 60 * 60 * 1000;
      let recentWebhookSuccess = 0;
      let recentWebhookFailure = 0;
      for (const event of webhookEvents.values()) {
        if (event.processed_at && event.processed_at >= since) {
          if (event.processing_status === "processed") recentWebhookSuccess++;
          else if (event.processing_status === "failed") recentWebhookFailure++;
        }
      }
      return { activeLicenses, inactiveLicenses, activeInstances, recentWebhookSuccess, recentWebhookFailure };
    },

    // 테스트 전용 진단 헬퍼(인터페이스의 일부가 아님).
    __debug: { licenses, instances, webhookEvents, rateLimitEvents },
  };
}
