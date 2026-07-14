// 팝업 UI 로직. 탭을 찾고 content script를 주입하고 메시지를 보내는 부분은
// tab-actions.js(TabActions)를 그대로 사용해, background.js의 키보드 단축키 처리와
// 같은 로직을 공유한다(중복 구현하지 않는다).

// content.js/options.js와 반드시 동일한 문자열을 사용해야 같은 데이터를 읽고 쓴다.
const STORAGE_KEY = "cloakliRules";
const PAUSED_STORAGE_KEY = "cloakliPausedHostnames";
const ONBOARDING_STORAGE_KEY = "cloakliOnboardingCompleted";

// ---------------------------------------------------------------------
// 다국어(i18n): 사용자에게 보이는 문구는 _locales/<언어>/messages.json에서 가져온다.
// chrome.i18n을 쓸 수 없는 환경(자동 테스트)에서는 두 번째 인자(한국어 원문)를 그대로
// 사용한다. $1, $2 자리표시자는 substitutions 배열 값으로 치환된다.
// selector/storage key/내부 error code/message action 이름은 절대 번역하지 않는다.
// ---------------------------------------------------------------------
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

// popup.html의 정적 문구(data-i18n / data-i18n-aria)를 현재 브라우저 언어로 바꾼다.
// chrome.i18n이 없으면(테스트) HTML에 있는 한국어 원문이 그대로 남는다.
function localizeDocument() {
  try {
    if (!(typeof chrome !== "undefined" && chrome.i18n && chrome.i18n.getMessage)) return;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const m = chrome.i18n.getMessage(el.getAttribute("data-i18n"));
      if (m) el.textContent = m;
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const m = chrome.i18n.getMessage(el.getAttribute("data-i18n-aria"));
      if (m) el.setAttribute("aria-label", m);
    });
  } catch (err) {
    // 문구 교체 실패가 팝업 자체를 멈추게 하지 않는다.
  }
}
localizeDocument();

const onboardingEl = document.getElementById("cloakli-onboarding");
const mainEl = document.getElementById("cloakli-main");
const onboardingStartBtn = document.getElementById("cloakli-onboarding-start-btn");
const helpBtn = document.getElementById("cloakli-help-btn");

const devBadgeEl = document.getElementById("cloakli-dev-badge");
const planBadgeEl = document.getElementById("cloakli-plan-badge");
const proInfoBtn = document.getElementById("cloakli-pro-info-btn");
const proInfoSection = document.getElementById("cloakli-pro-info");
const proInfoCloseBtn = document.getElementById("cloakli-pro-info-close-btn");
const proInfoCtaEl = document.getElementById("cloakli-pro-info-cta");

const licenseFreeActionsEl = document.getElementById("cloakli-license-free-actions");
const buyProBtn = document.getElementById("cloakli-buy-pro-btn");
const showLicenseInputBtn = document.getElementById("cloakli-show-license-input-btn");
const licenseInputAreaEl = document.getElementById("cloakli-license-input-area");
const licenseKeyInput = document.getElementById("cloakli-license-key-input");
const toggleLicenseVisibilityBtn = document.getElementById("cloakli-toggle-license-visibility-btn");
const activateLicenseBtn = document.getElementById("cloakli-activate-license-btn");
const licenseMessageEl = document.getElementById("cloakli-license-message");
const licenseActiveInfoEl = document.getElementById("cloakli-license-active-info");
const licenseStatusTextEl = document.getElementById("cloakli-license-status-text");
const licenseLastCheckedEl = document.getElementById("cloakli-license-last-checked");
const licenseMaskedKeyEl = document.getElementById("cloakli-license-masked-key");
const recheckLicenseBtn = document.getElementById("cloakli-recheck-license-btn");
const deactivateLicenseBtn = document.getElementById("cloakli-deactivate-license-btn");

// DEV BUILD 표시는 build-config.js(CloakliBuildConfig.mode) 값 하나로만 판정하며,
// chrome.storage 값으로는 켤 수 없다. production 빌드에서는 scripts/build.js가 이
// 배지 마크업 자체를 popup.html에서 제거하므로 devBadgeEl이 애초에 null일 수 있다.
function renderDevBadge() {
  if (!devBadgeEl) return;
  const isDevBuild = typeof CloakliBuildConfig !== "undefined" && CloakliBuildConfig && CloakliBuildConfig.mode === "development";
  if (!isDevBuild) {
    devBadgeEl.remove(); // 혹시 마크업이 남아 있어도 DOM에서 완전히 제거한다.
    return;
  }
  devBadgeEl.hidden = false;
}

