// Cloakli 요금제/권한 판정 모듈.
//
// 무료/Pro 제한 수치(FREE_PLAN_LIMITS)와 개발자 전용 테스트 플래그(build-config.js의
// developerPro)를 이 파일과 build-config.js 한 곳에서만 관리한다. content.js/popup.js/
// options.js는 이 모듈이 내보내는 getEntitlementState()/isProUser()/canCreateRule() 등만
// 사용하고, 각자 다른 기준으로 Pro 여부나 한도를 판단하지 않는다.
//
// 아직 실제 결제/로그인/라이선스 서버가 없으므로 일반 사용자의 기본값은 항상 free다.
// 향후 라이선스 서버가 생기면 getEntitlementState() 내부만 바꾸면 되고, 이 함수를
// 호출하는 popup/options/content 쪽은 바꿀 필요가 없다.
//
// !!! 출시 전 반드시 확인 !!!
// build-config.js의 developerPro는 반드시 false여야 한다. true인 채로 배포하면 결제
// 없이 이 확장을 설치한 모든 사용자가 Pro로 동작한다. scripts/build.js가 production
// 빌드를 만들 때는 출력 폴더의 build-config.js를 항상 developerPro:false로 덮어써
// 이를 자동으로 보장하며, scripts/validate-release.js가 이를 다시 검증한다.
// (README의 "Developer Pro" 섹션 참고)
(function (root) {
  "use strict";

  const CloakliCore =
    typeof module !== "undefined" && module.exports ? require("./content-core.js") : root.CloakliCore;

  // 개발자 전용 테스트 플래그의 실제 값은 build-config.js 하나에만 있다. entitlement.js는
  // 그 값을 읽기만 하며, 절대 chrome.storage에서 읽거나 storage에 쓰지 않는다 — 일반
  // 사용자가 storage 값을 바꿔서 Pro가 되는 경로 자체를 만들지 않기 위함이다.
  const CloakliBuildConfig =
    typeof module !== "undefined" && module.exports ? require("./build-config.js") : root.CloakliBuildConfig;

  // 무료판 제한. 숫자를 여러 파일에 중복 작성하지 않도록 이 객체 하나만 사용한다.
  const FREE_PLAN_LIMITS = {
    maxHostnames: 1,
    maxRules: 3,
    allowedScopes: ["element"],
  };

  // 라이선스 서버(server/)가 응답한 entitlement를 이 컨텍스트(content script/popup/
  // background 각각 별도 실행 컨텍스트) 안에서만 기억해 두는 캐시. license-client.js가
  // chrome.storage.local의 통합 레코드(cloakli.entitlement.v1)의 공개 부분을 읽어 여기에 넣어 준다 — entitlement.js
  // 자신은 절대 chrome.storage나 네트워크를 직접 건드리지 않는다(순수 판정 로직 유지).
  let cachedLicenseEntitlement = null;

  function setLicenseEntitlement(state) {
    cachedLicenseEntitlement = state || null;
  }

  function getCachedLicenseEntitlement() {
    return cachedLicenseEntitlement;
  }

  // 라이선스 캐시(통합 레코드 v1의 공개 부분)가 "지금(now) 시점에" 여전히 유효한지
  // 판단하는 순수 함수. 스키마가 다르거나(손상/알 수 없는 버전) status가 active가
  // 아니거나(만료/취소/비활성화) 오프라인 유예 기한(graceUntil)이 지났으면 더 이상
  // Pro로 취급하지 않는다 — 손상된 값은 항상 안전하게 free다.
  function isLicenseEntitlementCurrentlyValid(state, now) {
    const t = typeof now === "number" ? now : Date.now();
    if (!state || state.schemaVersion !== 1) return false;
    if (state.tier !== "pro") return false;
    if (state.status !== "active") return false;
    if (typeof state.graceUntil !== "number") return false;
    return t <= state.graceUntil;
  }

  // "active"(최근 검증됨)와 "grace"(검증이 오래됐지만 유예 기간 안)를 가르는 기준.
  // 백그라운드 재검증 주기(24시간)의 2배로 두어, 재검증 한 번을 놓쳐도 곧바로
  // grace로 표시하지는 않는다. (license-client.js의 LICENSE_REVALIDATE_INTERVAL_MS 참고)
  const LICENSE_FRESH_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

  // developerMode 값만 받는 순수 함수로 분리해, 실제 build-config.js 값을 건드리지
  // 않고도 "개발자 모드 켜짐/꺼짐" 두 경우를 각각 테스트할 수 있게 한다.
  // developerMode가 true가 아닌 모든 값(false/undefined/null/손상된 값)은 안전하게 free로 처리한다.
  function resolveEntitlementState(developerMode) {
    if (developerMode === true) {
      return { plan: "pro", tier: "pro", source: "developer", isPro: true };
    }
    return { plan: "free", tier: "free", source: "default", isPro: false };
  }

  // 실제 제품 코드가 호출하는 단일 진입점. 우선순위는 항상 다음과 같다:
  //   1. Developer Pro(build-config.js의 developerPro) — 개발 빌드에서만 존재
  //   2. 유효한 라이선스 서버 검증 결과(오프라인 유예 기간 안이면 네트워크 없이도 유지)
  //   3. 그 외에는 항상 free
  // build-config.js가 아예 로드되지 않았거나(bare 참조는 ReferenceError를 던지므로
  // 반드시 typeof로 먼저 확인한다) 손상되어 있거나 developerPro 필드가 없어도 항상
  // 안전하게 free로 처리한다.
  function getEntitlementState() {
    const developerMode =
      typeof CloakliBuildConfig !== "undefined" && CloakliBuildConfig && CloakliBuildConfig.developerPro === true;
    if (developerMode) {
      return resolveEntitlementState(true);
    }

    if (isLicenseEntitlementCurrentlyValid(cachedLicenseEntitlement)) {
      return {
        plan: "pro",
        tier: "pro",
        source: "license_server",
        isPro: true,
        status: cachedLicenseEntitlement.status,
        expiresAt: cachedLicenseEntitlement.expiresAt != null ? cachedLicenseEntitlement.expiresAt : null,
        lastValidatedAt: cachedLicenseEntitlement.lastValidatedAt,
        graceUntil: cachedLicenseEntitlement.graceUntil,
        licenseDisplaySuffix: cachedLicenseEntitlement.licenseDisplaySuffix || null,
      };
    }

    return resolveEntitlementState(false);
  }

  // background가 GET_ENTITLEMENT 메시지에 돌려주는 "공개 응답 형식". popup/options/
  // content script는 전부 이 하나의 형식으로 Pro 여부를 판단하며, 원본 라이선스 키와
  // session token은 절대 포함되지 않는다.
  //   { tier, source: "license"|"developer"|"free", status: "active"|"grace"|"expired"|
  //     "invalid"|"none", expiresAt, lastValidatedAt, licenseDisplaySuffix }
  function toPublicEntitlement(now) {
    const t = typeof now === "number" ? now : Date.now();
    const developerMode =
      typeof CloakliBuildConfig !== "undefined" && CloakliBuildConfig && CloakliBuildConfig.developerPro === true;
    if (developerMode) {
      return { tier: "pro", source: "developer", status: "active", expiresAt: null, lastValidatedAt: null, licenseDisplaySuffix: null };
    }

    const cached = cachedLicenseEntitlement;
    if (!cached) {
      return { tier: "free", source: "free", status: "none", expiresAt: null, lastValidatedAt: null, licenseDisplaySuffix: null };
    }
    if (isLicenseEntitlementCurrentlyValid(cached, t)) {
      const fresh = typeof cached.lastValidatedAt === "number" && t - cached.lastValidatedAt <= LICENSE_FRESH_WINDOW_MS;
      return {
        tier: "pro",
        source: "license",
        status: fresh ? "active" : "grace",
        expiresAt: cached.expiresAt != null ? cached.expiresAt : null,
        lastValidatedAt: cached.lastValidatedAt != null ? cached.lastValidatedAt : null,
        licenseDisplaySuffix: cached.licenseDisplaySuffix || null,
      };
    }
    // 캐시는 있지만 Pro가 아님: 구조가 손상됐으면 invalid, 아니면(만료/유예 종료) expired.
    const damaged = cached.schemaVersion !== 1 || (cached.tier !== "pro" && cached.tier !== "free");
    return {
      tier: "free",
      source: damaged ? "free" : "license",
      status: damaged ? "invalid" : "expired",
      expiresAt: cached.expiresAt != null ? cached.expiresAt : null,
      lastValidatedAt: cached.lastValidatedAt != null ? cached.lastValidatedAt : null,
      licenseDisplaySuffix: null,
    };
  }

  // 손상된 값(null/undefined/문자열 "true" 등)이 들어와도 항상 안전하게 false를 돌려준다.
  // 내부 상태(isPro)와 공개 응답 형식(tier) 어느 쪽이 들어와도 같은 결과를 준다.
  function isProUser(state) {
    return !!(state && (state.isPro === true || state.tier === "pro"));
  }

  // hostname/selector가 없는 손상된 규칙, 배열이 아닌 값(Cloakli 규칙이 아닌 다른 storage
  // 데이터 등)은 사용량 계산에서 조용히 제외한다. 하나가 잘못되어도 전체 계산을 중단시키지 않는다.
  function isUsableRule(rule) {
    return !!(CloakliCore && CloakliCore.isValidRule(rule) && typeof rule.hostname === "string" && rule.hostname);
  }

  // 완전히 같은 규칙(hostname+scope+selector+pagePattern)을 중복으로 계산하지 않기 위한 키.
  // 저장 시점에 이미 addRuleIfNotDuplicate로 걸러지지만, 혹시 저장소에 중복 데이터가
  // 남아 있어도 사용량 계산 기준은 항상 같아야 하므로 여기서도 같은 기준으로 한 번 더 정리한다.
  function ruleDedupeKey(rule) {
    return [rule.hostname, rule.scope || "element", rule.selector, rule.pagePattern || null].join("|");
  }

  // allRulesByHostname: chrome.storage.local의 cloakliRules 값 ({ hostname: [rule, ...] }).
  // 잘못된 입력(null/배열/문자열 등)이 들어와도 예외를 던지지 않고 빈 사용량을 돌려준다.
  function computeUsage(allRulesByHostname) {
    const usage = { totalRules: 0, hostnameCount: 0, hostnames: [] };
    if (!allRulesByHostname || typeof allRulesByHostname !== "object") return usage;

    Object.keys(allRulesByHostname).forEach((hostname) => {
      const list = allRulesByHostname[hostname];
      if (!Array.isArray(list)) return; // 배열이 아니면 Cloakli 규칙이 아닌 손상된 값으로 보고 건너뛴다.

      const seenKeys = new Set();
      let countedForThisHost = 0;
      list.forEach((rule) => {
        if (!isUsableRule(rule)) return;
        const key = ruleDedupeKey(rule);
        if (seenKeys.has(key)) return; // 중복 규칙은 한 번만 계산한다.
        seenKeys.add(key);
        countedForThisHost++;
      });

      if (countedForThisHost === 0) return; // 유효한 규칙이 하나도 없는 hostname은 "사용 중"으로 세지 않는다.
      usage.totalRules += countedForThisHost;
      usage.hostnames.push(hostname);
      usage.hostnameCount += 1;
    });

    return usage;
  }

  // 새 규칙을 저장해도 되는지 판단하는 단일 함수. content.js(요소 선택 저장)와 향후
  // 추가될 다른 저장 경로도 모두 이 함수 하나를 거쳐야 하며, 각자 다른 기준으로
  // hostname 개수/규칙 개수/scope 허용 여부를 판단하지 않는다.
  //
  // context: { entitlementState, allRulesByHostname, hostname, scope }
  // 반환값: { allowed, reason } — reason은 차단된 경우에만 다음 중 하나:
  //   "scope-not-allowed" | "hostname-limit" | "rule-limit"
  function canCreateRule(context) {
    const ctx = context || {};
    const entitlementState = ctx.entitlementState || getEntitlementState();
    const scope = ctx.scope || "element";
    const hostname = ctx.hostname || "";

    // Pro(개발자 Pro 포함)는 scope/개수 제한 없이 항상 허용한다.
    if (isProUser(entitlementState)) {
      return { allowed: true, reason: null };
    }

    if (FREE_PLAN_LIMITS.allowedScopes.indexOf(scope) === -1) {
      return { allowed: false, reason: "scope-not-allowed" };
    }

    const usage = computeUsage(ctx.allRulesByHostname);
    const isExistingHostname = !!hostname && usage.hostnames.indexOf(hostname) !== -1;

    // 이미 사용 중인 사이트에 규칙을 추가하는 것은 hostname 개수를 늘리지 않으므로,
    // 새로운 hostname을 쓰려는 경우에만 hostname 한도를 확인한다.
    if (!isExistingHostname && usage.hostnameCount >= FREE_PLAN_LIMITS.maxHostnames) {
      return { allowed: false, reason: "hostname-limit" };
    }

    if (usage.totalRules >= FREE_PLAN_LIMITS.maxRules) {
      return { allowed: false, reason: "rule-limit" };
    }

    return { allowed: true, reason: null };
  }

  // 사용자에게 보이는 문구는 chrome.i18n(_locales)에서 가져온다. chrome.i18n이 없는
  // 환경(node 테스트, content script 밖)에서는 두 번째 인자(한국어 원문)를 그대로 쓴다.
  // $1, $2 자리표시자는 substitutions 배열 값으로 치환된다.
  function msg(key, fallback, substitutions) {
    let text = null;
    try {
      if (typeof chrome !== "undefined" && chrome.i18n && chrome.i18n.getMessage) {
        text = chrome.i18n.getMessage(key, substitutions);
      }
    } catch (err) {
      text = null;
    }
    if (!text) {
      text = fallback;
      (substitutions || []).forEach((value, i) => {
        text = text.split("$" + (i + 1)).join(String(value));
      });
    }
    return text;
  }

  // popup에 표시할 짧은 한 줄 요금제 배지. popup.js는 이 결과를 그대로
  // textContent/className에 반영하기만 하고 스스로 문구를 판단하지 않는다.
  function describePopupPlanBadge(entitlementState, usage) {
    const state = entitlementState || getEntitlementState();
    const u = usage || { totalRules: 0, hostnameCount: 0, hostnames: [] };

    if (state.source === "developer") {
      return {
        text: msg("planBadgeDeveloper", "Developer Pro · 테스트용 Pro 모드"),
        cssClass: "cloakli-plan-badge cloakli-plan-developer",
      };
    }
    if (isProUser(state)) {
      return { text: msg("planBadgePro", "Pro · 규칙 및 사이트 무제한"), cssClass: "cloakli-plan-badge cloakli-plan-pro" };
    }
    return {
      text: msg("planBadgeFree", "Free · 규칙 $1/$2 · 사이트 $3/$4", [
        String(u.totalRules),
        String(FREE_PLAN_LIMITS.maxRules),
        String(u.hostnameCount),
        String(FREE_PLAN_LIMITS.maxHostnames),
      ]),
      cssClass: "cloakli-plan-badge cloakli-plan-free",
    };
  }

  // options 페이지 상단에 표시할 요금제 요약(여러 줄). options.js는 이 결과를
  // 그대로 화면에 옮기기만 한다.
  function describeOptionsPlanSummary(entitlementState, usage) {
    const state = entitlementState || getEntitlementState();
    const u = usage || { totalRules: 0, hostnameCount: 0, hostnames: [] };

    if (state.source === "developer") {
      return {
        lines: [msg("optionsPlanDeveloperTitle", "현재 요금제: Developer Pro"), msg("optionsPlanDeveloperNote", "개발 테스트용 무제한 모드")],
        cssClass: "cloakli-options-plan cloakli-plan-developer",
      };
    }
    if (isProUser(state)) {
      return {
        lines: [msg("optionsPlanProTitle", "현재 요금제: Pro"), msg("optionsPlanProNote", "저장 제한 없음")],
        cssClass: "cloakli-options-plan cloakli-plan-pro",
      };
    }
    return {
      lines: [
        msg("optionsPlanFreeTitle", "현재 요금제: Free"),
        msg("optionsPlanFreeSites", "사용 사이트: $1/$2", [String(u.hostnameCount), String(FREE_PLAN_LIMITS.maxHostnames)]),
        msg("optionsPlanFreeRules", "저장 규칙: $1/$2", [String(u.totalRules), String(FREE_PLAN_LIMITS.maxRules)]),
      ],
      cssClass: "cloakli-options-plan cloakli-plan-free",
    };
  }

  const CloakliEntitlement = {
    FREE_PLAN_LIMITS,
    resolveEntitlementState,
    getEntitlementState,
    toPublicEntitlement,
    isProUser,
    computeUsage,
    canCreateRule,
    describePopupPlanBadge,
    describeOptionsPlanSummary,
    setLicenseEntitlement,
    getCachedLicenseEntitlement,
    isLicenseEntitlementCurrentlyValid,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CloakliEntitlement;
  } else {
    root.CloakliEntitlement = CloakliEntitlement;
  }
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);
