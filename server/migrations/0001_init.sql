-- Cloakli 라이선스 서버 초기 스키마.
-- 실제 라이선스 키 원문, 이메일, installation ID 원문은 어떤 테이블에도 저장하지 않는다
-- (license_key_hash/installation_id_hash/session_token_hash는 모두 SHA-256 해시).

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  license_key_hash TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  provider_license_id TEXT,
  status TEXT NOT NULL,
  product_id TEXT,
  variant_id TEXT,
  activation_limit INTEGER NOT NULL DEFAULT 1,
  activation_usage INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_verified_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_licenses_provider_license_id ON licenses (provider_license_id);

CREATE TABLE IF NOT EXISTS license_instances (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses (id),
  provider_instance_id TEXT,
  installation_id_hash TEXT NOT NULL,
  session_token_hash TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  deactivated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_license_instances_license_id ON license_instances (license_id);
CREATE INDEX IF NOT EXISTS idx_license_instances_installation ON license_instances (installation_id_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_license_instances_session_token ON license_instances (session_token_hash);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider_event_name TEXT NOT NULL,
  provider_event_id TEXT,
  payload_hash TEXT NOT NULL,
  processed_at INTEGER,
  processing_status TEXT NOT NULL,
  error_message TEXT
);

-- payload_hash가 idempotency 키다: 같은 내용의 webhook이 재전송되어도 한 번만 처리한다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_payload_hash ON webhook_events (payload_hash);

CREATE TABLE IF NOT EXISTS rate_limit_events (
  id TEXT PRIMARY KEY,
  bucket_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_bucket_created ON rate_limit_events (bucket_key, created_at);