const statusHostnameEl = document.getElementById("cloakli-status-hostname");
const statusCountEl = document.getElementById("cloakli-status-count");
const statusStateEl = document.getElementById("cloakli-status-state");
const statusMessageEl = document.getElementById("cloakli-status");

const selectBtn = document.getElementById("cloakli-select-btn");
const pauseBtn = document.getElementById("cloakli-pause-btn");
const clearBtn = document.getElementById("cloakli-clear-btn");
const manageBtn = document.getElementById("cloakli-manage-btn");

// 현재 팝업이 보고 있는 탭의 정보. refreshStatus()가 채우고 버튼 핸들러들이 재사용한다.
let currentTab = null;
let currentHostname = null;
let currentSupported = false;
let currentPaused = false;

function setStatusMessage(text) {
  statusMessageEl.textContent = text || "";
}

// 버튼을 눌렀을 때 처리가 끝나기 전까지 다시 누르지 못하게 막는다.
// 오류가 나도 finally에서 항상 버튼을 되살리므로 영구적으로 비활성화되지 않는다.
async function withButtonGuard(button, fn) {
  if (button.disabled) return; // 이미 처리 중이면 중복 실행하지 않는다.
  button.disabled = true;
  try {
    await fn();
  } finally {
    button.disabled = false;
  }
}

function showOnboarding() {
  onboardingEl.hidden = false;
  mainEl.hidden = true;
}

function showMain() {
  onboardingEl.hidden = true;
  mainEl.hidden = false;
}

// 처음 설치했거나 아직 '시작하기'를 누르지 않았으면 온보딩을 보여준다.
// 저장값이 없거나 손상되어 있어도(예: 문자열이 아님) 항상 "아직 완료하지 않음"으로 안전하게 처리한다.
function checkOnboarding() {
  try {
    chrome.storage.local.get([ONBOARDING_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        showMain();
        return;
      }
      const completed = result && result[ONBOARDING_STORAGE_KEY] === true;
      if (completed) {
        showMain();
      } else {
        showOnboarding();
      }
    });
  } catch (err) {
    showMain();
  }
}

function completeOnboarding() {
  try {
    chrome.storage.local.set({ [ONBOARDING_STORAGE_KEY]: true }, () => {
      showMain();
    });
  } catch (err) {
    showMain();
  }
}

onboardingStartBtn.addEventListener("click", completeOnboarding);
helpBtn.addEventListener("click", showOnboarding);

proInfoBtn.addEventListener("click", () => {
  proInfoSection.hidden = false;
  renderProInfoCta();
});
proInfoCloseBtn.addEventListener("click", () => {
  proInfoSection.hidden = true;
});

// https:// 로 시작하는 URL만 허용한다. javascript: 등 스킴이나 빈 값/설정 전 placeholder는 거부한다.
function isSafeCheckoutUrl(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch (err) {
    return false;
  }
}

function getCheckoutUrl() {
  return typeof CloakliBuildConfig !== "undefined" && CloakliBuildConfig ? CloakliBuildConfig.checkoutUrl : "";
}

// 결제 URL은 build-config.js(CloakliBuildConfig.checkoutUrl) 한 곳에서만 읽는다.
// "Pro 알아보기" 패널과 라이선스 섹션의 "Pro 구매하기" 버튼이 이 함수 하나를 공유한다.
function openCheckoutUrl() {
  const url = getCheckoutUrl();
  if (!isSafeCheckoutUrl(url)) {
    setLicenseMessage(msg("checkoutNotReady", "Pro 결제 기능은 아직 준비되지 않았습니다."));
    return;
  }
  chrome.tabs.create({ url });
}

