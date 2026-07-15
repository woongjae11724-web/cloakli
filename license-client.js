// Cloakli 라이선스 클라이언트 (storage 소유자).
//
// 라이선스 관련 chrome.storage.local 읽기/쓰기는 전부 이 모듈만 수행한다. 실제 서비스
// 로직(활성화/재검증 메시지 처리)은 background의 license-service.js가 이 모듈을 호출하고,
// popup/options는 storage를 직접 읽지 않고 background에 GET_ENTITLEMENT 메시지를 보낸다.
// content script는 시작 시 primeLicenseEntitlementCache()로 캐시를 복구하고,
// storage.onChanged + GET_ENTITLEMENT로 항상 background가 저장한 값 기준으로 판정한다.
//
// 저장 스키마 (단일 키): ENTITLEMENT_STORAGE_KEY = "cloakli.entitlement.v1"
//   {
//     schemaVersion: 1,
//     tier: "pro" | "free",
//     source: "license",
//     status: "active" | "expired" | "disabled" | "inactive" | null,
//     sessionToken: string,          // 서버가 발급한 opaque 값 (원문 라이선스 키 아님)
//     licenseDisplaySuffix: string,  // 표시용 마지막 4자
//     expiresAt: number | null,
//     lastValidatedAt: number,       // 마지막 서버 검증 시각(서버 시계 기준)
//     graceUntil: number,            // 오프라인 유예 기한 (이 시각까지 재검증 없이 Pro 유지)
//     activatedAt: number
//   }
// 원본 라이선스 키는 절대 저장하지 않는다. 이전 버전의 두 키(cloakliLicenseSession/
// cloakliLicenseCache)는 최초 읽기 시점에 이 스키마로 migration 후 제거된다.
(function (root) {
  "use strict";

  const CloakliEntitlement =
    typeof module !== "undefined" && module.exports ? require("./entitlement.js") : root.CloakliEntitlement;
  const CloakliBuildConfig =
    typeof module !== "undefined" && module.exports ? require("./build-config.js") : root.CloakliBuildConfig;

  const INSTALLATION_ID_KEY = "cloakliInstallationId";
  const ENTITLEMENT_STORAGE_KEY = "cloakli.entitlement.v1";
  // 이전 버전 키 (migration 후 제거 대상)
  const LEGACY_SESSION_KEY = "cloakliLicenseSession"; // { sessionToken, licenseKeyLast4, activatedAt }
  const LEGACY_CACHE_KEY = "cloakliLicenseCache"; // 서버 entitlement 스냅샷

  // 서버(server/src/utils/constants.js)와 반드시 같은 값을 유지해야 한다. 값이 어긋나지
  // 않는지는 자동 테스트(license-client.test.js)가 두 파일을 함께 읽어 비교한다.
  const OFFLINE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7일
  const LICENSE_REVALIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24시간

  // 개인정보 없는 개발용 로그. production 빌드(debug:false)에서는 아무것도 출력하지 않는다.
  function debugLog() {
    try {
      if (typeof CloakliBuildConfig !== "undefined" && CloakliBuildConfig && CloakliBuildConfig.debug === true) {
        console.debug.apply(console, ["[Cloakli license]"].concat(Array.prototype.slice.call(arguments)));
      }
    } catch (err) {
      // 로그 실패가 라이선스 흐름을 중단시키지 않게 한다.
    }
  }

  function hasChromeStorage() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      if (!hasChromeStorage()) {
        resolve({});
        return;
      }
      try {
        chrome.storage.local.get(keys, (result) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve({});
            return;
          }
          resolve(result || {});
        });
      } catch (err) {
        resolve({});
      }
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      if (!hasChromeStorage()) {
        resolve(false);
        return;
      }
      try {
        chrome.storage.local.set(values, () => resolve(!(chrome.runtime && chrome.runtime.lastError)));
      } catch (err) {
        resolve(false);
      }
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve) => {
      if (!hasChromeStorage()) {
        resolve(false);
        return;
      }
      try {
        chrome.storage.local.remove(keys, () => resolve(!(chrome.runtime && chrome.runtime.lastError)));
      } catch (err) {
        resolve(false);
      }
    });
  }

  // crypto.randomUUID()를 우선 사용하고, 없으면(구형 환경) 충분히 무작위인 대체 값을 만든다.
  // 이메일/컴퓨터 이름/Chrome 프로필 이름, 하드웨어 fingerprint는 절대 사용하지 않는다.
  function generateInstallationId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    let id = "";
    for (let i = 0; i < 32; i++) {
      id += Math.floor(Math.random() * 16).toString(16);
    }
    return id;
  }

  async function getOrCreateInstallationId() {
    const result = await storageGet([INSTALLATION_ID_KEY]);
    if (typeof result[INSTALLATION_ID_KEY] === "string" && result[INSTALLATION_ID_KEY]) {
      return result[INSTALLATION_ID_KEY];
    }
    const id = generateInstallationId();
    await storageSet({ [INSTALLATION_ID_KEY]: id });
    return id;
  }

  function getLicenseServerUrl() {
    if (typeof CloakliBuildConfig !== "undefined" && CloakliBuildConfig && typeof CloakliBuildConfig.licenseServerUrl === "string") {
      return CloakliBuildConfig.licenseServerUrl;
    }
    return "";
  }

  async function postJson(path, body, headers) {
    const baseUrl = getLicenseServerUrl();
    if (!baseUrl) {
      return { ok: false, error: "server_url_not_configured" };
    }
    let res;
    try {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 10000) : null;
      res = await fetch(baseUrl.replace(/\/+$/, "") + path, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
        body: JSON.stringify(body || {}),
        signal: controller ? controller.signal : undefined,
      });
      if (timeoutId) clearTimeout(timeoutId);
    } catch (err) {
      return { ok: false, error: "network_error" };
    }
    let json = null;
    try {
      json = await res.json();
    } catch (err) {
      json = null;
    }
    if (!json) return { ok: false, error: "invalid_response", httpStatus: res.status };
    return Object.assign({ httpStatus: res.status }, json);
  }

  // ---------------------------------------------------------------------
  // 통합 entitlement 레코드 (단일 storage 키)
  // ---------------------------------------------------------------------

  // 서버 응답의 entitlement(plan/isPro/status/validatedAt/offlineValidUntil)를 저장
  // 레코드로 변환한다.
  function recordFromServerEntitlement(entitlement, sessionToken, licenseDisplaySuffix, activatedAt) {
    const e = entitlement || {};
    return {
      schemaVersion: 1,
      tier: e.isPro === true ? "pro" : "free",
      source: "license",
      status: typeof e.status === "string" ? e.status : null,
      sessionToken: sessionToken,
      licenseDisplaySuffix: licenseDisplaySuffix || null,
      expiresAt: e.expiresAt != null ? e.expiresAt : null,
      lastValidatedAt: typeof e.validatedAt === "number" ? e.validatedAt : Date.now(),
      graceUntil: typeof e.offlineValidUntil === "number" ? e.offlineValidUntil : 0,
      activatedAt: typeof activatedAt === "number" ? activatedAt : Date.now(),
    };
  }

  // 레코드에서 sessionToken을 제거한 "공개 부분"만 돌려준다. entitlement.js의 인메모리
  // 캐시와 다른 컨텍스트(content script 등)에는 항상 이 공개 부분만 전달한다.
  function publicEntitlementFromRecord(record) {
    if (!record || typeof record !== "object") return null;
    return {
      schemaVersion: record.schemaVersion,
      tier: record.tier,
      source: record.source,
      status: record.status,
      licenseDisplaySuffix: record.licenseDisplaySuffix || null,
      expiresAt: record.expiresAt != null ? record.expiresAt : null,
      lastValidatedAt: record.lastValidatedAt,
      graceUntil: record.graceUntil,
    };
  }

  // 이전 버전의 두 키(cloakliLicenseSession + cloakliLicenseCache)를 통합 레코드로 옮긴다.
  // 통합 키가 이미 있으면 아무것도 하지 않고, 옛 키만 있으면 레코드를 만들어 저장한 뒤
  // 옛 키를 제거한다. 몇 번을 실행해도 안전하다(idempotent).
  async function migrateLegacyEntitlementStorage() {
    const stored = await storageGet([ENTITLEMENT_STORAGE_KEY, LEGACY_SESSION_KEY, LEGACY_CACHE_KEY]);
    const hasLegacy = !!(stored[LEGACY_SESSION_KEY] || stored[LEGACY_CACHE_KEY]);

    if (stored[ENTITLEMENT_STORAGE_KEY]) {
      if (hasLegacy) await storageRemove([LEGACY_SESSION_KEY, LEGACY_CACHE_KEY]);
      return stored[ENTITLEMENT_STORAGE_KEY];
    }
    if (!hasLegacy) return null;

    const session = stored[LEGACY_SESSION_KEY] || {};
    const cache = stored[LEGACY_CACHE_KEY] || {};
    // 옛 캐시에 세션 토큰이 없으면(캐시만 남은 손상 상태) Pro로 복원하지 않는다.
    if (!session.sessionToken) {
      await storageRemove([LEGACY_SESSION_KEY, LEGACY_CACHE_KEY]);
      return null;
    }
    const record = recordFromServerEntitlement(cache, session.sessionToken, session.licenseKeyLast4, session.activatedAt);
    await storageSet({ [ENTITLEMENT_STORAGE_KEY]: record });
    await storageRemove([LEGACY_SESSION_KEY, LEGACY_CACHE_KEY]);
    debugLog("이전 버전 라이선스 storage를 통합 스키마(v1)로 이전했다.");
    return record;
  }

  // 저장된 통합 레코드를 읽는다(필요 시 migration 먼저 수행). 이 함수가 라이선스 storage
  // 읽기의 유일한 진입점이다.
  async function loadEntitlementRecord() {
    return migrateLegacyEntitlementStorage();
  }

  // 레코드를 저장하고, 실제로 반영됐는지 다시 읽어 확인한다.
  async function persistEntitlementRecord(record) {
    const wrote = await storageSet({ [ENTITLEMENT_STORAGE_KEY]: record });
    if (!wrote) return false;
    const readBack = await storageGet([ENTITLEMENT_STORAGE_KEY]);
    const saved = readBack[ENTITLEMENT_STORAGE_KEY];
    return !!(saved && saved.sessionToken === record.sessionToken && saved.lastValidatedAt === record.lastValidatedAt);
  }

  async function clearEntitlement() {
    await storageRemove([ENTITLEMENT_STORAGE_KEY, LEGACY_SESSION_KEY, LEGACY_CACHE_KEY]);
    CloakliEntitlement.setLicenseEntitlement(null);
  }

  // ---------------------------------------------------------------------
  // 서버 호출 흐름
  // ---------------------------------------------------------------------

  // 라이선스 키를 서버로 보내 활성화한다. 성공 판정 조건(모두 만족해야 ok:true):
  //   1) 서버가 ok + sessionToken을 반환
  //   2) 응답 entitlement가 "지금 유효한 Pro"
  //   3) 통합 레코드 저장 성공 + 다시 읽어서 확인
  //   4) 인메모리 캐시 갱신 후 판정 결과가 실제 Pro
  // 이 함수가 끝나면 licenseKey 매개변수는 더 이상 어디에도 참조되지 않는다.
  async function activateLicense(licenseKey) {
    if (typeof licenseKey !== "string" || !licenseKey.trim()) {
      return { ok: false, error: "missing_license_key" };
    }
    const installationId = await getOrCreateInstallationId();
    const extensionVersion =
      (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version) ||
      "0.0.0";

    const result = await postJson("/v1/license/activate", {
      licenseKey: licenseKey.trim(),
      installationId,
      extensionVersion,
    });

    if (!result.ok || !result.sessionToken) {
      if (result.error === "origin_not_allowed") {
        debugLog("activate 거부: 이 확장 프로그램 ID가 서버 ALLOWED_EXTENSION_IDS에 없습니다.");
      }
      return { ok: false, error: result.error || "activation_failed" };
    }

    const record = recordFromServerEntitlement(result.entitlement, result.sessionToken, licenseKey.trim().slice(-4), Date.now());

    // 서버가 세션 토큰을 줬어도 entitlement가 유효한 Pro가 아니면(만료/비활성 —
    // 정상 서버는 이 경우 ok:false를 주지만 구버전/이상 응답을 방어) 실패로 처리하고
    // 아무것도 저장하지 않는다. "Pro 활성화 성공"은 실제 Pro가 저장된 경우에만 표시된다.
    if (!CloakliEntitlement.isLicenseEntitlementCurrentlyValid(publicEntitlementFromRecord(record))) {
      debugLog("activate 응답의 entitlement가 유효한 Pro가 아님:", record.status);
      const error =
        record.status === "expired" ? "license_expired" : record.status === "disabled" ? "license_disabled" : "license_not_active";
      return { ok: false, error };
    }

    const persisted = await persistEntitlementRecord(record);
    if (!persisted) {
      // 저장에 실패하면 팝업을 닫는 순간 Pro가 사라진다 — 성공으로 보고하지 않고,
      // 인메모리 캐시도 채우지 않아 "팝업에서만 잠깐 Pro"인 상태를 만들지 않는다.
      debugLog("activate 성공했지만 chrome.storage 저장/재확인 실패 — 활성화를 실패로 처리한다.");
      return { ok: false, error: "storage_write_failed" };
    }

    CloakliEntitlement.setLicenseEntitlement(publicEntitlementFromRecord(record));
    if (!CloakliEntitlement.isProUser(CloakliEntitlement.getEntitlementState())) {
      // 저장·반영까지 끝났는데도 판정이 Pro가 아니면(방어적 최종 확인) 성공이 아니다.
      return { ok: false, error: "activation_incomplete" };
    }
    return { ok: true, entitlement: publicEntitlementFromRecord(record) };
  }

  // 서버가 "이 세션은 더 이상 유효하지 않다"고 명확히 판정한 오류 코드만 로컬 세션
  // 정리 대상으로 삼는다. 여기 없는 코드(rate_limited, internal_error, invalid_response,
  // origin_not_allowed, 알 수 없는 코드 등)는 모두 일시적 문제로 취급해 캐시를 보존한다 —
  // Pro 유지 여부는 오프라인 유예 기한(graceUntil)이 판단하고, 유예가 지나면 어차피
  // free로 강등되므로 성급하게 지워서 얻는 것이 없다.
  const DEFINITIVE_SESSION_REJECTIONS = [
    "missing_token",
    "invalid_token",
    "invalid_session",
    "instance_deactivated",
    "installation_mismatch",
    "license_not_found",
  ];

  // 저장된 세션 토큰으로 서버에 다시 확인한다. 네트워크 실패·일시적 서버 오류는 캐시를
  // 지우지 않는다(오프라인 유예가 판단한다). 서버가 명확히 거부한 경우에만 정리한다.
  async function validateLicense() {
    const record = await loadEntitlementRecord();
    if (!record || !record.sessionToken) {
      return { ok: false, error: "no_session" };
    }

    const installationId = await getOrCreateInstallationId();
    const result = await postJson(
      "/v1/license/validate",
      { installationId },
      { Authorization: "Bearer " + record.sessionToken }
    );

    if (!result.ok) {
      if (result.error === "network_error" || result.error === "server_url_not_configured") {
        // 서버에 도달하지 못함: 기존 캐시를 그대로 둔다(오프라인 유예 기간이 판단한다).
        return { ok: false, error: result.error, offline: true };
      }
      if (DEFINITIVE_SESSION_REJECTIONS.indexOf(result.error) !== -1) {
        debugLog("validate 명시적 거부:", result.error, "- 로컬 세션을 정리한다.");
        await clearEntitlement();
        return { ok: false, error: result.error };
      }
      if (result.error === "origin_not_allowed") {
        debugLog("validate 거부: 이 확장 프로그램 ID가 서버 ALLOWED_EXTENSION_IDS에 없습니다. (세션은 보존)");
      } else {
        debugLog("validate 일시 실패:", result.error || result.httpStatus, "- 세션/캐시를 보존한다.");
      }
      return { ok: false, error: result.error || "invalid_response", transient: true };
    }

    const updated = recordFromServerEntitlement(
      result.entitlement,
      record.sessionToken,
      record.licenseDisplaySuffix,
      record.activatedAt
    );
    await persistEntitlementRecord(updated);
    CloakliEntitlement.setLicenseEntitlement(publicEntitlementFromRecord(updated));
    return { ok: true, entitlement: publicEntitlementFromRecord(updated) };
  }

  // 현재 기기에서만 비활성화한다. 서버 호출이 실패해도(네트워크 등) 로컬 세션은
  // 항상 정리해, 사용자가 명시적으로 요청한 "이 기기에서 비활성화"가 반드시 반영되게 한다.
  async function deactivateLicense() {
    const record = await loadEntitlementRecord();
    if (record && record.sessionToken) {
      try {
        await postJson("/v1/license/deactivate", {}, { Authorization: "Bearer " + record.sessionToken });
      } catch (err) {
        // 서버 호출 실패 여부와 무관하게 로컬은 항상 정리한다.
      }
    }
    await clearEntitlement();
    return { ok: true };
  }

  // 실행 컨텍스트가 시작할 때 저장된 레코드의 공개 부분을 entitlement.js의 인메모리
  // 캐시에 반영한다(동기 함수인 getEntitlementState()가 곧바로 쓸 수 있도록). 이후
  // 변경은 storage.onChanged(content/options/background) 또는 GET_ENTITLEMENT 메시지
  // (popup/options)로 계속 반영된다. sessionToken은 캐시에 넣지 않는다.
  async function primeLicenseEntitlementCache() {
    const record = await loadEntitlementRecord();
    const publicPart = publicEntitlementFromRecord(record);
    CloakliEntitlement.setLicenseEntitlement(publicPart);
    return publicPart;
  }

  const CloakliLicenseClient = {
    INSTALLATION_ID_KEY,
    ENTITLEMENT_STORAGE_KEY,
    LEGACY_SESSION_KEY,
    LEGACY_CACHE_KEY,
    OFFLINE_GRACE_PERIOD_MS,
    LICENSE_REVALIDATE_INTERVAL_MS,
    getOrCreateInstallationId,
    generateInstallationId,
    getLicenseServerUrl,
    activateLicense,
    validateLicense,
    deactivateLicense,
    clearEntitlement,
    // 이전 이름과의 호환 (background/테스트가 사용)
    clearLicenseSession: clearEntitlement,
    loadEntitlementRecord,
    publicEntitlementFromRecord,
    primeLicenseEntitlementCache,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CloakliLicenseClient;
  } else {
    root.CloakliLicenseClient = CloakliLicenseClient;
  }
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);
