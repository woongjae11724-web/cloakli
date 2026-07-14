// 테스트용 env(worker 바인딩)와 Request 생성 도우미.
import { createMemoryRepository } from "./memory-repository.js";

export const TEST_EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop"; // 32자, a-p 범위
export const TEST_ORIGIN = "chrome-extension://" + TEST_EXTENSION_ID;
export const TEST_WEBHOOK_SECRET = "test-webhook-secret";
export const TEST_ADMIN_SECRET = "test-admin-secret-value";

export function createTestEnv(overrides) {
  const repo = (overrides && overrides.repo) || createMemoryRepository();
  return Object.assign(
    {
      ENVIRONMENT: "development",
      LICENSE_PROVIDER: "mock",
      ALLOWED_EXTENSION_IDS: TEST_EXTENSION_ID,
      LEMONSQUEEZY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      LEMONSQUEEZY_PRODUCT_ID: "",
      LEMONSQUEEZY_VARIANT_ID: "",
      CLOAKLI_ADMIN_SECRET: TEST_ADMIN_SECRET,
      __testRepo: repo,
    },
    overrides || {}
  );
}

export function makeRequest(path, options) {
  const opts = options || {};
  const headers = new Headers(opts.headers || {});
  if (!headers.has("Origin") && opts.origin !== null) {
    headers.set("Origin", opts.origin || TEST_ORIGIN);
  }
  if (opts.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return new Request("https://license.example.com" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
}