// "Pro 알아보기" 패널 안의 CTA. 결제 URL이 아직 설정되지 않았으면 구매 버튼 대신
// 안내 문구만 보여줘 빈 탭이 열리는 것을 막는다.
function renderProInfoCta() {
  if (!proInfoCtaEl) return;
  proInfoCtaEl.textContent = "";
  const url = getCheckoutUrl();
  if (isSafeCheckoutUrl(url)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cloakli-btn cloakli-btn-primary";
    btn.textContent = msg("buyProBtn", "Pro 구매하기");
    btn.addEventListener("click", () => chrome.tabs.create({ url }));
    proInfoCtaEl.appendChild(btn);
  } else {
    const note = document.createElement("p");
    note.className = "cloakli-pro-info-note";
    note.textContent = msg("checkoutNotReady", "Pro 결제 기능은 아직 준비되지 않았습니다.");
    proInfoCtaEl.appendChild(note);
  }
}

function setLicenseMessage(text) {
  licenseMessageEl.textContent = text || "";
}

// license-client.js가 돌려주는 오류 코드를 사용자에게 보여줄 문구로 바꾼다. 서버/네트워크
// 내부 사정을 그대로 노출하지 않고, 알려진 코드만 사용자 언어의 문구로 변환한다.
// (서버의 error code 자체는 번역 대상이 아니다 — 표시 문구만 i18n 키로 매핑한다)
function describeLicenseError(code) {
  const map = {
    missing_license_key: msg("licenseErrMissingKey", "라이선스 키를 입력해 주세요."),
    server_url_not_configured: msg("licenseErrServerNotConfigured", "라이선스 서버 주소가 아직 설정되지 않았습니다."),
    network_error: msg("licenseErrNetwork", "서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요."),
    invalid_response: msg("licenseErrInvalidResponse", "서버 응답을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."),
    invalid_license: msg("licenseErrInvalidLicense", "유효하지 않은 라이선스 키입니다."),
    product_mismatch: msg("licenseErrProductMismatch", "이 라이선스는 Cloakli Pro용이 아닙니다."),
    variant_mismatch: msg("licenseErrProductMismatch", "이 라이선스는 Cloakli Pro용이 아닙니다."),
    license_expired: msg("licenseErrExpired", "만료된 라이선스입니다."),
    license_disabled: msg("licenseErrDisabled", "비활성화된 라이선스입니다."),
    activation_limit_reached: msg("licenseErrActivationLimit", "이 라이선스의 기기 활성화 한도를 초과했습니다."),
    rate_limited: msg("licenseErrRateLimited", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."),
    too_many_attempts: msg("licenseErrTooManyAttempts", "시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요."),
    no_session: msg("licenseErrNoSession", "활성화된 라이선스가 없습니다."),
    invalid_session: msg("licenseErrInvalidSession", "라이선스 세션이 만료되었습니다. 다시 활성화해 주세요."),
    instance_deactivated: msg("licenseErrInstanceDeactivated", "이 기기의 라이선스가 비활성화되었습니다."),
  };
  return (code && map[code]) || msg("licenseErrGeneric", "라이선스 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
}

// Free/License Pro/Developer Pro 세 가지 상태에 맞춰 라이선스 섹션을 다시 그린다.
// 라이선스 키 입력 폼의 펼침/닫힘 상태는 사용자가 직접 누른 결과만 반영하고,
// 이 함수가 임의로 닫거나 열지 않는다(Free 상태를 벗어나지 않는 한 그대로 둔다).
async function renderLicenseSection() {
  const entitlementState = CloakliEntitlement.getEntitlementState();

  if (entitlementState.source === "developer") {
    licenseFreeActionsEl.hidden = true;
    licenseInputAreaEl.hidden = true;
    licenseActiveInfoEl.hidden = true;
    return;
  }

  if (CloakliEntitlement.isProUser(entitlementState)) {
    licenseFreeActionsEl.hidden = true;
    licenseInputAreaEl.hidden = true;
    licenseActiveInfoEl.hidden = false;
    licenseStatusTextEl.textContent = entitlementState.status === "active" ? msg("licenseStatusActive", "활성") : entitlementState.status || msg("licenseStatusUnknown", "알 수 없음");
    licenseLastCheckedEl.textContent = entitlementState.validatedAt
      ? new Date(entitlementState.validatedAt).toLocaleString()
      : msg("licenseNeverChecked", "확인된 적 없음");
    const session = await CloakliLicenseClient.getStoredLicenseSession();
    licenseMaskedKeyEl.textContent = CloakliLicenseClient.getMaskedLicenseKey(session) || msg("licenseStatusUnknown", "알 수 없음");
    return;
  }

  licenseActiveInfoEl.hidden = true;
  licenseFreeActionsEl.hidden = false;
}

buyProBtn.addEventListener("click", () => {
  openCheckoutUrl();
});

showLicenseInputBtn.addEventListener("click", () => {
  licenseInputAreaEl.hidden = !licenseInputAreaEl.hidden;
  setLicenseMessage("");
});

toggleLicenseVisibilityBtn.addEventListener("click", () => {
  const showing = licenseKeyInput.type === "text";
  licenseKeyInput.type = showing ? "password" : "text";
  toggleLicenseVisibilityBtn.textContent = showing ? msg("licenseVisibilityShow", "표시") : msg("licenseVisibilityHide", "숨기기");
});

activateLicenseBtn.addEventListener("click", () => {
  withButtonGuard(activateLicenseBtn, async () => {
    const key = licenseKeyInput.value;
    if (!key || !key.trim()) {
      setLicenseMessage(msg("licenseEnterKeyFirst", "라이선스 키를 입력해 주세요."));
      return;
    }
    setLicenseMessage(msg("licenseChecking", "확인 중…"));
    let result;
    try {
      result = await CloakliLicenseClient.activateLicense(key);
    } catch (err) {
      result = { ok: false, error: "activation_failed" };
    }
    licenseKeyInput.value = ""; // 원문 키는 화면에도 더 남기지 않는다.
    if (!result || !result.ok) {
      setLicenseMessage(describeLicenseError(result && result.error));
      return;
    }
    setLicenseMessage(msg("licenseActivated", "Pro가 활성화되었습니다."));
    licenseInputAreaEl.hidden = true;
    await refreshPlanBadge();
    await renderLicenseSection();
  });
});

recheckLicenseBtn.addEventListener("click", () => {
  withButtonGuard(recheckLicenseBtn, async () => {
    setLicenseMessage("");
    let result;
    try {
      result = await CloakliLicenseClient.validateLicense();
    } catch (err) {
      result = { ok: false, error: "network_error" };
    }
    if (!result || (!result.ok && !result.offline)) {
      setLicenseMessage(describeLicenseError(result && result.error));
    }
    await refreshPlanBadge();
    await renderLicenseSection();
  });
});

deactivateLicenseBtn.addEventListener("click", () => {
  withButtonGuard(deactivateLicenseBtn, async () => {
    const confirmed = typeof window !== "undefined" && window.confirm ? window.confirm(msg("licenseDeactivateConfirm", "이 기기에서 Pro 라이선스를 비활성화하시겠습니까?")) : true;
    if (!confirmed) return;
    try {
      await CloakliLicenseClient.deactivateLicense();
    } catch (err) {
      // 서버 호출 실패 여부와 무관하게 로컬 세션은 이미 정리된다(license-client.js 참고).
    }
    setLicenseMessage("");
    await refreshPlanBadge();
    await renderLicenseSection();
  });
});

// 요금제 배지는 특정 탭이 아니라 전체 저장 규칙을 기준으로 하므로, 현재 사이트 상태와
// 별도로 갱신한다. 배지 문구/판단은 entitlement.js(CloakliEntitlement) 하나만 사용하고
// popup.js는 스스로 Pro 여부나 문구를 판단하지 않는다.
function refreshPlanBadge() {
  try {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) return;
      const allRules = (result && result[STORAGE_KEY]) || {};
      const entitlementState = CloakliEntitlement.getEntitlementState();
      const usage = CloakliEntitlement.computeUsage(allRules);
      const badge = CloakliEntitlement.describePopupPlanBadge(entitlementState, usage);
      planBadgeEl.textContent = badge.text;
      planBadgeEl.className = badge.cssClass;
    });
  } catch (err) {
    // 배지 표시 실패는 핵심 기능(가림)에 영향을 주지 않는다.
  }
}

