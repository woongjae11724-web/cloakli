// Cloakli 라이선스 클라이언트. content.js/popup.js/background.js가 함께 쓰는 공용 모듈로,
// installation ID 관리와 Cloudflare Worker(server/) 호출, 그리고 그 결과를
// entitlement.js의 캐시(setLicenseEntitlement)에 반영하는 일만 담당한다. 이 파일
// 자신은 Pro 여부를 판단하지 않는다(entitlement.js가 유일한 판정 지점).
//
// 저장하는 것: installation ID(무작위 값), session token(라이선스 서버가 발급한 opaque
// 값), 라이선스 키의 마지막 4자리(표시용), entitlement 캐시(plan/status/시각).
// 저장하지 않는 것: 라이선스 키 원문 — activate 호출이 끝나면 이 파일의 메모리에서도
// 더 이상 참조하지 않는다.
(function (root) {
  "use strict";

  const CloakliEntitlement =
    typeof module !== "undefined" && module.exports ? require("./entitlement.js") : root.CloakliEntitlement;
  const CloakliBuildConfig =
    typeof module !== "undefined" && module.exports ? require("./build-config.js") : root.CloakliBuildConfig;

  const INSTALLATION_ID_KEY = "cloakliInstallationId";
  const LICENSE_SESSION_KEY = "cloakliLicenseSession"; // { sessionToken, licenseKeyLast4, activatedAt }
  const LICENSE_CACHE_KEY = "cloakliLicenseCache"; // entitlement 스냅샷(setLicenseEntitlement와 같은 모양)

  // 서버(server/src/utils/constants.js)와 반드시 같은 값을 유지해야 한다. 두 프로젝트가
  // 별도로 배포되는 런타임이라 모듈을 직접 공유할 수 없으므로, 값이 어긋나지 않는지는
  // 이 저장소의 자동 테스트(license-client.test.js)가 두 파일의 텍스트를 비교해 확인한다.
  const OFFLINE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7일
  const LICENSE_REVALIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24시간

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

  // 이미 저장된 installation ID가 있으면 그대로 재사용하고, 없으면(최초 실행, 또는
  // 삭제 후 재설치) 새로 만들어 저장한다.
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

  // 라이선스 키를 서버로 보내 활성화한다. 성공하면 세션 토큰(원문 키 아님)과 마지막
  // 4자리만 저장하고, 실패하면 아무것도 저장하지 않는다. 이 함수가 끝나면 licenseKey
  // 매개변수는 더 이상 어디에도 참조되지 않는다(가비지 컬렉션 대상).
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
      return { ok: false, error: result.error || "activation_failed" };
    }

    const last4 = licenseKey.trim().slice(-4);
    await storageSet({
      [LICENSE_SESSION_KEY]: { sessionToken: result.sessionToken, licenseKeyLast4: last4, activatedAt: Date.now() },
      [LICENSE_CACHE_KEY]: result.entitlement,
    });
    CloakliEntitlement.setLicenseEntitlement(result.entitlement);

    return { ok: true, entitlement: result.entitlement };
  }

  // 저장된 세션 토큰으로 서버에 다시 확인한다. 네트워크 실패는 캐시를 지우지 않는다
  // (오프라인 유예는 entitlement.js의 offlineValidUntil이 알아서 판단한다). 서버가
  // 명확히 거부(유효하지 않음/비활성화됨)하면 로컬 세션도 함께 정리한다.
  async function validateLicense() {
    const stored = await storageGet([LICENSE_SESSION_KEY]);
    const session = stored[LICENSE_SESSION_KEY];
    if (!session || !session.sessionToken) {
      return { ok: false, error: "no_session" };
    }

    const installationId = await getOrCreateInstallationId();
    const result = await postJson(
      "/v1/license/validate",
      { installationId },
      { Authorization: "Bearer " + session.sessionToken }
    );

    if (!result.ok) {
      if (result.error === "network_error" || result.error === "server_url_not_configured") {
        // 서버에 도달하지 못함: 기존 캐시를 그대로 둔다(오프라인 유예 기간이 판단한다).
        return { ok: false, error: result.error, offline: true };
      }
      // 서버가 명확히 거부함(무효/비활성화된 토큰 등): 로컬 세션을 정리한다.
      await clearLicenseSession();
      return { ok: false, error: result.error || "invalid_session" };
    }

    await storageSet({ [LICENSE_CACHE_KEY]: result.entitlement });
    CloakliEntitlement.setLicenseEntitlement(result.entitlement);
    return { ok: true, entitlement: result.entitlement };
  }

  // 현재 기기에서만 비활성화한다. 서버 호출이 실패해도(네트워크 등) 로컬 세션은
  // 항상 정리해, 사용자가 명시적으로 요청한 "이 기기에서 비활성화"가 반드시 반영되게 한다.
  async function deactivateLicense() {
    const stored = await storageGet([LICENSE_SESSION_KEY]);
    const session = stored[LICENSE_SESSION_KEY];
    if (session && session.sessionToken) {
      try {
        await postJson("/v1/license/deactivate", {}, { Authorization: "Bearer " + session.sessionToken });
      } catch (err) {
        // 서버 호출 실패 여부와 무관하게 로컬은 항상 정리한다.
      }
    }
    await clearLicenseSession();
    return { ok: true };
  }

  async function clearLicenseSession() {
    await storageRemove([LICENSE_SESSION_KEY, LICENSE_CACHE_KEY]);
    CloakliEntitlement.setLicenseEntitlement(null);
  }

  // content script/popup/background이 시작할 때 chrome.storage에 저장된 캐시를 읽어
  // entitlement.js의 인메모리 캐시에 반영한다(동기 함수인 getEntitlementState()가
  // 곧바로 쓸 수 있도록). 이후 chrome.storage.onChanged로도 계속 최신 상태를 반영해야
  // 하며, 그 구독은 각 실행 컨텍스트(content.js 등)에서 담당한다.
  async function primeLicenseEntitlementCache() {
    const stored = await storageGet([LICENSE_CACHE_KEY]);
    CloakliEntitlement.setLicenseEntitlement(stored[LICENSE_CACHE_KEY] || null);
    return stored[LICENSE_CACHE_KEY] || null;
  }

  function getMaskedLicenseKey(session) {
    if (!session || !session.licenseKeyLast4) return null;
    return "•••• " + session.licenseKeyLast4;
  }

  async function getStoredLicenseSession() {
    const stored = await storageGet([LICENSE_SESSION_KEY]);
    return stored[LICENSE_SESSION_KEY] || null;
  }

  const CloakliLicenseClient = {
    INSTALLATION_ID_KEY,
    LICENSE_SESSION_KEY,
    LICENSE_CACHE_KEY,
    OFFLINE_GRACE_PERIOD_MS,
    LICENSE_REVALIDATE_INTERVAL_MS,
    getOrCreateInstallationId,
    generateInstallationId,
    getLicenseServerUrl,
    activateLicense,
    validateLicense,
    deactivateLicense,
    clearLicenseSession,
    primeLicenseEntitlementCache,
    getMaskedLicenseKey,
    getStoredLicenseSession,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CloakliLicenseClient;
  } else {
    root.CloakliLicenseClient = CloakliLicenseClient;
  }
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);
