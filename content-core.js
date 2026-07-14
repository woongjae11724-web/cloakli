// Cloakli 공용 순수 로직 모듈.
//
// 브라우저에서는 manifest.json의 content_scripts 배열에서 content.js보다 먼저 로드되어
// (또는 options.html에서 <script>로 먼저 로드되어) 같은 전역(window/self)에
// `CloakliCore` 객체를 노출한다. content.js/options.js는 이 객체의 함수를 그대로 사용한다.
//
// Node의 테스트(node --test)에서는 `require("./content-core.js")`로 그대로 불러와
// DOM이나 chrome.* API 없이 로직만 단위 테스트할 수 있다.
(function (root) {
  "use strict";

  // -----------------------------------------------------------------------
  // 1) debounce: 짧은 시간에 여러 번 호출되어도 마지막 호출 이후 한 번만 실행한다.
  // -----------------------------------------------------------------------
  function debounce(fn, wait, timerApi) {
    const timers = timerApi || {
      setTimeout: (...args) => setTimeout(...args),
      clearTimeout: (...args) => clearTimeout(...args),
    };
    let timeoutId = null;

    function debounced(...args) {
      if (timeoutId !== null) timers.clearTimeout(timeoutId);
      timeoutId = timers.setTimeout(() => {
        timeoutId = null;
        fn(...args);
      }, wait);
    }

    debounced.cancel = function cancel() {
      if (timeoutId !== null) {
        timers.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    debounced.isPending = function isPending() {
      return timeoutId !== null;
    };

    return debounced;
  }

  // -----------------------------------------------------------------------
  // 2) URL 변경 판별
  // -----------------------------------------------------------------------
  function hasUrlChanged(prevUrl, nextUrl) {
    if (typeof prevUrl !== "string" || typeof nextUrl !== "string") return false;
    return prevUrl !== nextUrl;
  }

  // -----------------------------------------------------------------------
  // 3) 저장 규칙 유효성/중복/삭제 관련 순수 함수
  // -----------------------------------------------------------------------

  // selector가 없는 규칙은 저장/적용 대상에서 제외한다.
  function isValidRule(rule) {
    return !!rule && typeof rule === "object" && typeof rule.selector === "string" && rule.selector.length > 0;
  }

  function filterValidRules(rules) {
    if (!Array.isArray(rules)) return [];
    return rules.filter(isValidRule);
  }

  // 두 규칙이 "완전히 같은 규칙"인지 판단하는 기준.
  // hostname/scope/selector/pagePattern이 모두 같으면 중복이다. (4단계: scope 추가 이전에는
  // selector만 비교했지만, 같은 selector라도 scope나 pagePattern이 다르면 별도 규칙으로 허용한다.)
  function ruleMatchKey(rule) {
    if (!rule) return null;
    return {
      hostname: rule.hostname || "",
      scope: rule.scope || "element",
      selector: rule.selector || "",
      pagePattern: rule.pagePattern || null,
    };
  }

  function sameRuleKey(a, b) {
    if (!a || !b) return false;
    return a.hostname === b.hostname && a.scope === b.scope && a.selector === b.selector && a.pagePattern === b.pagePattern;
  }

  // candidateRule과 같은 (hostname, scope, selector, pagePattern) 조합의 규칙이 이미 있는지 확인한다.
  function ruleExists(list, candidateRule) {
    if (!Array.isArray(list)) return false;
    const key = ruleMatchKey(candidateRule);
    if (!key) return false;
    return list.some((rule) => sameRuleKey(ruleMatchKey(rule), key));
  }

  // 완전히 같은 규칙(hostname+scope+selector+pagePattern)이 이미 있으면 추가하지 않는다.
  // { list, added, duplicate } 형태로 결과를 돌려준다.
  function addRuleIfNotDuplicate(list, rule) {
    const current = Array.isArray(list) ? list : [];
    if (!rule || typeof rule.selector !== "string" || !rule.selector) {
      return { list: current, added: false, duplicate: false };
    }
    if (ruleExists(current, rule)) {
      return { list: current, added: false, duplicate: true };
    }
    return { list: current.concat([rule]), added: true, duplicate: false };
  }

  // id로 규칙 하나만 정확히 제거한다. { list, removed }를 돌려준다.
  function removeRuleById(list, ruleId) {
    const current = Array.isArray(list) ? list : [];
    if (!ruleId) return { list: current, removed: false };
    const next = current.filter((rule) => !(rule && rule.id === ruleId));
    return { list: next, removed: next.length !== current.length };
  }

  // id가 없는(예전 2단계) 규칙을 위한 대체 매칭: selector + createdAt 조합으로 하나만 제거한다.
  function removeRuleBySelectorAndCreatedAt(list, selector, createdAt) {
    const current = Array.isArray(list) ? list : [];
    const next = current.filter((rule) => !(rule && rule.selector === selector && rule.createdAt === createdAt));
    return { list: next, removed: next.length !== current.length };
  }

  function countRules(list) {
    if (!Array.isArray(list)) return 0;
    return list.filter(isValidRule).length;
  }

  // 규칙마다 부여하는 간단한 고유 id 생성기.
  function generateRuleId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // 예전 단계에서 저장된 규칙에 없는 필드를 채워 넣는다: id가 없으면 새로 부여하고,
  // scope가 없으면 "element"(선택 당시 그 요소 하나)로, pagePattern은 null로 채운다.
  // 이는 2단계(scope 개념 도입 이전) 규칙의 실제 동작과 가장 가까운 기본값이다.
  // { list, changed }를 돌려주며, 이미 모든 규칙에 필드가 있으면 changed:false이므로
  // 몇 번을 실행해도 안전(idempotent)하고 기존 selector/createdAt/hostname은 그대로 유지된다.
  function ensureRuleIds(list, idGenerator) {
    const current = Array.isArray(list) ? list : [];
    const makeId = typeof idGenerator === "function" ? idGenerator : generateRuleId;
    let changed = false;
    const next = current.map((rule) => {
      if (!rule || typeof rule !== "object" || !isValidRule(rule)) return rule;
      const patch = {};
      if (!rule.id) patch.id = makeId();
      if (!rule.scope) patch.scope = "element";
      if (!("pagePattern" in rule)) patch.pagePattern = null;
      if (Object.keys(patch).length === 0) return rule;
      changed = true;
      return Object.assign({}, rule, patch);
    });
    return { list: next, changed: changed };
  }

  // -----------------------------------------------------------------------
  // 3.5) 가림 적용 범위(scope): URL 정규화 + 규칙이 현재 페이지에 적용되는지 판별
  // -----------------------------------------------------------------------

  // URL에서 "페이지 유형"만 남긴다: origin/query/hash를 제거하고 pathname만 사용한다.
  // 예) https://www.youtube.com/watch?v=abc -> "/watch"
  //     https://mail.google.com/mail/u/0/#inbox/xyz -> "/mail/u/0/" (해시 제거)
  // query에는 보통 영상 ID/검색어 등 콘텐츠별로 달라지는 값이 들어있고, hash는 SPA 내부 라우팅에
  // 쓰이는 경우가 많아 둘 다 "페이지 유형"을 가르는 기준으로 보지 않는다. 잘못된 URL이 들어와도
  // 예외를 던지지 않고 null을 돌려준다.
  function normalizePagePattern(url) {
    if (typeof url !== "string" || !url) return null;
    try {
      const parsed = new URL(url);
      return parsed.pathname || "/";
    } catch (err) {
      return null;
    }
  }

  // 규칙이 "현재 위치"(hostname/href)에 적용되어야 하는지 판별한다.
  // - element: hostname만 같으면 된다 (실제로 selector가 존재하는지는 이 함수 밖에서 확인한다).
  // - page: hostname이 같고, 정규화한 현재 URL이 규칙 저장 당시의 pagePattern과 같아야 한다.
  // - site: hostname만 같으면 URL과 무관하게 적용된다.
  // MutationObserver 콜백/SPA URL 변경/storage 변경 동기화 모두 이 함수 하나를 재사용해야 하며,
  // scope 판별 조건을 여러 곳에 따로 구현하지 않는다.
  function doesRuleApplyToCurrentPage(rule, currentLocation) {
    if (!rule || !currentLocation) return false;
    const currentHostname = currentLocation.hostname;
    if (!currentHostname || rule.hostname !== currentHostname) return false;

    const scope = rule.scope || "element";
    if (scope === "site") return true;
    if (scope === "page") {
      const currentPattern = normalizePagePattern(currentLocation.href);
      return !!currentPattern && currentPattern === rule.pagePattern;
    }
    // "element" (또는 알 수 없는 값)은 예전 규칙과 동일하게 hostname 일치만으로 통과시킨다.
    return true;
  }

  // -----------------------------------------------------------------------
  // 3.6) 일반화(generalized) selector 안전성 검사
  // -----------------------------------------------------------------------

  // 아래 숫자들은 "페이지/사이트 전체 범위" 규칙이 사실상 페이지 대부분을 가리는 것을
  // 막기 위한 안전 장치다. 정확한 값보다는 명백히 위험한 경우를 걸러내는 것이 목적이라
  // 프로젝트 상황에 맞게 조정할 수 있다.
  const GENERALIZED_SELECTOR_LIMITS = {
    // 0개면 애초에 아무것도 못 찾은 것이므로 저장할 이유가 없다.
    MIN_MATCHES: 1,
    // 50개를 넘으면 "같은 종류의 카드/댓글" 수준을 넘어 페이지의 상당 부분일 가능성이 높다고 본다.
    MAX_MATCHES: 50,
    // selector 문자열 자체가 지나치게 길면(복잡한 조상 경로 등) 사이트 구조 변경에 취약해진다.
    MAX_SELECTOR_LENGTH: 200,
    // 일치한 요소들의 면적 합이 뷰포트의 50%를 넘으면 "요소 몇 개"가 아니라 사실상
    // 화면 전체를 가리는 것으로 간주해 차단한다.
    MAX_AREA_RATIO: 0.5,
  };

  // class/속성 없이 이 태그 이름 하나만으로 이루어진 selector는 거의 항상 페이지 전체에
  // 걸쳐 나타나는 범용 컨테이너/링크/텍스트 태그이므로 일반화 selector로 허용하지 않는다.
  const GENERIC_BARE_TAGS = ["div", "span", "a", "li", "p", "section", "article", "td", "tr", "img"];

  function isTooGenericSelector(selector) {
    const trimmed = String(selector || "").trim().toLowerCase();
    if (!trimmed) return true;
    if (/^(html|body)$/.test(trimmed)) return true;
    return GENERIC_BARE_TAGS.indexOf(trimmed) !== -1;
  }

  // 일반화 selector를 저장하기 전에 안전한지 검사한다.
  // selector: 생성된 일반화 selector 문자열
  // matchCount: 현재 문서에서 이 selector가 찾은(선택 가능한) 요소 개수
  // options.originalElementIncluded: 사용자가 실제로 클릭한 요소가 결과에 포함되는지
  // options.areaRatio: 일치 요소들의 면적 합 / 뷰포트 면적
  function evaluateGeneralizedSelectorSafety(selector, matchCount, options) {
    const opts = options || {};

    if (!selector || typeof selector !== "string") {
      return { ok: false, reason: "selector-missing" };
    }
    if (selector.length > GENERALIZED_SELECTOR_LIMITS.MAX_SELECTOR_LENGTH) {
      return { ok: false, reason: "selector-too-long" };
    }
    if (isTooGenericSelector(selector)) {
      return { ok: false, reason: "selector-too-generic" };
    }
    if (!Number.isFinite(matchCount) || matchCount < GENERALIZED_SELECTOR_LIMITS.MIN_MATCHES) {
      return { ok: false, reason: "no-matches" };
    }
    if (matchCount > GENERALIZED_SELECTOR_LIMITS.MAX_MATCHES) {
      return { ok: false, reason: "too-many-matches" };
    }
    if (opts.originalElementIncluded === false) {
      return { ok: false, reason: "original-not-included" };
    }
    if (typeof opts.areaRatio === "number" && opts.areaRatio > GENERALIZED_SELECTOR_LIMITS.MAX_AREA_RATIO) {
      return { ok: false, reason: "covers-too-much-area" };
    }
    return { ok: true, reason: null };
  }

  // -----------------------------------------------------------------------
  // 3.65) 옵션 화면의 "위험한 규칙" 경고: 지나치게 광범위해 보이는 저장된 selector 판별
  // -----------------------------------------------------------------------

  // 조상 경로(">") 없이 태그 하나, 또는 흔히 반복되는 카드/목록 구조에서 재사용되는
  // id 하나로만 이루어진 selector는 실제로 몇 개를 가리는지와 무관하게 "위험 신호"로 본다.
  // (YouTube의 ytd-thumbnail/yt-image처럼 특정 사이트 태그를 하드코딩하지 않고, 일반적으로
  // 반복 카드 UI에서 자주 재사용되는 이름 패턴만 다룬다.)
  const RISKY_BARE_TAGS = GENERIC_BARE_TAGS.concat(["ytd-thumbnail", "yt-image"]);
  const RISKY_GENERIC_IDS = ["thumbnail", "image", "img", "content", "container", "link", "wrapper", "card"];

  function isRiskySelector(selector) {
    const trimmed = String(selector || "").trim();
    if (!trimmed) return false;
    if (trimmed.indexOf(">") !== -1) return false; // 조상 경로가 있으면 위험 신호로 보지 않는다.

    const lower = trimmed.toLowerCase();
    if (RISKY_BARE_TAGS.indexOf(lower) !== -1) return true;

    // "#thumbnail", "a#thumbnail"처럼 태그(선택) + id 하나만으로 이루어진 selector.
    const idMatch = /^([a-z][a-z0-9-]*)?#([a-z][\w-]*)$/i.exec(trimmed);
    if (idMatch) {
      const idValue = idMatch[2].toLowerCase();
      if (RISKY_GENERIC_IDS.indexOf(idValue) !== -1) return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // 3.7) 사이트 단위 일시중지(pause) 상태 조회 (순수 함수)
  // -----------------------------------------------------------------------

  // pausedMap: chrome.storage.local의 cloakliPausedHostnames 값({ hostname: true, ... })
  // hostname이 없거나 맵에 없으면 항상 false(일시중지 아님)로 취급한다.
  function isHostnamePaused(pausedMap, hostname) {
    if (!hostname || !pausedMap || typeof pausedMap !== "object") return false;
    return pausedMap[hostname] === true;
  }

  // toast에 쓸 수 있는 종류. 정의되지 않은 값이 들어오면 "info"로 취급한다.
  const TOAST_TYPES = ["success", "info", "warning", "error"];
  function normalizeToastType(type) {
    return TOAST_TYPES.indexOf(type) !== -1 ? type : "info";
  }

  // -----------------------------------------------------------------------
  // 4) Cloakli 자신이 만든 요소인지 판별 (DOM 없이도 테스트 가능하도록 descriptor 기반)
  // -----------------------------------------------------------------------

  // descriptor: { nodeType, id, classList } 형태 (실제 DOM Element도 이 모양을 만족한다)
  function isCloakliOwnNodeDescriptor(descriptor, ownClassNames, ownIds) {
    if (!descriptor || descriptor.nodeType !== 1) return false;
    const classNames = descriptor.classList ? Array.from(descriptor.classList) : [];
    const classSet = ownClassNames || [];
    const idSet = ownIds || [];
    if (idSet.indexOf(descriptor.id) !== -1 && descriptor.id) return true;
    return classNames.some((cls) => classSet.indexOf(cls) !== -1);
  }

  // 문자열을 짧은 비암호(djb2) 해시로 바꾼다. 저장 규칙의 fingerprint에서 href/이미지 src를
  // "원문 그대로 저장하지 않고" 동일성만 비교하기 위해 쓴다(개인정보 최소화). 되돌릴 수 없고,
  // 재적용 시 "같은 링크/이미지인지" 판별하는 용도에만 쓴다. 값이 없으면 null.
  function hashString(str) {
    if (typeof str !== "string" || !str) return null;
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
  }

  // mutation 목록에 "Cloakli 자신이 만든 것이 아닌" 변경이 하나라도 있는지 확인한다.
  // mutations: [{ addedNodes: iterable, removedNodes: iterable }, ...]
  // isOwnNodeFn: (node) => boolean
  function hasNonCloakliChange(mutations, isOwnNodeFn) {
    if (!mutations) return false;
    for (const mutation of mutations) {
      const added = mutation.addedNodes || [];
      const removed = mutation.removedNodes || [];
      for (const node of added) {
        if (!isOwnNodeFn(node)) return true;
      }
      for (const node of removed) {
        if (!isOwnNodeFn(node)) return true;
      }
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // 5) 저장 규칙을 현재 문서에 적용하는 오케스트레이션 (DOM 접근은 adapters로 주입)
  // -----------------------------------------------------------------------

  // rules: 저장된 규칙 배열
  // adapters:
  //   - queryElements(selector) => 반복 가능한(iterable) 요소 목록
  //   - isSelectable(el) => boolean (없으면 항상 true로 취급)
  //   - maskElement(el) => boolean (새로 가렸으면 true)
  //   - resolveElementTarget(rule, elements) => Element|null (선택적)
  //       "이 요소만"(element) 범위에서 실제로 가릴 요소 하나를 결정한다. 없으면 기본 규칙
  //       (selector가 정확히 1개일 때만 그 하나)을 쓴다. 이 어댑터가 있으면 selector가 0개나
  //       여러 개를 찾더라도 저장된 fingerprint로 "그 요소"를 다시 찾아낼 수 있다(가상화 목록,
  //       재렌더링, 순서 변경 대응). DOM 접근/점수 계산은 content.js가 맡고, 여기서는 호출만 한다.
  // 규칙 하나가 잘못되었거나 queryElements/maskElement가 예외를 던져도 나머지 규칙은 계속 처리한다.
  function applyRuleSet(rules, adapters) {
    const result = { appliedCount: 0, skippedInvalidRules: 0, erroredRules: 0, processedRules: 0 };
    if (!Array.isArray(rules) || !adapters || typeof adapters.queryElements !== "function") {
      return result;
    }
    const isSelectable = typeof adapters.isSelectable === "function" ? adapters.isSelectable : () => true;
    const maskElement = typeof adapters.maskElement === "function" ? adapters.maskElement : () => false;
    const resolveElementTarget =
      typeof adapters.resolveElementTarget === "function" ? adapters.resolveElementTarget : null;

    rules.forEach((rule) => {
      if (!isValidRule(rule)) {
        result.skippedInvalidRules++;
        return;
      }
      result.processedRules++;
      try {
        const elements = Array.from(adapters.queryElements(rule.selector) || []);
        const scope = rule.scope || "element";

        if (scope === "element") {
          // "이 요소만" 규칙은 정확히 한 요소만 가린다. 우선 selector가 문서에서 유일하면
          // 그 하나를 쓰고, 그렇지 않으면(0개/여러 개) resolveElementTarget이 fingerprint로
          // 그 요소를 다시 찾는다. 끝내 확신할 수 없으면 아무 것도 가리지 않는다 - 다른
          // 카드까지 함께 가려지는 것보다 "이번엔 가리지 않음"이 항상 더 안전하다.
          let target = null;
          if (resolveElementTarget) {
            target = resolveElementTarget(rule, elements);
          } else if (elements.length === 1) {
            target = elements[0];
          }
          if (target && isSelectable(target)) {
            if (maskElement(target)) result.appliedCount++;
          }
          return;
        }

        // page/site 범위는 여러 요소를 가리는 것이 의도된 동작이다.
        for (const el of elements) {
          if (!isSelectable(el)) continue;
          if (maskElement(el)) result.appliedCount++;
        }
      } catch (err) {
        result.erroredRules++;
      }
    });

    return result;
  }

  // -----------------------------------------------------------------------
  // 6) "현재 페이지 가림 모두 해제" 일시 해제 상태 전환 (순수 상태 전이)
  // -----------------------------------------------------------------------

  var TEMP_DISABLE_EVENTS = {
    CLEAR_CLICKED: "CLEAR_CLICKED", // 사용자가 "현재 페이지 가림 모두 해제"를 누름 -> 일시 해제 켜짐
    URL_CHANGED: "URL_CHANGED", // SPA 내부에서 URL이 실제로 바뀜 -> 일시 해제 해제
    PAGE_LOAD: "PAGE_LOAD", // 새로고침 등 스크립트가 새로 시작됨 -> 항상 꺼진 상태로 시작
  };

  function nextTemporaryDisableState(currentState, event) {
    switch (event) {
      case TEMP_DISABLE_EVENTS.CLEAR_CLICKED:
        return true;
      case TEMP_DISABLE_EVENTS.URL_CHANGED:
      case TEMP_DISABLE_EVENTS.PAGE_LOAD:
        return false;
      default:
        return !!currentState;
    }
  }

  // -----------------------------------------------------------------------
  // export
  // -----------------------------------------------------------------------
  const CloakliCore = {
    debounce,
    hasUrlChanged,
    isValidRule,
    filterValidRules,
    ruleExists,
    addRuleIfNotDuplicate,
    removeRuleById,
    removeRuleBySelectorAndCreatedAt,
    countRules,
    generateRuleId,
    ensureRuleIds,
    normalizePagePattern,
    doesRuleApplyToCurrentPage,
    isTooGenericSelector,
    evaluateGeneralizedSelectorSafety,
    GENERALIZED_SELECTOR_LIMITS,
    GENERIC_BARE_TAGS,
    isRiskySelector,
    RISKY_BARE_TAGS,
    RISKY_GENERIC_IDS,
    isHostnamePaused,
    normalizeToastType,
    TOAST_TYPES,
    isCloakliOwnNodeDescriptor,
    hasNonCloakliChange,
    hashString,
    applyRuleSet,
    nextTemporaryDisableState,
    TEMP_DISABLE_EVENTS,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CloakliCore;
  } else {
    root.CloakliCore = CloakliCore;
  }
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);