// 팝업을 열 때 현재 활성 탭의 hostname/저장 규칙 개수/일시중지 여부를 읽어 상태 패널에 표시한다.
async function refreshStatus() {
  statusHostnameEl.textContent = msg("statusChecking", "현재 사이트 확인 중…");
  statusCountEl.textContent = "";
  statusStateEl.textContent = "";
  statusStateEl.className = "cloakli-status-line cloakli-status-state";
  selectBtn.disabled = true;
  pauseBtn.disabled = true;
  clearBtn.disabled = true;

  let tab;
  try {
    tab = await TabActions.getActiveTab();
  } catch (err) {
    tab = null;
  }
  currentTab = tab || null;

  if (!tab || !tab.url || TabActions.isUnsupportedUrl(tab.url)) {
    currentSupported = false;
    currentHostname = null;
    statusHostnameEl.textContent = msg("statusUnsupportedPage", "이 페이지에서는 Cloakli를 사용할 수 없습니다.");
    statusCountEl.textContent = "";
    statusStateEl.textContent = msg("statusTryNormalSite", "일반 웹사이트에서 다시 시도해 주세요.");
    statusStateEl.classList.add("cloakli-state-unsupported");
    // 지원하지 않는 페이지에서는 팝업 전체가 멈추지 않도록 버튼을 비활성 상태로 유지한다.
    manageBtn.disabled = false; // 관리 화면 자체는 항상 열 수 있다.
    return;
  }

  let hostname = null;
  try {
    hostname = new URL(tab.url).hostname;
  } catch (err) {
    hostname = null;
  }
  currentHostname = hostname;
  currentSupported = !!hostname;

  if (!hostname) {
    statusHostnameEl.textContent = msg("statusUnsupportedPage", "이 페이지에서는 Cloakli를 사용할 수 없습니다.");
    statusStateEl.textContent = msg("statusTryNormalSite", "일반 웹사이트에서 다시 시도해 주세요.");
    statusStateEl.classList.add("cloakli-state-unsupported");
    manageBtn.disabled = false;
    return;
  }

  statusHostnameEl.textContent = msg("currentSiteLabel", "현재 사이트: $1", [hostname]);
  selectBtn.disabled = false;
  pauseBtn.disabled = false;
  clearBtn.disabled = false;
  manageBtn.disabled = false;

  try {
    chrome.storage.local.get([STORAGE_KEY, PAUSED_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        statusCountEl.textContent = "";
        return;
      }
      const allRules = (result && result[STORAGE_KEY]) || {};
      const list = Array.isArray(allRules[hostname]) ? allRules[hostname] : [];
      statusCountEl.textContent = msg("savedMaskCount", "저장된 가림: $1개", [String(list.length)]);

      const pausedMap = (result && result[PAUSED_STORAGE_KEY]) || {};
      currentPaused = pausedMap[hostname] === true;
      updatePauseUi();
    });
  } catch (err) {
    statusCountEl.textContent = "";
  }
}

