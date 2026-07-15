// Cloakli 라이선스 서비스 (background 전용, 단일 source of truth).
//
// popup/options/content script는 Pro 여부를 스스로 계산하지 않고, background에
// 아래 메시지를 보내 항상 같은 결과를 받는다:
//   GET_ENTITLEMENT        → { ok, entitlement }         (공개 형식, 비밀값 없음)
//   ACTIVATE_LICENSE       → { ok, entitlement | error } (키는 요청에만 있고 응답/저장에 없음)
//   RECHECK_LICENSE        → { ok, offline?, transient?, error?, entitlement }
//   DEACTIVATE_LICENSE     → { ok, entitlement }
//   GET_LICENSE_DIAGNOSTICS→ { ok, diagnostics }          (개발 진단용, 비밀값 없음)
//
// 데이터 흐름: Lemon Squeezy/Worker → 이 서비스(license-client.js 호출) →
// chrome.storage.local의 통합 레코드 → 각 화면(GET_ENTITLEMENT/storage.onChanged).
// 응답 어디에도 원본 라이선스 키와 session token 원문을 포함하지 않는다.
(function (root) {
  "use strict";

  const CloakliEntitlement =
    typeof module !== "undefined" && module.exports ? require("./entitlement.js") : root.CloakliEntitlement;
  const CloakliLicenseClient =
    typeof module !== "undefined" && module.exports ? require("./license-client.js") : root.CloakliLicenseClient;
  const CloakliBuildConfig =
    typeof module !== "undefined" && module.exports ? require("./build-config.js") : root.CloakliBuildConfig;

  const LICENSE_MESSAGE_TYPES = [
    "GET_ENTITLEMENT",
    "ACTIVATE_LICENSE",
    "RECHECK_LICENSE",
    "DEACTIVATE_LICENSE",
    "GET_LICENSE_DIAGNOSTICS",
  ];

  function isLicenseServiceMessage(message) {
    return !!(message && typeof message.type === "string" && LICENSE_MESSAGE_TYPES.indexOf(message.type) !== -1);
  }

  // 항상 storage에서 다시 읽어 인메모리 캐시를 맞춘 뒤 판정한다. 서비스 워커는 언제든
  // 재시작될 수 있으므로 메모리 변수를 신뢰하지 않는다 — storage가 유일한 지속 상태다.
  async function currentPublicEntitlement() {
    await CloakliLicenseClient.primeLicenseEntitlementCache();
    return CloakliEntitlement.toPublicEntitlement();
  }

  async function buildDiagnostics() {
    const record = await CloakliLicenseClient.loadEntitlementRecord();
    const publicEntitlement = CloakliEntitlement.toPublicEntitlement();
    let serverHost = null;
    try {
      serverHost = new URL(CloakliLicenseClient.getLicenseServerUrl()).host;
    } catch (err) {
      serverHost = null;
    }
    return {
      tier: publicEntitlement.tier,
      source: publicEntitlement.source,
      status: publicEntitlement.status,
      hasSessionToken: !!(record && record.sessionToken),
      lastValidatedAt: record ? record.lastValidatedAt || null : null,
      graceUntil: record ? record.graceUntil || null : null,
      schemaVersion: record ? record.schemaVersion || null : null,
      extensionId: (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) || null,
      extensionVersion:
        (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version) || null,
      buildMode: (CloakliBuildConfig && CloakliBuildConfig.mode) || null,
      licenseServerHost: serverHost,
    };
  }

  // 메시지 하나를 처리해 응답 객체를 돌려준다. background.js의 onMessage 리스너와
  // 자동 테스트가 같은 함수를 호출한다(로직을 두 곳에 두지 않는다).
  async function handleLicenseServiceMessage(message) {
    const type = message && message.type;

    if (type === "GET_ENTITLEMENT") {
      return { ok: true, entitlement: await currentPublicEntitlement() };
    }

    if (type === "ACTIVATE_LICENSE") {
      const result = await CloakliLicenseClient.activateLicense(message.licenseKey);
      if (!result.ok) {
        return { ok: false, error: result.error || "activation_failed", entitlement: await currentPublicEntitlement() };
      }
      // 저장까지 끝난 뒤 storage 기준으로 다시 판정해, "성공" 응답과 GET_ENTITLEMENT
      // 결과가 절대 어긋나지 않게 한다.
      const entitlement = await currentPublicEntitlement();
      if (entitlement.tier !== "pro") {
        return { ok: false, error: "activation_incomplete", entitlement };
      }
      return { ok: true, entitlement };
    }

    if (type === "RECHECK_LICENSE") {
      const result = await CloakliLicenseClient.validateLicense();
      return {
        ok: !!result.ok,
        error: result.ok ? undefined : result.error,
        offline: result.offline === true || undefined,
        transient: result.transient === true || undefined,
        entitlement: await currentPublicEntitlement(),
      };
    }

    if (type === "DEACTIVATE_LICENSE") {
      await CloakliLicenseClient.deactivateLicense();
      return { ok: true, entitlement: await currentPublicEntitlement() };
    }

    if (type === "GET_LICENSE_DIAGNOSTICS") {
      return { ok: true, diagnostics: await buildDiagnostics() };
    }

    return { ok: false, error: "unknown_message" };
  }

  const CloakliLicenseService = {
    LICENSE_MESSAGE_TYPES,
    isLicenseServiceMessage,
    handleLicenseServiceMessage,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CloakliLicenseService;
  } else {
    root.CloakliLicenseService = CloakliLicenseService;
  }
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);
