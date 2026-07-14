// Cloakli content script: 요소 선택 모드와 가림(마스킹) 기능을 담당한다.
// 팝업에서 버튼을 누를 때마다 이 파일이 다시 주입될 수 있으므로,
// window 플래그로 중복 초기화(이벤트 리스너 중복 등록)를 막는다.
(function () {
  if (window.__cloakliContentLoaded) {
    return;
  }
  window.__cloakliContentLoaded = true;

  const HIGHLIGHT_CLASS = "cloakli-highlight";
  const MASKED_CLASS = "cloakli-masked";
  const WRAPPER_CLASS = "cloakli-mask-wrapper";
  const OVERLAY_CLASS = "cloakli-mask-overlay";
  const BANNER_CLASS = "cloakli-selection-banner";
  const BANNER_ID = "cloakli-selection-banner-root";
  const TOAST_CLASS = "cloakli-toast";
  const TOAST_ID = "cloakli-toast-root";
  const SCOPE_PICKER_CLASS = "cloakli-scope-picker";
  const SCOPE_PICKER_ID = "cloakli-scope-picker-root";
  const PREVIEW_OUTLINE_CLASS = "cloakli-preview-outline";
  // 화면 고정 선택 모드: 선택 중 페이지 전체를 덮어 사이트의 hover UI 변화를 막는 투명 레이어
  const SHIELD_CLASS = "cloakli-selection-shield";
  const SHIELD_ID = "cloakli-selection-shield-root";

  // 미리보기 outline은 성능을 위해 최대 이만큼의 요소에만 표시한다.
  const PREVIEW_OUTLINE_MAX = 20;

  // 사이트별 가림 규칙을 담는 chrome.storage.local의 최상위 키.
  // popup.js/options.js에서도 같은 문자열을 사용해야 같은 데이터를 읽고 쓸 수 있다.
  const STORAGE_KEY = "cloakliRules";

  // hostname별 "가림 일시중지" 상태를 담는 별도 key. 가림 규칙 데이터와는 완전히 분리되어 있어,
  // 일시중지를 켜고 끄는 것이 저장된 규칙을 지우거나 만들지 않는다. popup.js도 같은 문자열을 사용한다.
  const PAUSED_STORAGE_KEY = "cloakliPausedHostnames";

  // 개발 중 최소한의 로그만 남기기 위한 스위치. 값의 출처는 build-config.js(CloakliBuildConfig.debug)
  // 하나뿐이며, scripts/build.js가 production 빌드에서는 이 값을 항상 false로 강제한다.
  const CLOAKLI_DEBUG = typeof CloakliBuildConfig !== "undefined" && CloakliBuildConfig.debug === true;
  function debugLog(...args) {
    if (CLOAKLI_DEBUG) console.debug("[Cloakli]", ...args);
  }

  // 자식 요소를 가질 수 없거나 오버레이가 정상적으로 렌더링되지 않는 태그 목록
  const VOID_LIKE_TAGS = ["IMG", "INPUT", "IFRAME", "VIDEO", "CANVAS", "EMBED", "OBJECT", "TEXTAREA"];

  let selectionModeActive = false;
  let currentHoverEl = null;

  // "현재 페이지 가림 모두 해제" 직후, observer/URL 변경 감지가 즉시 다시
  // 가리지 않도록 막는 이번 페이지(탭) 한정 상태. 새 URL로 이동하면 해제된다.
  let isTemporarilyDisabled = false;

  // 현재 사이트에 저장된 규칙 개수의 대략적인 캐시.
  // 0이면 DOM 변경이 있어도 재적용 스케줄링 자체를 건너뛰어 불필요한 작업을 없앤다.
  let ruleCountCache = 0;

  // 현재 hostname이 "가림 일시중지" 상태인지 캐시한 값. applyStoredRules가 storage에서 다시
  // 읽을 때마다 최신값으로 갱신되며, storage.onChanged로 다른 곳(popup)에서 바뀌어도 즉시 반영된다.
  let isHostPaused = false;

  // Cloakli가 만든 요소인지 확인해 선택 대상에서 제외한다.
  function isCloakliOwnElement(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(
      "." +
        BANNER_CLASS +
        ", ." +
        OVERLAY_CLASS +
        ", ." +
        WRAPPER_CLASS +
        ", ." +
        TOAST_CLASS +
        ", ." +
        SCOPE_PICKER_CLASS +
        ", ." +
        SHIELD_CLASS
    );
  }

  // html, body, Cloakli 자체 요소는 선택할 수 없다.
  function isSelectable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el === document.documentElement || el === document.body) return false;
    if (isCloakliOwnElement(el)) return false;
    return true;
  }

  // 화면 대부분을 덮는 거대한 요소는 실수로 선택했을 가능성이 높아 제외한다.
  function isTooLarge(el) {
    const rect = el.getBoundingClientRect();
    const viewportArea = window.innerWidth * window.innerHeight;
    if (viewportArea <= 0) return false;
    const elArea = rect.width * rect.height;
    return elArea >= viewportArea * 0.92;
  }

  function clearHighlight() {
    if (currentHoverEl) {
      currentHoverEl.classList.remove(HIGHLIGHT_CLASS);
      currentHoverEl = null;
    }
  }

  // 선택 모드 전용 미리보기 상태(hover outline + 범위 미리보기 outline)만 정리한다.
  // 저장된 가림(MASKED_CLASS/OVERLAY_CLASS/WRAPPER_CLASS)은 절대 건드리지 않는다 - 이 함수와
  // removePersistentMask()/removeAllPersistentMasks()는 서로 완전히 분리된 역할을 갖는다.
  // (clearHighlight/clearPreviewOutlines는 각각 hover-highlight/범위 미리보기만 다루며,
  // 이 함수는 그 둘을 함께 정리하는 진입점일 뿐이다.)
  function clearSelectionPreview() {
    clearHighlight();
    clearPreviewOutlines();
  }

  function isSelectionShieldElement(el) {
    return !!(el && el.classList && el.classList.contains(SHIELD_CLASS));
  }

  function onMouseOver(e) {
    const el = e.target;
    // 화면 고정 레이어 위의 마우스 이동은 onSelectionMouseMove가 좌표 기반으로 처리한다.
    if (isSelectionShieldElement(el)) return;
    if (!isSelectable(el)) {
      clearHighlight();
      return;
    }
    if (currentHoverEl === el) return;
    clearHighlight();
    el.classList.add(HIGHLIGHT_CLASS);
    currentHoverEl = el;
  }

  // 화면 고정 선택 모드: 마우스가 투명 레이어 위에 있으므로, 좌표로 아래(원래) 요소를
  // 찾아 하나에만 파란 outline을 표시한다. 실제 페이지는 hover 이벤트를 받지 않는다.
  function onSelectionMouseMove(e) {
    if (!selectionModeActive) return;
    if (!isSelectionShieldElement(e.target)) return;
    const el = resolveSelectionTargetAtPoint(e.clientX, e.clientY);
    if (!el || !isSelectable(el)) {
      clearHighlight();
      return;
    }
    if (currentHoverEl === el) return;
    clearHighlight();
    el.classList.add(HIGHLIGHT_CLASS);
    currentHoverEl = el;
  }

  function onClick(e) {
    // 원래 사이트의 링크/버튼/메뉴가 실행되지 않도록 항상 기본 동작을 막는다.
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    let el = e.target;
    // 화면 고정 레이어를 클릭한 경우: 좌표로 선택 시작 시점에 보이던 원래 요소를 찾는다.
    if (isSelectionShieldElement(el)) {
      el = resolveSelectionTargetAtPoint(e.clientX, e.clientY);
      if (!el) {
        flashBannerMessage("이 위치에서는 선택할 요소를 찾지 못했습니다. 다른 곳을 클릭해 주세요.");
        return;
      }
    }

    if (!isSelectable(el)) return;

    if (isTooLarge(el)) {
      flashBannerMessage("선택한 영역이 너무 큽니다. 더 작은 요소를 다시 선택해 주세요.");
      return;
    }

    // 클릭 즉시 저장하지 않는다. 선택 모드는 종료하고, 적용 범위(이 요소만/페이지/사이트)를
    // 고르는 UI를 띄운 뒤 사용자의 선택에 따라 실제 가림과 저장을 진행한다.
    endSelectionMode();
    openScopePicker(el);
  }

  // ---------------------------------------------------------------------
  // CSS 선택자 생성
  // ---------------------------------------------------------------------

  // id/data-*/aria-label/name 값으로 쓰기에 적당한 값인지 확인한다. (너무 길거나 비어있지 않은지만 검사)
  function isReasonableValue(value, maxLen) {
    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (trimmed.length > (maxLen || 80)) return false;
    return true;
  }

  // 무작위 문자열처럼 보이는 class인지 판별한다. (CSS 모듈/emotion 등 동적 class 배제)
  function isStableClassName(cls) {
    if (!cls) return false;
    if (cls.startsWith("cloakli-")) return false;
    if (cls.length > 40) return false;
    if (/^[0-9a-f]{6,}$/i.test(cls)) return false;
    if (/^(css|sc|jss|emotion|styled)[-_][a-z0-9]+$/i.test(cls)) return false;
    const digitCount = (cls.match(/\d/g) || []).length;
    if (digitCount >= 4) return false;
    return true;
  }

  function getStableClasses(el) {
    if (!el.classList) return [];
    return Array.from(el.classList)
      .filter((c) => c !== HIGHLIGHT_CLASS && c !== MASKED_CLASS)
      .filter(isStableClassName)
      .slice(0, 3);
  }

  // CSS 식별자(id, class, 태그명)에 안전하게 쓰도록 이스케이프한다.
  function escapeCssIdent(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  // 속성 선택자 안의 문자열 값(따옴표 안)을 안전하게 이스케이프한다.
  function escapeAttrValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  // selector 문자열 길이 상한. 일반 selector는 짧고 읽기 쉬운 것을 선호하지만, element 범위의
  // 최후 수단인 위치 기반 경로(buildPositionalSelector)는 깊게 중첩된 사이트에서 길어질 수밖에
  // 없으므로 더 넉넉한 상한을 따로 둔다. (예전에는 상한이 하나뿐이라, 깊은 DOM에서 만들어진
  // 위치 경로가 길이 제한에 걸려 조용히 버려지고 element 범위 자체가 비활성화됐다.)
  const SELECTOR_MAX_LENGTH = 250;
  const POSITIONAL_SELECTOR_MAX_LENGTH = 600;

  // 선택자가 문서에서 정확히 하나의 요소만 가리키는지 확인한다.
  function isUniqueSelector(selector, el, maxLength) {
    if (!selector || selector.length > (maxLength || SELECTOR_MAX_LENGTH)) return false;
    try {
      // Cloakli 자신의 UI(토스트/안내 바/범위 선택 창)도 <div> 등 흔한 태그를 쓰므로,
      // 조상 경로가 짧은 요소(:nth-of-type만 남는 경우)에서는 이 요소들이 우연히 같은
      // "N번째 div" 자리에 있어 개수를 헷갈리게 만들 수 있다. 그래서 Cloakli 자신이 만든
      // 요소는 유일성 판단에서 항상 제외한다.
      const matches = Array.from(document.querySelectorAll(selector)).filter((m) => !isCloakliOwnElement(m));
      return matches.length === 1 && matches[0] === el;
    } catch (err) {
      // 문법 오류가 있는 선택자는 사용하지 않는다.
      return false;
    }
  }

  function getNthOfType(el) {
    let index = 1;
    let sibling = el.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === el.tagName) index++;
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  // node의 형제 중, 같은 태그이면서 같은 안정적 class 조합을 가진 것이 node 말고도
  // 더 있는지 확인한다. YouTube의 영상 그리드처럼 반복되는 카드는 보통 각 단계마다
  // 똑같은 class를 공유하므로(예: 모든 카드가 "video-card"), class만으로는 형제를
  // 구분할 수 없다 - 이럴 때만 nth-of-type을 추가로 붙여 구분한다.
  function siblingsShareSameCompound(node, stableClasses) {
    const parent = node.parentElement;
    if (!parent) return false;
    const signature = stableClasses.slice().sort().join(",");
    let count = 0;
    Array.from(parent.children).forEach((sibling) => {
      if (sibling.tagName !== node.tagName) return;
      const siblingSignature = getStableClasses(sibling).slice().sort().join(",");
      if (siblingSignature === signature) count++;
    });
    return count > 1;
  }

  // 조상 결합자(">")가 없는 얕은 selector 중, 흔히 카드마다 재사용되는 일반적인 이름
  // 패턴(예: id="thumbnail", 태그 하나뿐인 div/a/img 등 - content-core.js의 isRiskySelector
  // 참고)은 element 범위에 쓰기에 너무 위험하다고 본다: 지금 문서에서는 우연히 유일해도
  // (예: 아직 한 장만 로드된 경우) 카드가 더 로드되면 같은 이름이 다른 카드에도 나타나
  // 함께 가려질 수 있기 때문이다. 단순히 "형제가 여러 개"라는 이유만으로는 판단하지 않는다 -
  // 평범한 페이지도 흔히 같은 태그의 형제를 여럿 갖고 있으므로, 실제로 위험한 것은
  // "이름 자체가 반복 카드에서 흔히 재사용되는 패턴"인지 여부다.
  function isFragileShallowSelector(selector) {
    return CloakliCore.isRiskySelector(selector);
  }

  // 부모 요소들과의 조합, 최후에는 nth-of-type 경로로 선택자를 만든다.
  function buildAncestorPathSelector(el) {
    const parts = [];
    let node = el;
    let depth = 0;
    const MAX_DEPTH = 5;

    while (node && node.nodeType === 1 && depth < MAX_DEPTH) {
      if (node === document.body || node === document.documentElement) break;

      const tag = node.tagName.toLowerCase();
      let part;

      // id 지름길은 그 id가 문서에서 "실제로 유일할 때"만 쓴다. YouTube처럼 카드마다
      // 같은 id(#thumbnail, #channel-name 등)를 재사용하는 사이트에서 재사용 id를 만나면
      // 여기서 멈추지 말고 class/nth-of-type 조합으로 계속 조상 경로를 쌓아 올려야 한다 -
      // 예전에는 첫 id에서 무조건 break해서, 재사용 id 때문에 전체 경로가 유일하지 않게 되어
      // selector 생성 자체가 실패했다(채널명에서 '이 요소만'이 사라지던 원인).
      const idSelectorCandidate = node.id && isReasonableValue(node.id) ? "#" + escapeCssIdent(node.id) : null;
      if (idSelectorCandidate && !isFragileShallowSelector(idSelectorCandidate) && isUniqueSelector(idSelectorCandidate, node)) {
        part = idSelectorCandidate;
        parts.unshift(part);
        break; // 문서에서 유일한 id를 찾았으므로 더 올라갈 필요가 없다.
      }

      const stableClasses = getStableClasses(node);
      if (stableClasses.length > 0) {
        part = tag + stableClasses.map((c) => "." + escapeCssIdent(c)).join("");
        // 반복 카드처럼 형제가 완전히 같은 태그+class를 공유하면, class만으로는 이 카드를
        // 다른 카드와 구분할 수 없으므로 nth-of-type을 최후 수단으로 덧붙인다.
        if (siblingsShareSameCompound(node, stableClasses)) {
          part += ":nth-of-type(" + getNthOfType(node) + ")";
        }
      } else {
        part = tag + ":nth-of-type(" + getNthOfType(node) + ")";
      }
      parts.unshift(part);

      node = node.parentElement;
      depth++;
    }

    if (parts.length === 0) return null;
    return parts.join(" > ");
  }

  // selector가 실제로 문서에서 유일하고(isUniqueSelector), 카드마다 재사용되는 흔한
  // id/태그 하나뿐인 얕은 형태가 아닌지(isFragileShallowSelector) 함께 확인한다. element
  // 범위 selector가 "지금은 유일하지만 흔히 재사용되는 이름 하나뿐"인 경우를 걸러 더
  // 구체적인 조상 경로(buildAncestorPathSelector)로 넘기기 위함이다.
  function isSafeElementScopeSelector(sel, el) {
    return isUniqueSelector(sel, el) && !isFragileShallowSelector(sel);
  }

  // 안정적인 CSS 선택자를 우선순위에 따라 생성한다.
  // 우선순위: id > 안정적 data-* > data-testid > data-test > aria-label > name > class 조합 > 부모/자식 조합 > nth-of-type
  function generateStableSelector(el) {
    if (!isSelectable(el)) return null;

    // 1. 고유한 id
    if (el.id && isReasonableValue(el.id)) {
      const sel = "#" + escapeCssIdent(el.id);
      if (isSafeElementScopeSelector(sel, el)) return sel;
    }

    // 2. 안정적인 data-* 속성 (data-testid, data-test 제외한 나머지)
    if (el.attributes) {
      for (const attr of Array.from(el.attributes)) {
        if (
          attr.name.startsWith("data-") &&
          attr.name !== "data-testid" &&
          attr.name !== "data-test" &&
          isReasonableValue(attr.value)
        ) {
          const sel = "[" + attr.name + '="' + escapeAttrValue(attr.value) + '"]';
          if (isSafeElementScopeSelector(sel, el)) return sel;
        }
      }
    }

    // 3. data-testid
    const testId = el.getAttribute("data-testid");
    if (isReasonableValue(testId)) {
      const sel = '[data-testid="' + escapeAttrValue(testId) + '"]';
      if (isSafeElementScopeSelector(sel, el)) return sel;
    }

    // 4. data-test
    const testAttr = el.getAttribute("data-test");
    if (isReasonableValue(testAttr)) {
      const sel = '[data-test="' + escapeAttrValue(testAttr) + '"]';
      if (isSafeElementScopeSelector(sel, el)) return sel;
    }

    // 5. aria-label
    const ariaLabel = el.getAttribute("aria-label");
    if (isReasonableValue(ariaLabel)) {
      const sel = '[aria-label="' + escapeAttrValue(ariaLabel) + '"]';
      if (isSafeElementScopeSelector(sel, el)) return sel;
    }

    // 6. name
    const name = el.getAttribute("name");
    if (isReasonableValue(name)) {
      const sel = el.tagName.toLowerCase() + '[name="' + escapeAttrValue(name) + '"]';
      if (isSafeElementScopeSelector(sel, el)) return sel;
    }

    // 7. 안정적인 class 조합
    const stableClasses = getStableClasses(el);
    if (stableClasses.length > 0) {
      const sel = el.tagName.toLowerCase() + stableClasses.map((c) => "." + escapeCssIdent(c)).join("");
      if (isSafeElementScopeSelector(sel, el)) return sel;
    }

    // 8~9. 부모/자식 조합, 최후 수단으로 nth-of-type 경로
    const pathSelector = buildAncestorPathSelector(el);
    if (pathSelector && isSafeElementScopeSelector(pathSelector, el)) return pathSelector;

    return null;
  }

  // target에서 root 바로 아래 자식까지의 각 단계를 tag.class(필요 시 :nth-of-type)로 만들어
  // " > "로 잇는다. buildElementScopeSelector가 "이 카드 인스턴스 + 내부 요소" 형태의
  // selector를 만들 때 내부 경로 부분으로 쓴다.
  function buildPathBetween(target, root) {
    const parts = [];
    let node = target;
    let guard = 0;
    while (node && node !== root && node.nodeType === 1 && guard < 8) {
      const tag = node.tagName.toLowerCase();
      const stableClasses = getStableClasses(node);
      let part = tag + stableClasses.map((c) => "." + escapeCssIdent(c)).join("");
      if (stableClasses.length === 0 || siblingsShareSameCompound(node, stableClasses)) {
        part += ":nth-of-type(" + getNthOfType(node) + ")";
      }
      parts.unshift(part);
      node = node.parentElement;
      guard++;
    }
    if (node !== root || parts.length === 0) return null;
    return parts.join(" > ");
  }

  // 대상에서 위로 올라가며 각 단계를 tag(+안정적 class)+:nth-of-type로 쌓고, 단계를 하나
  // 추가할 때마다 유일성을 검사해 "문서에서 유일해지는 가장 짧은" 위치 기반 selector를
  // 만든다. 중간에 문서에서 유일한 id를 만나면 그 id를 최상위 anchor로 삼아 즉시 마무리한다.
  // generateStableSelector와 반복-루트 결합이 모두 실패하는 깊게 중첩된 최신 웹사이트
  // (YouTube/Instagram 등)에서도 element 범위 selector가 거의 항상 생성되게 하는 최종 fallback.
  // 위치 기반이라 순서가 바뀌면 깨질 수 있지만, 재적용은 fingerprint(resolveElementScopeTarget)로
  // 보완하므로 "지금 이 요소 하나"를 확실히 특정하는 것이 우선이다.
  function buildPositionalSelector(target) {
    const parts = [];
    let node = target;
    let depth = 0;
    const MAX_DEPTH = 12;

    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement && depth < MAX_DEPTH) {
      // 이 단계에서 문서 전체에서 유일한 id를 만나면, 그것을 최상위 anchor로 삼아 마무리한다.
      const idCandidate = node.id && isReasonableValue(node.id) ? "#" + escapeCssIdent(node.id) : null;
      if (idCandidate && isUniqueSelector(idCandidate, node)) {
        parts.unshift(idCandidate);
        const sel = parts.join(" > ");
        if (isUniqueSelector(sel, target, POSITIONAL_SELECTOR_MAX_LENGTH)) return sel;
        parts.shift(); // 이 anchor로는 유일해지지 않았으므로 되돌리고 계속 올라간다.
      }

      // 위치 경로는 각 단계를 "태그 + :nth-of-type"로만 만든다. class를 모두 붙이면
      // (YouTube의 style-scope ... 처럼) 길이만 폭증하고, 형제 구분은 이미 nth-of-type이
      // 하므로 유일성에는 도움이 되지 않는다.
      const part = node.tagName.toLowerCase() + ":nth-of-type(" + getNthOfType(node) + ")";
      parts.unshift(part);

      const candidate = parts.join(" > ");
      if (isUniqueSelector(candidate, target, POSITIONAL_SELECTOR_MAX_LENGTH)) return candidate;

      node = node.parentElement;
      depth++;
    }

    const full = parts.join(" > ");
    return full && isUniqueSelector(full, target, POSITIONAL_SELECTOR_MAX_LENGTH) ? full : null;
  }

  // "이 요소만"(element) 범위에 쓸 selector의 단일 진입점.
  // 1) 기존 우선순위 기반 생성(generateStableSelector) - 안정적인 id/속성/class 경로.
  // 2) 반복 카드 안의 요소면 "이 카드 인스턴스 경로 + 카드 안 내부 경로" 결합.
  // 3) 그래도 실패하면(깊게 중첩된 최신 웹사이트) 위치 기반 selector(buildPositionalSelector).
  // 이 셋을 차례로 시도해, 정상적으로 클릭한 요소라면 element 범위 selector가 거의 항상
  // 생성되도록 보장한다(button이 비활성화되어 "선택이 안 되는" 문제 해결).
  function buildElementScopeSelector(target) {
    const direct = generateStableSelector(target);
    if (direct) return direct;

    const root = findRepeatedRoot(target);
    if (root && root !== target) {
      const rootPath = buildAncestorPathSelector(root);
      const innerPath = buildPathBetween(target, root);
      if (rootPath && innerPath) {
        const candidate = rootPath + " > " + innerPath;
        if (isUniqueSelector(candidate, target)) return candidate;
      }
    }

    return buildPositionalSelector(target);
  }

  // ---------------------------------------------------------------------
  // element 범위 fingerprint: selector가 순서 변경/재렌더링/가상화로 깨져도 "그 요소"를
  // 다시 찾을 수 있도록, 텍스트 내용 없이 구조적 신호만 저장한다.
  //   - tag / id / stable class / role / 형제 중 위치(nthOfType)
  //   - 반복 카드 루트의 tag/class/위치, 루트까지의 깊이
  //   - href / 이미지 src는 원문 대신 해시만 저장(개인정보 최소화, 동일성 비교용)
  // 실제 텍스트/제목/이메일/날짜/innerHTML은 절대 저장하지 않는다.
  // ---------------------------------------------------------------------

  function depthBetween(descendant, ancestor) {
    let d = 0;
    let node = descendant;
    while (node && node !== ancestor && d < 20) {
      node = node.parentElement;
      d++;
    }
    return node === ancestor ? d : -1;
  }

  // href/src의 마지막 경로 조각만 해시한다(query 제외). YouTube 영상 링크처럼 조각이
  // 콘텐츠를 구분하는 안정적 키가 될 수 있으면 재적용 정확도를 크게 높인다. 해시라서
  // 원문(영상 ID/사용자명 등)은 저장되지 않는다.
  function hashedUrlKey(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl) return null;
    let pathTail = rawUrl;
    try {
      const u = new URL(rawUrl, location.href);
      const segs = u.pathname.split("/").filter(Boolean);
      pathTail = (segs.length ? segs[segs.length - 1] : u.pathname) + (u.search || "");
    } catch (err) {
      const q = rawUrl.split("?")[0];
      const segs = q.split("/").filter(Boolean);
      pathTail = segs.length ? segs[segs.length - 1] : rawUrl;
    }
    return CloakliCore.hashString(pathTail);
  }

  function buildElementFingerprint(el) {
    if (!el || el.nodeType !== 1) return null;
    const fp = {
      tag: el.tagName.toLowerCase(),
      id: el.id && isReasonableValue(el.id) ? el.id : null,
      classes: getStableClasses(el),
      role: isReasonableValue(el.getAttribute && el.getAttribute("role"), 40) ? el.getAttribute("role") : null,
      nthOfType: getNthOfType(el),
    };

    const root = findRepeatedRoot(el);
    if (root) {
      fp.rootTag = root.tagName.toLowerCase();
      fp.rootClasses = getStableClasses(root);
      fp.rootIndex = getNthOfType(root);
      fp.depthFromRoot = depthBetween(el, root);
    }

    // href/src 해시(원문 저장 금지). 대상 자신 또는 가까운 링크/이미지에서 가져온다.
    const linkEl = el.tagName === "A" && el.getAttribute("href") ? el : (el.closest && el.closest("a[href]"));
    if (linkEl && linkEl.getAttribute("href")) {
      const key = hashedUrlKey(linkEl.getAttribute("href"));
      if (key) fp.hrefKey = key;
    }
    const src = el.getAttribute && el.getAttribute("src");
    if (src) {
      const key = hashedUrlKey(src);
      if (key) fp.srcKey = key;
    }
    return fp;
  }

  // 후보 요소가 fingerprint와 얼마나 맞는지 점수화한다(높을수록 일치). 텍스트는 보지 않는다.
  function scoreFingerprintMatch(fp, el) {
    if (!fp || !el || el.nodeType !== 1) return -1;
    if (fp.tag && el.tagName.toLowerCase() !== fp.tag) return -1; // 태그는 필수 일치

    let score = 0;
    if (fp.id && el.id === fp.id) score += 3;

    const elClasses = getStableClasses(el);
    if (fp.classes && fp.classes.length) {
      const shared = fp.classes.filter((c) => elClasses.indexOf(c) !== -1).length;
      score += shared;
      if (shared === fp.classes.length) score += 1; // 완전 일치 보너스
    }

    if (fp.role && el.getAttribute && el.getAttribute("role") === fp.role) score += 1;
    if (typeof fp.nthOfType === "number" && getNthOfType(el) === fp.nthOfType) score += 1;

    if (fp.hrefKey) {
      const linkEl = el.tagName === "A" && el.getAttribute("href") ? el : (el.closest && el.closest("a[href]"));
      if (linkEl && hashedUrlKey(linkEl.getAttribute("href")) === fp.hrefKey) score += 5;
    }
    if (fp.srcKey && el.getAttribute) {
      const src = el.getAttribute("src");
      if (src && hashedUrlKey(src) === fp.srcKey) score += 5;
    }

    if (fp.rootTag) {
      const root = findRepeatedRoot(el);
      if (root && root.tagName.toLowerCase() === fp.rootTag) {
        score += 2;
        const rootClasses = getStableClasses(root);
        if (fp.rootClasses && fp.rootClasses.length) {
          score += fp.rootClasses.filter((c) => rootClasses.indexOf(c) !== -1).length;
        }
        if (typeof fp.rootIndex === "number" && getNthOfType(root) === fp.rootIndex) score += 1;
        if (typeof fp.depthFromRoot === "number" && depthBetween(el, root) === fp.depthFromRoot) score += 1;
      }
    }
    return score;
  }

  // fingerprint의 tag로 후보를 모은다(비용 제한을 위해 최대 개수 제한). 선택 가능한 것만.
  const FINGERPRINT_MAX_CANDIDATES = 600;
  function gatherFingerprintCandidates(fp) {
    if (!fp || !fp.tag) return [];
    let all = [];
    try {
      all = Array.from(document.querySelectorAll(fp.tag));
    } catch (err) {
      return [];
    }
    const out = [];
    for (const el of all) {
      if (out.length >= FINGERPRINT_MAX_CANDIDATES) break;
      if (!isSelectable(el) || isCloakliOwnElement(el)) continue;
      out.push(el);
    }
    return out;
  }

  // fingerprint로 가장 잘 맞는 요소 하나를 고른다. 확신할 수 있을 때만 반환한다:
  // 최고 점수가 최소 기준 이상이고, 2등보다 확실히 높을 때(유일한 승자)만. 애매하면 null.
  const FINGERPRINT_MIN_SCORE = 3;
  function findBestFingerprintMatch(fp, candidates) {
    if (!fp || !candidates || candidates.length === 0) return null;
    let best = null;
    let bestScore = -1;
    let secondScore = -1;
    for (const el of candidates) {
      const s = scoreFingerprintMatch(fp, el);
      if (s > bestScore) {
        secondScore = bestScore;
        bestScore = s;
        best = el;
      } else if (s > secondScore) {
        secondScore = s;
      }
    }
    if (best && bestScore >= FINGERPRINT_MIN_SCORE && bestScore > secondScore) return best;
    return null;
  }

  // fingerprint에 "확실히 구분되는 키"(href/src 해시, 고유 id)가 있으면, 후보가 그 키를
  // 실제로 가졌는지 확인한다. 위치 기반 selector가 순서 변경으로 "다른 항목"을 가리키게
  // 됐는지(drift) 빠르게 감지하는 데 쓴다.
  function hasDistinctiveKey(fp) {
    return !!(fp && (fp.hrefKey || fp.srcKey || fp.id));
  }
  function distinctiveKeyAgrees(fp, el) {
    if (fp.id && el.id !== fp.id) return false;
    if (fp.hrefKey) {
      const linkEl = el.tagName === "A" && el.getAttribute("href") ? el : (el.closest && el.closest("a[href]"));
      const key = linkEl && linkEl.getAttribute("href") ? hashedUrlKey(linkEl.getAttribute("href")) : null;
      if (key !== fp.hrefKey) return false;
    }
    if (fp.srcKey && el.getAttribute) {
      const src = el.getAttribute("src");
      if (!src || hashedUrlKey(src) !== fp.srcKey) return false;
    }
    return true;
  }

  // 재적용 시 "이 요소만" 규칙이 실제로 가릴 요소 하나를 결정한다(content-core.applyRuleSet의
  // resolveElementTarget 어댑터).
  //  - selector가 정확히 1개를 찾고, fingerprint의 구분 키가 그 요소와 일치하면 → 그 하나(빠른 경로).
  //  - selector가 1개인데 구분 키가 어긋나면(순서 변경으로 selector가 다른 항목을 가리킴) →
  //    fingerprint로 문서 전체에서 그 요소를 다시 찾는다.
  //  - selector가 0개/여러 개면 → fingerprint로 다시 찾는다.
  // 확신할 수 없으면 null을 돌려 아무 것도 가리지 않는다(다른 요소를 잘못 가리는 것보다 안전).
  function resolveElementScopeTarget(rule, matchedFromSelector) {
    const matched = Array.from(matchedFromSelector || []).filter((m) => isSelectable(m) && !isCloakliOwnElement(m));
    const fp = rule.fingerprint;

    if (!fp) {
      return matched.length === 1 ? matched[0] : null;
    }

    if (matched.length === 1) {
      const only = matched[0];
      if (hasDistinctiveKey(fp) && !distinctiveKeyAgrees(fp, only)) {
        const better = findBestFingerprintMatch(fp, gatherFingerprintCandidates(fp));
        if (better) return better;
      }
      return only;
    }

    const pool = matched.length > 0 ? matched : gatherFingerprintCandidates(fp);
    return findBestFingerprintMatch(fp, pool);
  }

  // 태그명 + 안정적인 class(최대 2개) + 안정적인 속성(data-testid/data-component/role)으로
  // "이 요소 하나"가 아니라 "같은 종류의 요소들"을 가리키는 compound selector 조각을 만든다.
  // 의도적으로 id, nth-of-type, nth-child, 실제 텍스트는 절대 사용하지 않는다.
  function buildGeneralizedCompound(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName.toLowerCase();
    let compound = tag;

    ["data-testid", "data-component"].forEach((attrName) => {
      const value = el.getAttribute(attrName);
      if (isReasonableValue(value, 60)) {
        compound += "[" + attrName + '="' + escapeAttrValue(value) + '"]';
      }
    });

    const role = el.getAttribute("role");
    if (isReasonableValue(role, 40)) {
      compound += '[role="' + escapeAttrValue(role) + '"]';
    }

    const stableClasses = getStableClasses(el);
    stableClasses.slice(0, 2).forEach((c) => {
      compound += "." + escapeCssIdent(c);
    });

    return compound;
  }

  // compound가 class/속성 없이 태그 이름 하나뿐인지 확인한다. (너무 광범위한 selector 방지)
  function hasGeneralizedQualifier(compound) {
    return !!compound && (compound.indexOf(".") !== -1 || compound.indexOf("[") !== -1);
  }

  // 클릭 가능한 링크(또는 role=link/article)인지 판별한다. 일반화 selector가 이런
  // 요소 전체를 가림 대상으로 삼으면, 그 안의 제목/채널명까지 함께 가려지고 클릭도
  // 막히므로(가림 레이어가 통째로 링크를 덮음) 대상에서 제외해야 한다.
  function isLinkLikeElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === "A" && el.getAttribute("href")) return true;
    const role = el.getAttribute("role");
    return role === "link" || role === "article";
  }

  // 이미지류로 볼 수 있는 시각적 미디어 요소인지 확인한다. YouTube 전용 태그를
  // 하드코딩하지 않기 위해 표준 태그(img, picture)만 기준으로 삼는다.
  const MEDIA_TAGS = ["IMG", "PICTURE", "VIDEO", "CANVAS"];
  const MEDIA_LIKE_SELECTOR = "img, picture";

  function findVisualMediaDescendant(el) {
    if (!el || typeof el.querySelector !== "function") return null;
    try {
      return el.querySelector(MEDIA_LIKE_SELECTOR);
    } catch (err) {
      return null;
    }
  }

  // 요소가 CSS background-image로 그림을 표시하는지(예: div에 배경 썸네일). getComputedStyle이
  // 없거나 실패하는 환경(테스트)에서는 false로 안전하게 처리한다.
  function hasBackgroundImage(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      if (typeof getComputedStyle !== "function") return false;
      const bg = getComputedStyle(el).backgroundImage;
      return !!bg && bg !== "none" && /url\(/i.test(bg);
    } catch (err) {
      return false;
    }
  }

  // el 자신 또는 얕은 자손 중, background-image를 가진(그리고 텍스트를 직접 표시하지 않는)
  // 시각 요소를 찾는다. img/picture가 없는 배경 썸네일 대응.
  function findBackgroundImageTarget(el) {
    if (hasBackgroundImage(el) && !displaysOwnText(el)) return el;
    let queue = [el];
    let depth = 0;
    while (queue.length > 0 && depth < 3) {
      const next = [];
      for (const node of queue) {
        for (const child of node.children || []) {
          if (isCloakliOwnElement(child)) continue;
          if (hasBackgroundImage(child) && !displaysOwnText(child) && hasVisibleBox(child)) return child;
          next.push(child);
        }
      }
      queue = next;
      depth++;
    }
    return null;
  }

  // el이 "자기 자신의" 텍스트를 직접 표시하는지 확인한다(자손 텍스트가 아니라).
  // 실제 DOM에서는 자식 텍스트 노드로 판별하고, 자식 요소가 전혀 없는 잎(leaf) 요소는
  // textContent로도 판별한다(테스트 환경 호환).
  function displaysOwnText(el) {
    if (!el) return false;
    const kids = el.childNodes || [];
    for (const n of kids) {
      if (n.nodeType === 3 && String(n.textContent || "").trim()) return true;
    }
    if (el.children && el.children.length === 0 && typeof el.textContent === "string" && el.textContent.trim()) {
      return true;
    }
    return false;
  }

  function hasVisibleBox(el) {
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (err) {
      return true; // rect를 잴 수 없는 환경에서는 보이는 것으로 가정한다.
    }
  }

  // 역할/종류 판별에 쓰는 구조 신호: 태그명 + class + id 이름만 사용한다(텍스트 내용 미사용).
  function attrSignature(el) {
    return ((el.tagName || "") + " " + (el.className || "") + " " + (el.id || "")).toLowerCase();
  }

  function hasLinkAncestor(el) {
    let node = el.parentElement;
    let depth = 0;
    while (node && depth < 5) {
      if (isLinkLikeElement(node)) return true;
      node = node.parentElement;
      depth++;
    }
    return false;
  }

  // 사용자가 클릭한 요소의 "역할"을 구조적으로 분류한다. 텍스트 내용은 절대 보지 않고,
  // 태그명과 class/id 이름 패턴만 사용한다(특정 사이트 하드코딩 없이 일반적인 이름 관례 기준).
  // 반환: "thumbnail" | "title" | "channel-name" | "date-time" | "generic-text" |
  //       "generic-image" | "generic-element"
  function classifySelectableRole(el) {
    if (!el || el.nodeType !== 1) return "generic-element";
    const sig = attrSignature(el);

    if (MEDIA_TAGS.indexOf(el.tagName) !== -1) {
      return findRepeatedRoot(el) || hasLinkAncestor(el) ? "thumbnail" : "generic-image";
    }
    if (/thumb|poster/.test(sig) && (findVisualMediaDescendant(el) || hasBackgroundImage(el))) return "thumbnail";
    if (/^h[1-6]$/i.test(el.tagName) || /title|headline|heading/.test(sig)) return "title";
    if (/channel|byline|author|owner/.test(sig)) return "channel-name";
    if (el.tagName === "TIME" || /date|timestamp|time/.test(sig)) return "date-time";
    if (displaysOwnText(el)) return "generic-text";
    if (findVisualMediaDescendant(el) || (hasBackgroundImage(el) && !displaysOwnText(el))) return "generic-image";
    return "generic-element";
  }

  // 범위 선택 UI에 표시할 "선택한 대상" 문구. 개발 용어/selector는 노출하지 않는다.
  function describeSelectionTargetLabel(role, family) {
    if (role === "thumbnail") {
      return family === "shorts-card" ? "Shorts 썸네일" : "썸네일";
    }
    const labels = {
      title: "제목",
      "channel-name": "채널명",
      "date-time": "날짜·시간",
      "generic-text": "텍스트",
      "generic-image": "이미지",
    };
    return labels[role] || "선택한 영역";
  }

  // node의 형제 중, 같은 태그이면서 같은 안정적 class 조합을 가진 것이 3개 이상(자기 자신 포함)
  // 있는지 확인한다. "반복되는 카드 목록의 한 항목"인지 판별하는 데 쓰인다.
  function isPartOfRepeatedGroup(node) {
    const parent = node.parentElement;
    if (!parent) return false;
    const signature = getStableClasses(node).slice().sort().join(",");
    let count = 0;
    Array.from(parent.children).forEach((sibling) => {
      if (sibling.tagName !== node.tagName) return;
      if (getStableClasses(sibling).slice().sort().join(",") === signature) count++;
    });
    return count >= 3;
  }

  // el 자신 또는 조상 중, "반복되는 카드 목록의 뿌리(root)"로 볼 수 있는 가장 가까운 요소를
  // 찾는다. 이 뿌리의 tag+class 조합이 "어떤 종류의 반복 카드인가"를 구분하는 신호가 된다 -
  // 롱폼과 Shorts처럼 내부 이미지 태그/class가 우연히 같아도, 반복되는 카드 자체의 tag+class가
  // 다르면 서로 다른 종류로 구분된다.
  function findRepeatedRoot(el) {
    let node = el;
    let depth = 0;
    const MAX_DEPTH = 6;
    while (node && node.nodeType === 1 && depth < MAX_DEPTH) {
      if (node === document.body || node === document.documentElement) return null;
      if (isPartOfRepeatedGroup(node)) return node;
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  // el이 속한 반복 카드 목록의 "종류(family)"를 분류한다. family 이름은 반복 루트의
  // class/tag 이름 패턴으로 붙이되(shorts/longform/mail 등 일반적인 관례어), 이름이
  // 매칭되지 않는 구조는 반복 루트의 compound selector 자체를 family 문자열로 사용해
  // 서로 다른 구조가 항상 서로 다른 family가 되게 한다(특정 사이트 하드코딩 없이 동작).
  //   { family, repeatedRootSelector, rootEl }
  function classifyContentFamily(el) {
    const root = findRepeatedRoot(el);
    if (!root) {
      return { family: "generic", repeatedRootSelector: null, rootEl: null };
    }
    const rootCompound = buildGeneralizedCompound(root);
    if (!hasGeneralizedQualifier(rootCompound)) {
      return { family: "generic", repeatedRootSelector: null, rootEl: null };
    }
    const sig = attrSignature(root);
    let family;
    if (/short|reel/.test(sig)) family = "shorts-card";
    else if (/mail|inbox|message/.test(sig)) family = "mail-list-row";
    else if (/longform|video|watch/.test(sig)) family = "longform-card";
    else family = rootCompound; // 구조 기반 고유 family
    return { family: family, repeatedRootSelector: rootCompound, rootEl: root };
  }

  // 제목/채널명/날짜처럼 "텍스트를 표시하는" 대상을 결정한다. 클릭한 요소가 빈 wrapper라면
  // 실제로 텍스트를 표시하는 가장 가까운(얕은) 자손을 찾고, 같은 깊이에 텍스트 조각이 여러 개면
  // (여러 span으로 나뉜 제목) 그 최소 공통 wrapper인 클릭 요소 자신을 사용한다. 자손에 없으면
  // 조상 방향으로 최대 2단계 올라가되, 반복 카드 루트(카드 전체)까지는 올라가지 않는다.
  function resolveTextMaskTarget(el) {
    if (displaysOwnText(el) && hasVisibleBox(el)) return el;

    let queue = [el];
    let depth = 0;
    while (queue.length > 0 && depth < 4) {
      const next = [];
      const textChildren = [];
      for (const node of queue) {
        for (const child of node.children || []) {
          if (isCloakliOwnElement(child)) continue;
          if (displaysOwnText(child) && hasVisibleBox(child)) textChildren.push(child);
          next.push(child);
        }
      }
      if (textChildren.length === 1) return textChildren[0];
      if (textChildren.length > 1) return el; // 여러 텍스트 조각의 최소 공통 wrapper
      queue = next;
      depth++;
    }

    const repeatedRoot = findRepeatedRoot(el);
    let ancestor = el.parentElement;
    let up = 0;
    while (ancestor && ancestor !== repeatedRoot && up < 2 && isSelectable(ancestor)) {
      if (displaysOwnText(ancestor) && hasVisibleBox(ancestor)) return ancestor;
      ancestor = ancestor.parentElement;
      up++;
    }
    return el;
  }

  // selectedElement(사용자가 실제로 클릭한 요소)와 시각적 가림 대상(visual mask target)을
  // 분리한다. 역할(role)에 따라:
  //  - thumbnail/generic-image: 링크/카드 전체가 아니라 그 안의 이미지 등 시각 영역만.
  //    이미지 자손이 없는 링크는 null(이 범위 사용 불가 - 클릭 가능성 보존).
  //  - title/channel-name/date-time/generic-text: 실제 텍스트를 표시하는 요소.
  //  - generic-element: 링크라면 이미지 자손, 아니면 클릭한 요소 그대로.
  function resolveVisualMaskTarget(selectedElement, role) {
    const r = role || classifySelectableRole(selectedElement);

    if (r === "thumbnail" || r === "generic-image") {
      if (MEDIA_TAGS.indexOf(selectedElement.tagName) !== -1) return selectedElement;
      const media = findVisualMediaDescendant(selectedElement);
      if (media && isSelectable(media)) return media;
      // img/picture가 없으면 background-image로 그림을 표시하는 요소를 찾는다.
      const bg = findBackgroundImageTarget(selectedElement);
      if (bg && isSelectable(bg)) return bg;
      // 링크 자체가 background-image로 썸네일을 표시하는 경우(자손 없음): 링크 자신을 대상으로
      // 삼되(클릭은 오버레이가 전달), 배경 그림이 전혀 없으면 이 범위는 쓸 수 없다.
      if (isLinkLikeElement(selectedElement)) {
        return hasBackgroundImage(selectedElement) ? selectedElement : null;
      }
      return selectedElement;
    }

    if (r === "title" || r === "channel-name" || r === "date-time" || r === "generic-text") {
      return resolveTextMaskTarget(selectedElement) || selectedElement;
    }

    if (isLinkLikeElement(selectedElement)) {
      const media = findVisualMediaDescendant(selectedElement);
      return media && isSelectable(media) ? media : null;
    }
    return selectedElement;
  }

  // "현재 페이지의 같은 종류 모두" / "이 사이트의 같은 종류 모두"에 쓰이는 일반화 selector를
  // 만든다. target은 이미 resolveVisualMaskTarget으로 결정된 시각적 가림 대상이다.
  // 대상 자신만으로 selector를 만들 수 있어도, 반복 카드 목록 안에 있다면 반드시 그 반복
  // 루트(classifyContentFamily)를 함께 포함시킨다 - 그렇지 않으면 내부 이미지/텍스트 태그가
  // 우연히 같은 서로 다른 종류의 카드(롱폼/Shorts 등)를 구분하지 못하고 함께 찾게 된다.
  // 무작위 해시 class, nth-of-type/nth-child, 실제 텍스트, 동적 속성은 사용하지 않는다.
  function generateGeneralizedSelector(target) {
    if (!isSelectable(target)) return null;

    const ownCompound = buildGeneralizedCompound(target);
    if (!hasGeneralizedQualifier(ownCompound)) {
      // 대상 자신만으로는 안정적인 selector를 만들 수 없으면(흔한 div/span 하나뿐인 경우),
      // 반복 카드처럼 보이는 부모 컨테이너와 결합해 "컨테이너 자손" 형태의 selector를 시도한다.
      let ancestor = target.parentElement;
      let depth = 0;
      const MAX_ANCESTOR_DEPTH = 2;
      while (ancestor && depth < MAX_ANCESTOR_DEPTH && isSelectable(ancestor)) {
        const ancestorCompound = buildGeneralizedCompound(ancestor);
        if (hasGeneralizedQualifier(ancestorCompound)) {
          return ancestorCompound + " " + target.tagName.toLowerCase();
        }
        ancestor = ancestor.parentElement;
        depth++;
      }
      return null;
    }

    const context = classifyContentFamily(target);
    if (context.repeatedRootSelector && context.rootEl !== target) {
      return context.repeatedRootSelector + " " + ownCompound;
    }

    return ownCompound;
  }

  // ---------------------------------------------------------------------
  // 저장(chrome.storage.local) 관련
  // ---------------------------------------------------------------------

  function getHostname() {
    try {
      return location.hostname || null;
    } catch (err) {
      return null;
    }
  }

  // 현재 hostname에 저장된 규칙 목록을 읽는다. 실패해도 항상 배열을 돌려준다.
  function loadRulesForHost(hostname, callback) {
    try {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          callback([]);
          return;
        }
        const all = (result && result[STORAGE_KEY]) || {};
        callback(Array.isArray(all[hostname]) ? all[hostname] : []);
      });
    } catch (err) {
      callback([]);
    }
  }

  // 무료 한도로 규칙 저장이 차단된 이유를 사용자에게 보여줄 문구로 바꾼다.
  function describeFreeLimitReason(reason) {
    const reasons = {
      "rule-limit": "무료판에서는 가림 규칙을 최대 3개까지 저장할 수 있습니다.\n기존 규칙을 삭제하거나 Pro로 업그레이드하세요.",
      "hostname-limit": "무료판에서는 1개 사이트에서만 저장 기능을 사용할 수 있습니다.\n기존 사이트 규칙을 삭제하거나 Pro로 업그레이드하세요.",
      "scope-not-allowed": "페이지 유형과 사이트 전체 가림은 Pro 기능입니다.\n무료판에서는 '이 요소만'을 사용할 수 있습니다.",
    };
    return reasons[reason] || "무료판 한도로 인해 저장하지 못했습니다.";
  }

  // 새 규칙(scope 포함)을 저장한다. 완전히 같은 규칙(hostname+scope+selector+pagePattern)이
  // 이미 있으면 추가하지 않는다. 중복 판단/추가 로직은 content-core.js의
  // addRuleIfNotDuplicate를 그대로 재사용한다(options.js와 같은 기준을 공유하기 위함).
  function saveRule(newRule) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false });
            return;
          }
          const all = (result && result[STORAGE_KEY]) || {};
          const list = Array.isArray(all[newRule.hostname]) ? all[newRule.hostname] : [];

          // 무료/Pro 한도 판단은 항상 CloakliEntitlement.canCreateRule() 하나만 거친다.
          // popup/options의 사용량 표시도 같은 모듈(computeUsage)을 사용하므로 서로 다른
          // 기준으로 계산되지 않는다.
          const decision = CloakliEntitlement.canCreateRule({
            entitlementState: CloakliEntitlement.getEntitlementState(),
            allRulesByHostname: all,
            hostname: newRule.hostname,
            scope: newRule.scope,
          });
          if (!decision.allowed) {
            resolve({ ok: true, blocked: true, reason: decision.reason });
            return;
          }

          // "현재 페이지의 같은 종류 모두"(page)를 저장하려는데 이미 같은 selector의
          // "이 사이트의 같은 종류 모두"(site) 규칙이 있다면, page 규칙은 site 규칙에
          // 이미 포함되어 사실상 중복이므로 추가하지 않는다.
          if (newRule.scope === "page") {
            const coveredBySite = CloakliCore.ruleExists(list, {
              hostname: newRule.hostname,
              scope: "site",
              selector: newRule.selector,
              pagePattern: null,
            });
            if (coveredBySite) {
              resolve({ ok: true, coveredBySite: true });
              return;
            }
          }

          const outcome = CloakliCore.addRuleIfNotDuplicate(list, newRule);

          if (!outcome.added) {
            resolve({ ok: true, duplicate: true });
            return;
          }

          all[newRule.hostname] = outcome.list;

          chrome.storage.local.set({ [STORAGE_KEY]: all }, () => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false });
              return;
            }
            resolve({ ok: true, duplicate: false });
          });
        });
      } catch (err) {
        resolve({ ok: false });
      }
    });
  }

  // 사용자가 범위 선택 UI에서 고른 scope로 규칙을 저장하고 결과를 안내 메시지로 보여준다.
  //
  // newlyMaskedEls: 이번 선택에서 confirmScope가 방금 새로 가린 요소들(maskElement가 true를
  // 반환한 것만). 저장이 차단되거나(무료 한도) 실패하면, storage에는 아무것도 남지 않으므로
  // 화면에도 이번에 새로 생긴 가림이 남아 있으면 안 된다 - 여기서 정확히 그 요소들만 되돌린다.
  // 기존에 이미 저장된 규칙으로 가려져 있던 요소는 애초에 이 배열에 포함되지 않으므로 안전하다.
  function persistRuleWithScope(partialRule, successText, newlyMaskedEls) {
    const hostname = getHostname();
    const rollbackNewMasks = () => {
      (newlyMaskedEls || []).forEach((el) => removePersistentMask(el));
    };

    if (!hostname || !partialRule || !partialRule.selector) {
      rollbackNewMasks();
      showCloakliToast("현재 요소는 저장하지 못했습니다.\n가림은 이번 페이지에서만 유지됩니다.", "error");
      return;
    }

    const newRule = {
      id: CloakliCore.generateRuleId(),
      hostname: hostname,
      selector: partialRule.selector,
      scope: partialRule.scope,
      pagePattern: partialRule.pagePattern || null,
      // 어떤 역할(썸네일/제목/채널명/날짜 등)의 요소를 어떤 반복 구조(family) 안에서
      // 가리는 규칙인지 기록한다. options 화면이 "이전 방식 규칙"을 구분하는 데 쓴다.
      role: partialRule.role || null,
      family: partialRule.family || null,
      // element 범위에서 selector가 깨져도 요소를 다시 찾기 위한 구조적 fingerprint
      // (텍스트 내용 없음, href/src는 해시만). element 범위가 아니면 저장하지 않는다.
      fingerprint: partialRule.fingerprint || null,
      mode: "block",
      createdAt: Date.now(),
    };

    saveRule(newRule).then((result) => {
      if (!result || !result.ok) {
        rollbackNewMasks();
        showCloakliToast("현재 요소는 저장하지 못했습니다.\n가림은 이번 페이지에서만 유지됩니다.", "error");
      } else if (result.blocked) {
        // 무료 한도로 저장이 차단됨: storage에 남지 않으므로, 이번에 새로 만든 임시 가림도
        // 즉시 제거해 새로고침 전에도 원래(가려지지 않은) 상태로 되돌린다.
        rollbackNewMasks();
        showCloakliToast(describeFreeLimitReason(result.reason), "warning");
      } else if (result.duplicate) {
        // 이미 저장되어 있던 규칙과 완전히 같음: 방금 가린 것은 실제로 유효한 가림이므로 유지한다.
        showCloakliToast("이미 저장된 가림 영역입니다.", "info");
      } else if (result.coveredBySite) {
        showCloakliToast("이 사이트 전체에 이미 같은 규칙이 적용되어 있어 추가로 저장하지 않았습니다.", "info");
      } else {
        ruleCountCache += 1; // observer가 즉시 재적용 대상에 포함하도록 캐시를 갱신한다.
        showCloakliToast(successText, "success");
      }
    });
  }

  // 현재 hostname의 일시중지 상태를 읽는다. 실패해도 항상 false(일시중지 아님)를 돌려준다.
  function loadPausedState(hostname, callback) {
    try {
      chrome.storage.local.get([PAUSED_STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          callback(false);
          return;
        }
        const pausedMap = (result && result[PAUSED_STORAGE_KEY]) || {};
        callback(CloakliCore.isHostnamePaused(pausedMap, hostname));
      });
    } catch (err) {
      callback(false);
    }
  }

  // 저장된 규칙을 불러와 현재 문서에 다시 적용한다.
  // 최초 페이지 로딩, MutationObserver의 debounce 콜백, SPA URL 변경 후에
  // 모두 이 함수 하나를 재사용한다.
  function applyStoredRules() {
    if (isTemporarilyDisabled) return;

    const hostname = getHostname();
    if (!hostname) return;

    loadPausedState(hostname, (paused) => {
      isHostPaused = paused;
      // 이 사이트가 일시중지 상태면 저장 규칙을 불러오지도 않는다(요청조차 하지 않아 불필요한 작업이 없다).
      if (isHostPaused) return;
      if (isTemporarilyDisabled) return; // 콜백 사이 상태가 바뀌었을 수 있으므로 다시 확인한다.

      loadRulesForHost(hostname, (rules) => {
        ruleCountCache = CloakliCore.countRules(rules);

        // 콜백이 돌아오는 사이(비동기) 사용자가 "가림 모두 해제"를 눌렀거나 일시중지했을 수 있으므로 다시 확인한다.
        if (isTemporarilyDisabled || isHostPaused) return;
        if (ruleCountCache === 0) return;

        // scope(element/page/site) 판별은 content-core.js의 doesRuleApplyToCurrentPage
        // 하나로만 처리한다. MutationObserver/URL 변경/storage 동기화가 모두 이 applyStoredRules를
        // 거치므로, 별도로 scope 검사를 중복 구현하지 않는다.
        const applicableRules = rules.filter((rule) => CloakliCore.doesRuleApplyToCurrentPage(rule, location));

        // 규칙 적용 오케스트레이션(잘못된 selector가 있어도 나머지는 계속 처리)은
        // content-core.js의 applyRuleSet이 담당하고, 실제 DOM 접근만 어댑터로 넘긴다.
        CloakliCore.applyRuleSet(applicableRules, {
          queryElements: (selector) => document.querySelectorAll(selector),
          isSelectable: isSelectable,
          maskElement: maskElement, // 이미 가려진 요소는 내부에서 즉시 건너뛴다.
          // "이 요소만" 규칙은 selector가 유일하면 그 하나를, 아니면 fingerprint로 그 요소를
          // 다시 찾는다(가상화 목록/재렌더링/순서 변경 대응). page/site 범위에는 관여하지 않는다.
          resolveElementTarget: resolveElementScopeTarget,
        });
      });
    });
  }

  // ---------------------------------------------------------------------
  // 동적 사이트(SPA) 대응: MutationObserver + debounce
  // ---------------------------------------------------------------------

  // Cloakli 자신이 만든 요소를 판별하기 위한 class/id 목록. (판별 로직 자체는
  // content-core.js의 isCloakliOwnNodeDescriptor에 있어 DOM 없이도 테스트할 수 있다)
  const OWN_UI_CLASS_NAMES = [OVERLAY_CLASS, WRAPPER_CLASS, BANNER_CLASS, TOAST_CLASS, SCOPE_PICKER_CLASS, SHIELD_CLASS];
  const OWN_UI_IDS = [BANNER_ID, TOAST_ID, SCOPE_PICKER_ID, SHIELD_ID];

  // Cloakli 자신이 만든 요소인지 확인한다. (observer 콜백에서 자기 자신이 만든
  // 변경을 걸러내 재적용 스케줄링이 스스로를 계속 트리거하는 것을 막는다)
  function isCloakliOwnNode(node) {
    return CloakliCore.isCloakliOwnNodeDescriptor(node, OWN_UI_CLASS_NAMES, OWN_UI_IDS);
  }

  // 300ms debounce로 규칙 재적용을 예약한다. 짧은 시간에 여러 번 호출되어도
  // 마지막 호출 이후 한 번만 실행된다.
  const scheduleRuleApplication = CloakliCore.debounce(runScheduledApplication, 300);

  function runScheduledApplication() {
    if (selectionModeActive) {
      // 사용자가 새 영역을 선택하는 중에는 DOM을 건드리지 않고, 선택이 끝난 뒤
      // 다음 변경이 있을 때 다시 시도되도록 미룬다.
      return;
    }
    debugLog("re-applying stored rules after DOM change");
    try {
      applyStoredRules();
    } catch (err) {
      // observer로부터 이어진 오류가 확장 프로그램 전체를 중단시키지 않게 한다.
    }
  }

  function handleMutations(mutations) {
    try {
      if (isHostPaused) return; // 이 사이트가 일시중지 상태면 아무 작업도 하지 않는다.
      if (ruleCountCache === 0) return; // 저장된 규칙이 없으면 아무 작업도 하지 않는다.
      if (!CloakliCore.hasNonCloakliChange(mutations, isCloakliOwnNode)) return; // Cloakli 자신이 만든 변경은 무시한다.
      scheduleRuleApplication();
    } catch (err) {
      // observer 콜백 내부 오류가 확장 프로그램 전체를 중단시키지 않게 한다.
    }
  }

  // document.documentElement의 하위 트리(자식 추가/삭제)만 관찰한다.
  // attributes/characterData는 관찰하지 않아, hover 테두리 같은 class 토글에는 반응하지 않는다.
  function startDomObserver() {
    try {
      const observer = new MutationObserver(handleMutations);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (err) {
      // MutationObserver를 사용할 수 없어도 나머지 기능은 계속 동작해야 한다.
    }
  }

  // ---------------------------------------------------------------------
  // 동적 사이트(SPA) 대응: URL 변경 감지
  // ---------------------------------------------------------------------

  let lastKnownUrl = location.href;

  // SPA 렌더링이 끝날 시간을 고려해, URL 변경 후 300ms debounce 뒤에 규칙을 재적용한다.
  const scheduleUrlRuleApplication = CloakliCore.debounce(() => {
    try {
      applyStoredRules();
    } catch (err) {
      // URL 변경 후 재적용 중 오류가 발생해도 확장 프로그램은 계속 동작해야 한다.
    }
  }, 300);

  function handleUrlChange() {
    const newUrl = location.href;
    if (!CloakliCore.hasUrlChanged(lastKnownUrl, newUrl)) return;
    lastKnownUrl = newUrl;
    debugLog("url changed");

    // 새 URL로 이동했으므로, 이전 페이지에서의 "가림 모두 해제" 상태는 더 이상 유지하지 않는다.
    isTemporarilyDisabled = CloakliCore.nextTemporaryDisableState(
      isTemporarilyDisabled,
      CloakliCore.TEMP_DISABLE_EVENTS.URL_CHANGED
    );

    scheduleUrlRuleApplication();
  }

  // history.pushState/replaceState를 감싸 SPA의 URL 변경을 감지한다.
  // 원래 함수의 인자와 반환값은 그대로 전달하므로 사이트 자체 동작에는 영향이 없다.
  function patchHistoryForSpaDetection() {
    ["pushState", "replaceState"].forEach((methodName) => {
      const original = history[methodName];
      if (typeof original !== "function") return;
      history[methodName] = function (...args) {
        const result = original.apply(this, args);
        try {
          handleUrlChange();
        } catch (err) {
          // 감지 로직 오류가 사이트 자체의 history 동작을 막지 않게 한다.
        }
        return result;
      };
    });

    window.addEventListener("popstate", handleUrlChange);
    window.addEventListener("hashchange", handleUrlChange);
  }

  let toastTimeoutId = null;

  // Cloakli의 모든 안내 메시지가 거치는 단일 toast 함수. 저장 성공/중복/실패, 일반화 selector가
  // 너무 넓음, 사이트 일시중지/재시작, 현재 화면 임시 해제, 규칙 삭제 동기화 등에서 재사용한다.
  // type: "success" | "info" | "warning" | "error" (색상 구분용, 기본값 "info")
  // 하나의 DOM 요소를 계속 재사용하므로 toast가 동시에 여러 개 쌓이지 않고, 새 toast는
  // 이전 toast를 즉시 대체한다. 표시 몇 초 후 자동으로 사라진다.
  function showCloakliToast(text, type) {
    try {
      if (!document.body && !document.documentElement) return;
      const safeType = CloakliCore.normalizeToastType(type);

      let toast = document.getElementById(TOAST_ID);
      if (!toast) {
        toast = document.createElement("div");
        toast.id = TOAST_ID;
        document.documentElement.appendChild(toast);
      }
      toast.className = TOAST_CLASS + " " + TOAST_CLASS + "-" + safeType;
      toast.textContent = text;
      toast.setAttribute("role", "status");

      if (toastTimeoutId) clearTimeout(toastTimeoutId);
      toastTimeoutId = setTimeout(() => {
        const el = document.getElementById(TOAST_ID);
        if (el) el.remove();
        toastTimeoutId = null;
      }, 2600);
    } catch (err) {
      // 안내 메시지 표시 실패는 가림 기능 자체에 영향을 주지 않는다.
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      endSelectionMode();
    }
  }

  // ---------------------------------------------------------------------
  // 저장된 가림의 클릭 전달
  //
  // 오버레이는 pointer-events: auto다(원본 요소에 마우스가 절대 닿지 않게 하기 위함 -
  // pointer-events: none이면 hover/mouseover 같은 마우스 이벤트까지 원본 요소로 그대로
  // 전달되어, 그 사이트 자신의 hover 동작(예: 정지 이미지를 다른 미리보기로 바꾸는 것)이
  // 실제로 실행되어 오버레이 너머로 보일 수 있다. 그래서 오버레이가 모든 마우스 이벤트를
  // 흡수하고, 클릭만 아래 실제 링크로 이 코드가 직접 전달한다.
  // ---------------------------------------------------------------------

  // container 자신이 링크이거나, 그 안(자손) 또는 바깥(조상, 최대 5단계)에 실제 링크가
  // 있으면 그 요소를 찾는다. 카드 링크가 썸네일 밖(조상)에 있는 구조도 지원하기 위함이다.
  function findNavigableLink(container) {
    if (!container) return null;
    if (container.tagName === "A" && container.href) return container;
    const innerLink = container.querySelector && container.querySelector("a[href]");
    if (innerLink && innerLink.href) return innerLink;
    let ancestor = container.parentElement;
    let depth = 0;
    while (ancestor && depth < 5) {
      if (ancestor.tagName === "A" && ancestor.href) return ancestor;
      ancestor = ancestor.parentElement;
      depth++;
    }
    return null;
  }

  // 왼쪽 클릭: 일반 클릭은 같은 탭에서 이동, ctrl/cmd/shift+클릭은 새 탭으로 연다
  // (브라우저의 기본 링크 동작과 최대한 같게 동작시키기 위함).
  function forwardOverlayClick(container, e) {
    const link = findNavigableLink(container);
    if (!link) return;
    if (e.button !== 0) return; // 왼쪽 클릭만 여기서 처리한다(중간 클릭은 auxclick에서).
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      window.open(link.href, "_blank", "noopener");
    } else {
      window.location.href = link.href;
    }
  }

  // 중간 클릭(마우스 휠 클릭)으로 새 탭에서 여는 기존 링크 동작을 유지한다.
  function forwardOverlayAuxClick(container, e) {
    if (e.button !== 1) return;
    const link = findNavigableLink(container);
    if (!link) return;
    window.open(link.href, "_blank", "noopener");
  }

  // 요소를 가린다. 이미 가려진 요소는 다시 가리지 않는다. (새로 가렸으면 true를 반환)
  function maskElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.classList.contains(MASKED_CLASS)) return false;
    if (el.classList.contains(WRAPPER_CLASS)) return false;
    if (el.querySelector && el.querySelector(":scope > ." + OVERLAY_CLASS)) return false;

    let container = el;

    if (VOID_LIKE_TAGS.includes(el.tagName)) {
      // img, input 등은 자식 오버레이를 렌더링할 수 없으므로 래퍼로 감싼다.
      const computedDisplay = getComputedStyle(el).display;
      const wrapper = document.createElement("span");
      wrapper.className = WRAPPER_CLASS;
      wrapper.style.display = computedDisplay === "inline" ? "inline-block" : computedDisplay || "inline-block";
      el.parentNode.insertBefore(wrapper, el);
      wrapper.appendChild(el);
      container = wrapper;
    }

    container.classList.add(MASKED_CLASS);

    if (getComputedStyle(container).position === "static") {
      container.dataset.cloakliPositionPatched = "true";
      container.style.position = "relative";
    }

    const overlay = document.createElement("div");
    overlay.className = OVERLAY_CLASS;
    const label = document.createElement("span");
    label.textContent = "HIDDEN";
    overlay.appendChild(label);
    overlay.addEventListener("click", (e) => forwardOverlayClick(container, e));
    overlay.addEventListener("auxclick", (e) => forwardOverlayAuxClick(container, e));
    container.appendChild(overlay);

    return true;
  }

  // 저장된(persistent) 가림 하나를 제거한다. maskElement()가 특정 요소에 방금 새로 추가한
  // 가림을 되돌릴 때(예: 무료 한도 초과로 저장이 차단된 경우의 롤백) 사용한다. hover/mouseleave
  // 등 선택 미리보기 정리(clearSelectionPreview)와는 완전히 분리된 함수이며, 이 함수는
  // hover 이벤트 핸들러 어디에서도 호출되지 않는다 - 오직 저장 실패 롤백과
  // removeAllPersistentMasks()의 개별 처리 경로에서만 호출된다. 웹사이트 자체의
  // class/style/dataset은 변경하지 않고, Cloakli가 추가한 오버레이/class/dataset/래퍼만 제거한다.
  function removePersistentMask(el) {
    if (!el) return;
    try {
      const wrapper =
        el.parentNode && el.parentNode.classList && el.parentNode.classList.contains(WRAPPER_CLASS)
          ? el.parentNode
          : null;
      const container = wrapper || el;

      const overlay = container.querySelector && container.querySelector(":scope > ." + OVERLAY_CLASS);
      if (overlay) overlay.remove();

      container.classList.remove(MASKED_CLASS);
      if (container.dataset && container.dataset.cloakliPositionPatched) {
        container.style.position = "";
        delete container.dataset.cloakliPositionPatched;
      }

      if (wrapper) {
        // VOID_LIKE_TAGS(img/input 등)를 감쌌던 래퍼를 제거하고 원래 요소를 원래 자리로 되돌린다.
        const parent = wrapper.parentNode;
        if (parent) parent.insertBefore(el, wrapper);
        wrapper.remove();
      }
    } catch (err) {
      // 롤백 실패가 확장 프로그램을 중단시키지 않게 한다.
    }
  }

  // ---------------------------------------------------------------------
  // 화면 고정 선택 모드 (frozen selection)
  //
  // Gmail/YouTube처럼 마우스를 올리면 화면이 바뀌는(날짜가 버튼으로 교체되거나, 공용
  // 미리보기 오버레이가 썸네일 위에 나타나는) 사이트에서도, 선택 시작 시점에 보이던
  // 요소를 그대로 선택할 수 있게 한다.
  //  1) 투명 선택 레이어(shield)가 페이지 전체를 덮어 사이트가 hover 이벤트를 받지 못하게 한다.
  //  2) 선택 시작 시 화면에 보이는 요소들의 참조+좌표만 스냅샷으로 기록한다(텍스트/이미지 미저장).
  //  3) 클릭 좌표를 elementsFromPoint(가능한 환경) 또는 스냅샷으로 원래 요소로 되돌린다.
  //  4) 선택 종료/취소/오류 시 exitFrozenSelectionMode()가 레이어·스냅샷·리스너를 모두 정리해
  //     사이트의 hover/클릭/스크롤 동작이 원래대로 복원된다.
  // ---------------------------------------------------------------------

  // 선택 시작 시점의 {요소 참조, 좌표, 깊이}만 기록한다. textContent/innerHTML/이미지 등
  // 실제 내용은 절대 기록하지 않으며, 선택 종료 시 즉시 비운다(storage에도 저장하지 않는다).
  let selectionSnapshot = [];
  const SNAPSHOT_MAX_ENTRIES = 3000;

  // 디버그 추적용: 마지막 좌표 선택이 스냅샷을 썼는지/원래 요소가 아직 문서에 있는지.
  let lastSelectionResolution = null;

  function captureSelectableSnapshot() {
    const entries = [];
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    (function walk(node, depth) {
      if (!node || entries.length >= SNAPSHOT_MAX_ENTRIES) return;
      for (const child of node.children || []) {
        if (entries.length >= SNAPSHOT_MAX_ENTRIES) return;
        if (isCloakliOwnElement(child)) continue;
        let rect = null;
        try {
          rect = child.getBoundingClientRect();
        } catch (err) {
          rect = null;
        }
        if (
          rect &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left < viewportWidth &&
          rect.top < viewportHeight &&
          rect.left + rect.width > 0 &&
          rect.top + rect.height > 0
        ) {
          entries.push({ el: child, top: rect.top, left: rect.left, width: rect.width, height: rect.height, depth: depth });
        }
        walk(child, depth + 1);
      }
    })(document.body, 0);

    selectionSnapshot = entries;
  }

  // 좌표(x,y)에서 "선택 시작 시점에 보이던" 요소를 찾는다: 좌표를 포함하는 스냅샷 항목 중
  // 아직 문서에 붙어 있는 것들에서, 가장 작고(면적) 깊은(depth) 요소를 고른다.
  function findSnapshotTargetAtPoint(x, y) {
    let best = null;
    for (const entry of selectionSnapshot) {
      if (x < entry.left || x > entry.left + entry.width) continue;
      if (y < entry.top || y > entry.top + entry.height) continue;
      const el = entry.el;
      if (!el || el.isConnected === false) continue;
      if (!isSelectable(el)) continue;
      const area = entry.width * entry.height;
      if (!best || area < best.area || (area === best.area && entry.depth > best.depth)) {
        best = { el: el, area: area, depth: entry.depth };
      }
    }
    return best ? best.el : null;
  }

  // 좌표를 실제 선택 대상 요소로 되돌린다. 실제 브라우저에서는 elementsFromPoint가
  // 레이어 아래의 현재 요소를 정확히 주고(shield 덕분에 hover 변화가 없어 "선택 시작
  // 시점의 요소"와 같다), 그 결과가 쓸 수 없으면 스냅샷으로 대체한다.
  function resolveSelectionTargetAtPoint(x, y) {
    let fromPoint = null;
    if (typeof document.elementsFromPoint === "function") {
      try {
        const stack = document.elementsFromPoint(x, y) || [];
        for (const candidate of stack) {
          if (isCloakliOwnElement(candidate)) continue;
          if (candidate === document.documentElement || candidate === document.body) break;
          fromPoint = candidate;
          break;
        }
      } catch (err) {
        fromPoint = null;
      }
    }
    const fromSnapshot = findSnapshotTargetAtPoint(x, y);
    const resolved = fromPoint && isSelectable(fromPoint) ? fromPoint : fromSnapshot;
    lastSelectionResolution = {
      usedSnapshot: !fromPoint && !!fromSnapshot,
      snapshotAgrees: !fromPoint || fromPoint === fromSnapshot,
      stillConnected: !!(resolved && resolved.isConnected !== false),
    };
    return resolved;
  }

  function showSelectionShield() {
    removeSelectionShield();
    const shield = document.createElement("div");
    shield.className = SHIELD_CLASS;
    shield.id = SHIELD_ID;
    document.documentElement.appendChild(shield);
  }

  function removeSelectionShield() {
    const existing = document.getElementById(SHIELD_ID);
    if (existing) existing.remove();
  }

  // 스크롤은 막지 않는다(투명 레이어는 스크롤 가능한 요소가 아니라 휠이 문서 기본
  // 스크롤로 이어진다). 스크롤로 화면이 바뀌면 스냅샷 좌표가 어긋나므로 debounce로 다시 찍는다.
  const recaptureSnapshotAfterScroll = CloakliCore.debounce(() => {
    if (!selectionModeActive) return;
    try {
      captureSelectableSnapshot();
    } catch (err) {
      // 스냅샷 재캡처 실패가 선택 모드 자체를 중단시키지 않게 한다.
    }
  }, 150);

  function onSelectionScroll() {
    if (selectionModeActive) recaptureSnapshotAfterScroll();
  }

  // 화면 고정 선택 모드의 모든 임시 상태(투명 레이어/스냅샷/스크롤 리스너)를 정리한다.
  // endSelectionMode가 어떤 경로로 끝나든(정상 완료/ESC 취소/오류) 반드시 호출된다.
  function exitFrozenSelectionMode() {
    removeSelectionShield();
    selectionSnapshot = [];
    lastSelectionResolution = null;
    window.removeEventListener("scroll", onSelectionScroll, true);
  }

  function startSelectionMode() {
    if (selectionModeActive) return;
    closeScopePicker(); // 범위 선택 UI가 열려 있는 상태에서 다시 시작하면 먼저 정리한다.
    selectionModeActive = true;
    try {
      document.addEventListener("mouseover", onMouseOver, true);
      document.addEventListener("mousemove", onSelectionMouseMove, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("scroll", onSelectionScroll, true);
      document.body.classList.add("cloakli-selecting");
      captureSelectableSnapshot();
      showSelectionShield();
      showBanner();
    } catch (err) {
      // 준비 중 오류가 나도 페이지에 임시 레이어/리스너가 남지 않게 정리한다.
      endSelectionMode();
    }
  }

  function endSelectionMode() {
    selectionModeActive = false;
    try {
      document.removeEventListener("mouseover", onMouseOver, true);
      document.removeEventListener("mousemove", onSelectionMouseMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      if (document.body) document.body.classList.remove("cloakli-selecting");
      clearSelectionPreview(); // hover outline만 정리한다 - 저장된 가림에는 영향 없음
      removeBanner();
    } finally {
      exitFrozenSelectionMode();
    }
  }

  const SELECTION_BANNER_TEXT = "화면이 고정되었습니다.\n가릴 영역을 클릭하세요\nESC를 누르면 취소됩니다.";

  function showBanner() {
    removeBanner();
    const banner = document.createElement("div");
    banner.className = BANNER_CLASS;
    banner.id = BANNER_ID;
    banner.textContent = SELECTION_BANNER_TEXT;
    document.documentElement.appendChild(banner);
  }

  function flashBannerMessage(text) {
    const existing = document.getElementById(BANNER_ID);
    if (existing) existing.textContent = text;
    setTimeout(() => {
      const el = document.getElementById(BANNER_ID);
      if (el && selectionModeActive) {
        el.textContent = SELECTION_BANNER_TEXT;
      }
    }, 2000);
  }

  function removeBanner() {
    const existing = document.getElementById(BANNER_ID);
    if (existing) existing.remove();
  }

  // ---------------------------------------------------------------------
  // 가림 적용 범위 선택 UI ("이 요소만" / "현재 페이지의 같은 종류 모두" / "이 사이트의 같은 종류 모두")
  // ---------------------------------------------------------------------

  // 현재 열려 있는 범위 선택 UI 상태. 한 번에 하나만 존재한다(openScopePicker가 항상 먼저 닫고 새로 연다).
  let scopePickerState = null;

  function computeAreaRatio(elements) {
    try {
      const viewportArea = window.innerWidth * window.innerHeight;
      if (viewportArea <= 0) return 0;
      let sum = 0;
      elements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        sum += rect.width * rect.height;
      });
      return sum / viewportArea;
    } catch (err) {
      return 0;
    }
  }

  function clearPreviewOutlines() {
    if (!scopePickerState || !scopePickerState.previewEls) return;
    scopePickerState.previewEls.forEach((el) => el.classList.remove(PREVIEW_OUTLINE_CLASS));
    scopePickerState.previewEls = [];
  }

  function onScopePickerKeyDown(e) {
    if (e.key === "Escape") {
      closeScopePicker();
    }
  }

  // 범위 선택 UI를 닫는다. (취소 버튼, ESC, 선택 확정 후 모두 이 함수를 거친다)
  function closeScopePicker() {
    if (!scopePickerState) return;
    clearSelectionPreview(); // 미리보기(outline)는 임시 표시일 뿐이므로 어떤 경로로 닫히든 반드시 제거한다.
    // 저장된 가림(removePersistentMask/removeAllPersistentMasks)은 이 함수가 절대 호출하지 않는다.
    const root = document.getElementById(SCOPE_PICKER_ID);
    if (root) root.remove();
    document.removeEventListener("keydown", onScopePickerKeyDown, true);
    scopePickerState = null;
  }

  function describeGeneralSafetyFailure(safety) {
    if (!safety || safety.ok) return "";
    const reasons = {
      "selector-missing": "안정적인 가림 규칙을 만들지 못했습니다.",
      "selector-too-long": "선택 범위를 특정하기에 구조가 너무 복잡합니다.",
      "selector-too-generic": "선택 범위가 너무 넓어 저장하지 않았습니다.",
      "no-matches": "일치하는 요소를 찾지 못했습니다.",
      "too-many-matches": "선택 범위가 너무 넓어 저장하지 않았습니다.",
      "original-not-included": "선택한 요소가 결과에 포함되지 않아 사용할 수 없습니다.",
      "covers-too-much-area": "선택 범위가 화면의 너무 많은 부분을 차지해 저장하지 않았습니다.",
      "selector-invalid": "선택 범위를 계산하지 못했습니다.",
      "mixed-role": "서로 다른 종류의 요소가 섞여 있어 이 범위는 사용할 수 없습니다.",
    };
    return reasons[safety.reason] || "이 범위는 사용할 수 없습니다.";
  }

  function buildScopeButton(opts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cloakli-scope-picker-option";

    const strong = document.createElement("strong");
    strong.textContent = opts.label;
    btn.appendChild(strong);

    // 무료판에서 page/site 범위는 버튼을 숨기지 않고 "PRO" 배지로 잠금 상태만 표시한다.
    if (opts.badgeText) {
      const badge = document.createElement("span");
      badge.className = "cloakli-scope-picker-pro-badge";
      badge.textContent = opts.badgeText;
      btn.appendChild(badge);
    }

    const desc = document.createElement("span");
    desc.className = "cloakli-scope-picker-desc";
    desc.textContent = opts.enabled ? opts.description : opts.disabledReason;
    btn.appendChild(desc);

    btn.setAttribute(
      "aria-label",
      opts.label + (opts.badgeText ? ". " + opts.badgeText + " 기능" : "") + ". " + (opts.enabled ? opts.description : opts.disabledReason)
    );

    if (opts.enabled) {
      btn.addEventListener("click", opts.onSelect);
    } else {
      btn.disabled = true;
    }
    return btn;
  }

  function renderScopePicker() {
    const state = scopePickerState;

    const root = document.createElement("div");
    root.id = SCOPE_PICKER_ID;
    root.className = SCOPE_PICKER_CLASS;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Cloakli 가림 범위 선택");

    const title = document.createElement("p");
    title.className = "cloakli-scope-picker-title";
    title.textContent = "가림 범위를 선택하세요.";
    root.appendChild(title);

    // 인식된 대상(썸네일/제목/채널명/날짜·시간 등)을 사용자에게 보여준다.
    // 개발 용어나 selector는 노출하지 않는다.
    const targetLine = document.createElement("p");
    targetLine.className = "cloakli-scope-picker-target";
    targetLine.textContent = "선택한 대상: " + state.targetLabel;
    root.appendChild(targetLine);

    const generalAvailable = !!state.generalSelector && state.generalSafety.ok;
    const countSuffix = generalAvailable ? " (" + state.generalCount + "개)" : "";

    root.appendChild(
      buildScopeButton({
        label: "이 요소만",
        description: "현재 선택한 요소 하나만 가립니다.\n페이지 구조가 바뀌면 다시 적용되지 않을 수 있습니다.",
        enabled: !!state.specificSelector,
        disabledReason: "안정적인 가림 규칙을 만들지 못했습니다.\n다른 요소를 선택해 주세요.",
        onSelect: () => confirmScope("element"),
      })
    );

    root.appendChild(
      buildScopeButton({
        label: "현재 페이지 유형의 같은 요소" + countSuffix,
        description: "현재 페이지의 같은 역할과 같은 구조만 가립니다.",
        enabled: generalAvailable,
        disabledReason: describeGeneralSafetyFailure(state.generalSafety),
        badgeText: state.isPro ? null : "PRO",
        onSelect: () => confirmScope("page"),
      })
    );

    root.appendChild(
      buildScopeButton({
        label: "이 사이트의 같은 요소" + countSuffix,
        description: "이 사이트의 같은 역할과 같은 구조만 가립니다.",
        enabled: generalAvailable,
        disabledReason: describeGeneralSafetyFailure(state.generalSafety),
        badgeText: state.isPro ? null : "PRO",
        onSelect: () => confirmScope("site"),
      })
    );

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "cloakli-scope-picker-cancel";
    cancelBtn.textContent = "취소";
    cancelBtn.setAttribute("aria-label", "가림 범위 선택 취소");
    cancelBtn.addEventListener("click", () => closeScopePicker());
    root.appendChild(cancelBtn);

    document.documentElement.appendChild(root);

    const firstEnabledBtn = root.querySelector("button:not([disabled])");
    if (firstEnabledBtn) firstEnabledBtn.focus();
  }

  // 요소를 클릭한 직후 호출된다. 즉시 저장하지 않고, 역할(role)/종류(family) 분류와
  // 시각적 가림 대상(visual mask target) 결정, 구체적/일반화 selector 계산을 마친 뒤
  // 범위 선택 UI에 표시하고 사용자의 선택을 기다린다.
  function openScopePicker(el) {
    closeScopePicker(); // 이미 열려 있던 picker가 있다면(중복 생성 방지) 먼저 정리한다.

    const role = classifySelectableRole(el);
    const familyInfo = classifyContentFamily(el);
    // 링크인데 이미지 자손이 없는 경우 등 strict 대상이 없으면(null), element 범위는
    // 클릭한 요소 자체를 쓰고 일반화 범위는 사용할 수 없게 한다.
    const strictTarget = resolveVisualMaskTarget(el, role);
    const visualTarget = strictTarget || el;

    // "이 요소만"과 "같은 종류" 범위의 사용 가능 여부는 서로 완전히 독립적으로 계산한다.
    // 한쪽 selector 생성이 실패해도 다른 쪽 버튼의 활성화에는 영향을 주지 않는다.
    const specificSelector = buildElementScopeSelector(visualTarget);
    const generalSelector = strictTarget ? generateGeneralizedSelector(strictTarget) : null;

    // Pro 여부는 CloakliEntitlement 하나로만 판단하고, 이 값을 picker 상태에 저장해
    // 배지 표시(renderScopePicker)와 저장 시점 검사(confirmScope)가 같은 값을 공유하게 한다.
    const isPro = CloakliEntitlement.isProUser(CloakliEntitlement.getEntitlementState());

    let generalCount = 0;
    let generalSafety = { ok: false, reason: "selector-missing" };
    let matchedEls = [];

    if (generalSelector) {
      try {
        matchedEls = Array.from(document.querySelectorAll(generalSelector)).filter(isSelectable);
        generalCount = matchedEls.length;
        const included = matchedEls.indexOf(visualTarget) !== -1;
        const areaRatio = computeAreaRatio(matchedEls);
        generalSafety = CloakliCore.evaluateGeneralizedSelectorSafety(generalSelector, generalCount, {
          originalElementIncluded: included,
          areaRatio: areaRatio,
        });
        // 같은 종류 범위는 role까지 같아야 한다: 일치한 요소 중 하나라도 다른 역할이면
        // (예: 썸네일 selector가 제목까지 잡는 경우) 저장을 차단한다.
        if (generalSafety.ok) {
          const targetRole = classifySelectableRole(visualTarget);
          const hasMixedRole = matchedEls.some((m) => classifySelectableRole(m) !== targetRole);
          if (hasMixedRole) {
            generalSafety = { ok: false, reason: "mixed-role" };
          }
        }
      } catch (err) {
        generalSafety = { ok: false, reason: "selector-invalid" };
      }
    }

    scopePickerState = {
      targetEl: el,
      visualTarget: visualTarget,
      role: role,
      family: familyInfo.family,
      targetLabel: describeSelectionTargetLabel(role, familyInfo.family),
      specificSelector: specificSelector,
      generalSelector: generalSelector,
      generalCount: generalCount,
      generalSafety: generalSafety,
      previewEls: [],
      isPro: isPro,
    };

    // 개발 빌드 전용 선택 추적. selector 문자열/태그명/개수/분류 결과만 남기고,
    // 실제 텍스트·제목·이메일·URL query·innerHTML은 절대 출력하지 않는다.
    // (CLOAKLI_DEBUG는 build-config.js의 debug 값이며 production 빌드에서는 항상 false)
    if (CLOAKLI_DEBUG) {
      debugLog("selection-trace", {
        clickedTag: el.tagName,
        visualTargetTag: visualTarget.tagName,
        role: role,
        family: familyInfo.family,
        elementSelector: specificSelector,
        elementSelectorMatches: specificSelector ? countSelectorMatches(specificSelector) : 0,
        generalizedSelector: generalSelector,
        generalizedMatches: generalCount,
        generalSafetyReason: generalSafety.ok ? null : generalSafety.reason,
        resolution: lastSelectionResolution,
      });
    }

    // 미리보기 outline: 실제로 안전 검사를 통과했을 때만, 최대 PREVIEW_OUTLINE_MAX개까지만 표시한다.
    if (generalSelector && generalSafety.ok) {
      const toOutline = matchedEls.slice(0, PREVIEW_OUTLINE_MAX);
      toOutline.forEach((m) => m.classList.add(PREVIEW_OUTLINE_CLASS));
      scopePickerState.previewEls = toOutline;
    }

    renderScopePicker();
    document.addEventListener("keydown", onScopePickerKeyDown, true);
  }

  function countSelectorMatches(selector) {
    try {
      return document.querySelectorAll(selector).length;
    } catch (err) {
      return -1;
    }
  }

  // 사용자가 범위(scope)를 확정했을 때 실제로 가리고 저장한다.
  function confirmScope(scope) {
    const state = scopePickerState;
    if (!state) return;

    // 무료판에서는 page/site 범위를 저장하지 않는다. picker는 닫지 않고 그대로 열어 두어,
    // 사용자가 바로 "이 요소만"으로 다시 선택할 수 있게 한다(범위 선택 UI로 돌아가는 것과 동일).
    if (scope !== "element" && !state.isPro) {
      showCloakliToast(describeFreeLimitReason("scope-not-allowed"), "warning");
      return;
    }

    if (scope === "element") {
      closeScopePicker();
      // 클릭한 wrapper/링크가 아니라, 역할에 맞게 결정된 시각적 가림 대상만 가린다
      // (예: 제목 텍스트 요소, 카드 안의 이미지). 규칙에는 role/family와 fingerprint도 함께
      // 저장한다. fingerprint는 새로고침/재렌더링/순서 변경 후에도 이 요소를 다시 찾는 데 쓴다
      // (fingerprint는 maskElement가 요소를 래퍼로 감싸기 전에 만들어야 정확하다).
      const fingerprint = buildElementFingerprint(state.visualTarget);
      const applied = maskElement(state.visualTarget);
      if (applied) {
        // 이번 클릭으로 방금 새로 가린 요소만 기록해 둔다. 저장이 무료 한도로 차단되거나
        // 실패하면 이 요소만 되돌리고, 기존에 이미 가려져 있던 다른 요소는 건드리지 않는다.
        persistRuleWithScope(
          {
            scope: "element",
            selector: state.specificSelector,
            pagePattern: null,
            role: state.role,
            family: state.family,
            fingerprint: fingerprint,
          },
          "이 요소의 가림이 저장되었습니다.",
          [state.visualTarget]
        );
      }
      return;
    }

    const selector = state.generalSelector;
    if (!selector || !state.generalSafety.ok) {
      closeScopePicker();
      showCloakliToast("선택 범위가 너무 넓어 저장하지 않았습니다.\n더 구체적인 요소를 선택해 주세요.", "warning");
      return;
    }

    const newlyMasked = [];
    const matches = document.querySelectorAll(selector);
    matches.forEach((m) => {
      if (!isSelectable(m)) return;
      if (maskElement(m)) newlyMasked.push(m);
    });

    const generalCount = state.generalCount;
    closeScopePicker();

    const pagePattern = scope === "page" ? CloakliCore.normalizePagePattern(location.href) : null;
    const successText =
      scope === "page"
        ? "현재 페이지 유형에 같은 요소 " + generalCount + "개가 저장되었습니다."
        : "이 사이트의 같은 종류 요소 가림이 저장되었습니다.";

    persistRuleWithScope(
      { scope: scope, selector: selector, pagePattern: pagePattern, role: state.role, family: state.family },
      successText,
      newlyMasked
    );
  }

  // 저장된(persistent) 가림을 전부 제거한다. 웹사이트 자체 클래스/스타일은 건드리지 않고,
  // Cloakli가 추가한 요소만 제거한다. clearAllMasks()(사용자의 "가림 모두 해제")와 storage
  // 변경 동기화 양쪽에서 재사용하며, hover/mouseleave 등 선택 미리보기 정리(clearSelectionPreview)
  // 경로에서는 절대 호출되지 않는다.
  function removeAllPersistentMasks() {
    document.querySelectorAll("." + OVERLAY_CLASS).forEach((overlay) => overlay.remove());

    document.querySelectorAll("." + MASKED_CLASS).forEach((el) => {
      el.classList.remove(MASKED_CLASS);
      if (el.dataset.cloakliPositionPatched) {
        el.style.position = "";
        delete el.dataset.cloakliPositionPatched;
      }
    });

    // 래퍼로 감쌌던 요소는 원래 자리로 되돌리고 래퍼를 제거한다.
    document.querySelectorAll("." + WRAPPER_CLASS).forEach((wrapper) => {
      const child = wrapper.firstElementChild;
      if (child) {
        wrapper.parentNode.insertBefore(child, wrapper);
      }
      wrapper.remove();
    });
  }

  // 페이지에 있는 모든 Cloakli 가림을 제거한다. ("현재 화면 가림만 잠시 해제" 버튼/단축키)
  function clearAllMasks() {
    endSelectionMode();
    closeScopePicker(); // 열려 있던 범위 선택 UI가 있다면 함께 정리한다.

    // 이번 페이지(탭)에서는 observer/URL 변경 감지가 방금 해제한 화면을
    // 즉시 다시 가리지 않도록 한다. 새 URL로 이동하면 자동으로 풀린다.
    isTemporarilyDisabled = CloakliCore.nextTemporaryDisableState(
      isTemporarilyDisabled,
      CloakliCore.TEMP_DISABLE_EVENTS.CLEAR_CLICKED
    );

    removeAllPersistentMasks();
    showCloakliToast(
      "현재 화면의 가림을 잠시 해제했습니다.\n새로고침하거나 페이지를 이동하면 다시 적용됩니다.",
      "info"
    );
  }

  // ---------------------------------------------------------------------
  // options/popup에서의 변경을 현재 페이지에 즉시 반영 (storage.onChanged)
  // ---------------------------------------------------------------------

  // 같은 hostname의 규칙 배열이 실제로 달라졌는지 간단히 비교한다.
  function rulesListsEqual(a, b) {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (err) {
      return false;
    }
  }

  // 저장 규칙(cloakliRules) 변경 처리: 규칙 삭제/추가 등으로 현재 화면을 다시 동기화한다.
  function handleRulesStorageChanged(change) {
    const hostname = getHostname();
    if (!hostname) return;

    const newAll = change.newValue || {};
    const oldAll = change.oldValue || {};
    const newList = Array.isArray(newAll[hostname]) ? newAll[hostname] : [];
    const oldList = Array.isArray(oldAll[hostname]) ? oldAll[hostname] : [];

    // 다른 사이트의 규칙만 바뀐 경우 이 페이지에서는 아무 것도 하지 않는다.
    if (rulesListsEqual(newList, oldList)) return;

    debugLog("stored rules changed for this host, resyncing current page");

    // 1) 현재 화면의 Cloakli 가림을 모두 제거하고,
    // 2) 남아 있는(=삭제되지 않은) 저장 규칙만 다시 적용한다.
    // maskElement가 이미 가려진 요소는 건너뛰므로 중복 레이어는 생기지 않는다.
    removeAllPersistentMasks();
    ruleCountCache = newList.length;
    applyStoredRules();

    if (newList.length < oldList.length) {
      showCloakliToast("저장 규칙이 삭제되어 화면을 다시 확인했습니다.", "info");
    }
  }

  // 사이트 일시중지 상태(cloakliPausedHostnames) 변경 처리: 일시중지되면 가림을 제거하고,
  // 다시 시작하면 즉시 재적용한다. 다른 사이트의 일시중지 변경에는 반응하지 않는다.
  function handlePausedStorageChanged(change) {
    const hostname = getHostname();
    if (!hostname) return;

    const newMap = change.newValue || {};
    const oldMap = change.oldValue || {};
    const newPaused = CloakliCore.isHostnamePaused(newMap, hostname);
    const oldPaused = CloakliCore.isHostnamePaused(oldMap, hostname);
    if (newPaused === oldPaused) return; // 다른 사이트만 바뀌었거나 실제 변화 없음

    isHostPaused = newPaused;

    if (newPaused) {
      removeAllPersistentMasks();
      showCloakliToast("이 사이트의 가림이 일시중지되었습니다.", "info");
    } else {
      showCloakliToast("이 사이트의 가림을 다시 시작합니다.", "info");
      applyStoredRules();
    }
  }

  // 라이선스 서버 entitlement 캐시(cloakliLicenseCache)가 popup/background에서
  // 갱신되면, 이 탭의 entitlement.js 인메모리 캐시도 즉시 새로고침한다. 다시 storage를
  // 읽지 않고 change.newValue를 그대로 반영한다 - isHostPaused 캐싱과 같은 패턴이다.
  function handleLicenseCacheChanged(change) {
    CloakliEntitlement.setLicenseEntitlement(change.newValue || null);
  }

  function handleStorageChanged(changes, areaName) {
    try {
      if (areaName !== "local") return; // Cloakli와 무관한 영역(sync 등) 변경은 무시한다.
      if (!changes) return;

      if (changes[STORAGE_KEY]) {
        handleRulesStorageChanged(changes[STORAGE_KEY]);
      }
      if (changes[PAUSED_STORAGE_KEY]) {
        handlePausedStorageChanged(changes[PAUSED_STORAGE_KEY]);
      }
      if (changes[CloakliLicenseClient.LICENSE_CACHE_KEY]) {
        handleLicenseCacheChanged(changes[CloakliLicenseClient.LICENSE_CACHE_KEY]);
      }
    } catch (err) {
      // 리스너 내부 오류가 확장 프로그램 전체를 중단시키지 않게 한다.
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (!message || !message.type) {
        sendResponse({ ok: false });
        return true;
      }
      if (message.type === "START_SELECTION_MODE") {
        startSelectionMode();
        sendResponse({ ok: true });
      } else if (message.type === "CLEAR_ALL_MASKS") {
        clearAllMasks();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
    return true;
  });

  // 이 탭(content script)의 entitlement 판정이 처음부터 라이선스 상태를 알 수 있도록,
  // chrome.storage에 이미 저장돼 있는 캐시를 entitlement.js의 인메모리 캐시로 옮겨 둔다.
  // 실패해도(예: 아직 활성화한 적 없음) 항상 안전하게 free로 판정되므로 별도 처리가 필요 없다.
  CloakliLicenseClient.primeLicenseEntitlementCache();

  // 페이지 로딩 시 저장된 규칙 자동 적용 (body가 아직 없으면 준비될 때까지 기다린다)
  if (document.body) {
    applyStoredRules();
  } else {
    document.addEventListener("DOMContentLoaded", applyStoredRules, { once: true });
  }

  // 동적 사이트 대응: 늦게 나타나는 요소(MutationObserver)와
  // 새로고침 없는 SPA 내부 이동(history API/popstate/hashchange)을 감지한다.
  startDomObserver();
  patchHistoryForSpaDetection();

  // options 페이지에서 규칙을 삭제하면 이미 열려 있는 이 페이지에도 즉시 반영한다.
  // 스크립트 전체가 window.__cloakliContentLoaded로 한 번만 실행되므로 리스너도 한 번만 등록된다.
  chrome.storage.onChanged.addListener(handleStorageChanged);
})();