function updatePauseUi() {
  if (currentPaused) {
    statusStateEl.textContent = msg("statePaused", "상태: 이 사이트에서 일시중지됨");
    statusStateEl.className = "cloakli-status-line cloakli-status-state cloakli-state-paused";
    pauseBtn.textContent = msg("resumeBtn", "현재 사이트 가림 다시 시작");
  } else {
    statusStateEl.textContent = msg("stateActive", "상태: 가림 작동 중");
    statusStateEl.className = "cloakli-status-line cloakli-status-state";
    pauseBtn.textContent = msg("pauseBtn", "현재 사이트 가림 일시중지");
  }
}

// dispatchCloakliMessage가 실패로 끝난 이유에 맞는 안내 문구를 만든다. "지원하지 않는
// 페이지"(chrome:// 등, 정상적인 상황)와 "지원하는 페이지인데 실제로 실패함"(스크립트
// 주입/메시지 전송이 실패한 버그 상황)을 구분해서 보여준다. production에서는 내부 오류
// 객체나 stack trace를 노출하지 않고, development에서만 개인정보 없는 오류 코드를 덧붙인다.
function describeDispatchFailure(result) {
  if (result && result.unsupported) {
    return msg("statusUnsupportedPage", "이 페이지에서는 Cloakli를 사용할 수 없습니다.") + "\n" + msg("statusTryNormalSite", "일반 웹사이트에서 다시 시도해 주세요.");
  }
  let message = msg("dispatchFailed", "Cloakli를 현재 페이지에서 시작하지 못했습니다.\n확장 프로그램을 새로고침한 뒤 웹페이지도 다시 열어 주세요.");
  const isDevBuild = typeof CloakliBuildConfig !== "undefined" && CloakliBuildConfig && CloakliBuildConfig.mode === "development";
  if (isDevBuild) {
    message += "\n(개발 오류: CONTENT_SCRIPT_UNAVAILABLE)";
  }
  return message;
}

selectBtn.addEventListener("click", () => {
  withButtonGuard(selectBtn, async () => {
    setStatusMessage(msg("selectionPrompt", "웹페이지에서 가릴 영역을 클릭하세요…"));
    let result;
    try {
      result = await TabActions.dispatchCloakliMessage("START_SELECTION_MODE");
    } catch (err) {
      result = null; // 예외 내용 자체는 화면에 노출하지 않는다.
    }
    if (!result || !result.ok) {
      setStatusMessage(describeDispatchFailure(result));
      return;
    }
    setStatusMessage(msg("selectionStarted", "선택 모드가 시작되었습니다. 팝업을 닫아도 계속 동작합니다."));
  });
});

clearBtn.addEventListener("click", () => {
  withButtonGuard(clearBtn, async () => {
    let result;
    try {
      result = await TabActions.dispatchCloakliMessage("CLEAR_ALL_MASKS");
    } catch (err) {
      result = null;
    }
    if (!result || !result.ok) {
      setStatusMessage(describeDispatchFailure(result));
      return;
    }
    setStatusMessage(msg("clearedTemporarilyPopup", "현재 화면의 가림을 잠시 해제했습니다."));
  });
});

// 사이트 일시중지/다시 시작: content script에 메시지를 보내지 않고 storage를 직접 바꾼다.
// content.js가 이미 chrome.storage.onChanged를 구독하고 있어(저장 규칙 삭제와 같은 방식),
// 저장하는 즉시 열려 있는 페이지에도 반영된다.
pauseBtn.addEventListener("click", () => {
  withButtonGuard(pauseBtn, async () => {
    if (!currentSupported || !currentHostname) return;
    const nextPaused = !currentPaused;

    await new Promise((resolve) => {
      try {
        chrome.storage.local.get([PAUSED_STORAGE_KEY], (result) => {
          if (chrome.runtime.lastError) {
            resolve();
            return;
          }
          const pausedMap = (result && result[PAUSED_STORAGE_KEY]) || {};
          if (nextPaused) {
            pausedMap[currentHostname] = true;
          } else {
            delete pausedMap[currentHostname];
          }
          chrome.storage.local.set({ [PAUSED_STORAGE_KEY]: pausedMap }, () => resolve());
        });
      } catch (err) {
        resolve();
      }
    });

    currentPaused = nextPaused;
    updatePauseUi();
    setStatusMessage(nextPaused ? msg("pausedToastPopup", "이 사이트의 가림을 일시중지했습니다.") : msg("resumedToastPopup", "이 사이트의 가림을 다시 시작합니다."));
  });
});

// "저장된 가림 관리" 버튼: 이미 열려 있는 관리 탭이 있으면 새로 열지 않고 그 탭으로 이동한다.
manageBtn.addEventListener("click", () => {
  withButtonGuard(manageBtn, async () => {
    const targetUrl =
      chrome.runtime.getURL("options.html") + (currentHostname ? "?host=" + encodeURIComponent(currentHostname) : "");

    try {
      const existing = await chrome.tabs.query({ url: chrome.runtime.getURL("options.html") + "*" });
      if (existing && existing.length > 0) {
        await chrome.tabs.update(existing[0].id, { active: true, url: targetUrl });
        return;
      }
    } catch (err) {
      // 기존 탭 검색이 실패해도 새 탭을 여는 것으로 계속 진행한다.
    }
    chrome.tabs.create({ url: targetUrl });
  });
});

checkOnboarding();
refreshStatus();
renderDevBadge();

// 라이선스 캐시를 먼저 채운 뒤에 배지/라이선스 섹션을 그려야 License Pro 상태가
// 팝업을 열 때마다 잠깐 Free로 보였다가 바뀌는 깜빡임을 피할 수 있다.
CloakliLicenseClient.primeLicenseEntitlementCache()
  .catch(() => {})
  .then(() => {
    refreshPlanBadge();
    renderLicenseSection();
  });
