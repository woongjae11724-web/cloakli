// Cloakli 설정 페이지: 사이트별로 저장된 가림 규칙을 보여주고 영구 삭제한다.

// content.js/popup.js와 반드시 동일한 문자열을 사용해야 같은 데이터를 읽고 쓸 수 있다.
const STORAGE_KEY = "cloakliRules";
const PAUSED_STORAGE_KEY = "cloakliPausedHostnames";

// ---------------------------------------------------------------------
// 다국어(i18n): 사용자에게 보이는 문구는 _locales/<언어>/messages.json에서 가져온다.
// chrome.i18n을 쓸 수 없는 환경(자동 테스트)에서는 두 번째 인자(한국어 원문)를 그대로
// 사용한다. $1, $2 자리표시자는 substitutions 배열 값으로 치환된다.
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

// options.html의 정적 문구(data-i18n / data-i18n-aria / data-i18n-placeholder)를
// 현재 브라우저 언어로 바꾼다. chrome.i18n이 없으면 HTML의 한국어 원문이 그대로 남는다.
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
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const m = chrome.i18n.getMessage(el.getAttribute("data-i18n-placeholder"));
      if (m) el.setAttribute("placeholder", m);
    });
  } catch (err) {
    // 문구 교체 실패가 설정 페이지 자체를 멈추게 하지 않는다.
  }
}
localizeDocument();

const listEl = document.getElementById("cloakli-options-list");
const emptyEl = document.getElementById("cloakli-options-empty");
const noMatchEl = document.getElementById("cloakli-options-no-match");
const messageEl = document.getElementById("cloakli-options-message");
const summaryEl = document.getElementById("cloakli-options-summary");
const searchInput = document.getElementById("cloakli-options-search");
const resetAllBtn = document.getElementById("cloakli-reset-all-btn");

const planEl = document.getElementById("cloakli-options-plan");
const proInfoBtn = document.getElementById("cloakli-options-pro-info-btn");
const proInfoSection = document.getElementById("cloakli-options-pro-info");
const proInfoCloseBtn = document.getElementById("cloakli-options-pro-info-close-btn");
const devBannerEl = document.getElementById("cloakli-dev-banner");

// 개발 빌드 안내는 build-config.js(CloakliBuildConfig.mode) 값 하나로만 판정한다.
// production 빌드에서는 scripts/build.js가 이 마크업 자체를 options.html에서 제거하므로
// devBannerEl이 애초에 null일 수 있다.
function renderDevBanner() {
  if (!devBannerEl) return;
  const isDevBuild = typeof CloakliBuildConfig !== "undefined" && CloakliBuildConfig && CloakliBuildConfig.mode === "development";
  if (!isDevBuild) {
    devBannerEl.remove();
    return;
  }
  devBannerEl.hidden = false;
}
renderDevBanner();

proInfoBtn.addEventListener("click", () => {
  proInfoSection.hidden = false;
});
proInfoCloseBtn.addEventListener("click", () => {
  proInfoSection.hidden = true;
});

// ---------------------------------------------------------------------
// 라이선스 상태의 단일 source of truth: background(GET_ENTITLEMENT).
// options 페이지는 Pro 여부를 스스로 계산하거나 storage를 직접 읽지 않는다.
// 응답 전에는 Free가 아니라 "확인 중"을 표시한다.
// ---------------------------------------------------------------------

// background 응답(공개 entitlement 형식). null이면 아직 확인 중이다.
let currentEntitlement = null;

function sendLicenseMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve(null);
          return;
        }
        resolve(response);
      });
    } catch (err) {
      resolve(null);
    }
  });
}

async function refreshEntitlementFromBackground() {
  const response = await sendLicenseMessage({ type: "GET_ENTITLEMENT" });
  currentEntitlement = response && response.ok && response.entitlement ? response.entitlement : null;
  renderPlanSummary(lastAllRules);
  renderDevDiagnostics();
}

// 요금제 요약 표시. Pro 여부는 background 응답(currentEntitlement) 하나만 쓰고, 문구는
// entitlement.js(describeOptionsPlanSummary) 하나만 사용한다 — License Pro와 Developer
// Pro는 서로 다른 문구로 표시된다(describeOptionsPlanSummary가 source로 구분).
function renderPlanSummary(all) {
  planEl.innerHTML = "";
  if (!currentEntitlement) {
    const p = document.createElement("p");
    p.textContent = msg("planChecking", "요금제 확인 중…");
    planEl.appendChild(p);
    planEl.className = "cloakli-options-plan";
    return;
  }
  const usage = CloakliEntitlement.computeUsage(all);
  const summary = CloakliEntitlement.describeOptionsPlanSummary(currentEntitlement, usage);
  summary.lines.forEach((line) => {
    const p = document.createElement("p");
    p.textContent = line;
    planEl.appendChild(p);
  });
  planEl.className = summary.cssClass;
}

// ---------------------------------------------------------------------
// 개발 빌드 전용 라이선스 진단 패널. 라이선스 키 원문/세션 토큰 원문/secret은
// 절대 표시하지 않는다(존재 여부와 시각만). production 빌드에서는 아예 만들지 않는다.
// 개발 전용 표기이므로 dev 배너와 동일하게 번역하지 않는다.
// ---------------------------------------------------------------------
async function renderDevDiagnostics() {
  const isDevBuild =
    typeof CloakliBuildConfig !== "undefined" && CloakliBuildConfig && CloakliBuildConfig.mode === "development";
  if (!isDevBuild) return;

  const response = await sendLicenseMessage({ type: "GET_LICENSE_DIAGNOSTICS" });
  const d = response && response.ok ? response.diagnostics : null;

  let panel = document.getElementById("cloakli-dev-diagnostics");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "cloakli-dev-diagnostics";
    panel.style.cssText = "margin-top:24px;padding:12px;border:1px dashed #b45309;border-radius:8px;font-size:12px;color:#92400e;";
    document.body.appendChild(panel);
  }
  panel.innerHTML = "";
  const title = document.createElement("p");
  title.textContent = "[개발 빌드 진단] 라이선스 상태 (비밀값 없음)";
  title.style.fontWeight = "700";
  panel.appendChild(title);

  const fmt = (ts) => (typeof ts === "number" && ts > 0 ? new Date(ts).toLocaleString() : "없음");
  const lines = d
    ? [
        "tier: " + d.tier + " · source: " + d.source + " · status: " + d.status,
        "session token 존재: " + (d.hasSessionToken ? "예" : "아니오"),
        "마지막 검증: " + fmt(d.lastValidatedAt) + " · 오프라인 유예 종료: " + fmt(d.graceUntil),
        "storage schema: v" + (d.schemaVersion || "-") + " · 확장 ID: " + (d.extensionId || "알 수 없음"),
        "확장 버전: " + (d.extensionVersion || "-") + " · 빌드: " + (d.buildMode || "-") + " · 서버: " + (d.licenseServerHost || "-"),
      ]
    : ["background 응답 없음 — 서비스 워커가 응답하지 않습니다."];
  lines.forEach((text) => {
    const p = document.createElement("p");
    p.textContent = text;
    panel.appendChild(p);
  });
}

// 가장 최근에 불러온 전체 규칙/일시중지 상태. 검색어가 바뀔 때마다 storage를 다시
// 읽지 않고 이 값으로만 다시 그린다.
let lastAllRules = {};
let lastPausedMap = {};

let messageTimeoutId = null;

function showMessage(text) {
  messageEl.textContent = text || "";
  if (messageTimeoutId) clearTimeout(messageTimeoutId);
  messageTimeoutId = setTimeout(() => {
    messageEl.textContent = "";
    messageTimeoutId = null;
  }, 3500);
}

function formatDate(timestamp) {
  if (typeof timestamp !== "number") return msg("optionsUnknownDate", "알 수 없음");
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return msg("optionsUnknownDate", "알 수 없음");
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  } catch (err) {
    return msg("optionsUnknownDate", "알 수 없음");
  }
}

function truncateSelector(selector, maxLen) {
  const limit = maxLen || 70;
  if (typeof selector !== "string") return "";
  if (selector.length <= limit) return selector;
  return selector.slice(0, limit) + "…";
}

// content.js/content-core.js와 동일한 scope 값을 사람이 읽기 쉬운 문구로 바꾼다.
const SCOPE_LABELS = {
  element: msg("optionsScopeElement", "이 요소만"),
  page: msg("optionsScopePage", "현재 페이지 유형"),
  site: msg("optionsScopeSite", "사이트 전체"),
};

function describeScope(rule) {
  const scope = (rule && rule.scope) || "element";
  return SCOPE_LABELS[scope] || scope;
}

function escapeForAttributeSelector(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

// content-core.js의 isValidRule을 그대로 재사용한다 (content.js와 동일한 기준).
const isValidRule = CloakliCore.isValidRule;

// 저장된 규칙을 읽고, id가 없는 예전(2단계) 규칙에는 id를 채워 넣어 저장한다.
// content-core.js의 ensureRuleIds가 순수 로직(무엇을 바꿀지)을 맡고, 여기서는
// storage 읽기/쓰기만 담당한다. 이미 모든 규칙에 id가 있으면 다시 쓰지 않으므로
// 여러 번 실행돼도 안전하다(idempotent).
function loadAllRulesMigrated(callback) {
  try {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        callback({});
        return;
      }
      const all = (result && result[STORAGE_KEY]) || {};
      let anyChanged = false;

      Object.keys(all).forEach((hostname) => {
        if (!Array.isArray(all[hostname])) return;
        const outcome = CloakliCore.ensureRuleIds(all[hostname], CloakliCore.generateRuleId);
        if (outcome.changed) {
          all[hostname] = outcome.list;
          anyChanged = true;
        }
      });

      if (!anyChanged) {
        callback(all);
        return;
      }

      chrome.storage.local.set({ [STORAGE_KEY]: all }, () => {
        // 저장이 실패해도 방금 읽은 값(all)으로는 화면을 정상적으로 그릴 수 있다.
        callback(all);
      });
    });
  } catch (err) {
    callback({});
  }
}

// 일시중지된 hostname 맵을 읽는다. 실패해도 항상 빈 객체를 돌려준다.
function loadPausedMap(callback) {
  try {
    chrome.storage.local.get([PAUSED_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        callback({});
        return;
      }
      callback((result && result[PAUSED_STORAGE_KEY]) || {});
    });
  } catch (err) {
    callback({});
  }
}

function render() {
  loadAllRulesMigrated((all) => {
    loadPausedMap((pausedMap) => {
      lastAllRules = all || {};
      lastPausedMap = pausedMap || {};
      renderPlanSummary(lastAllRules);
      renderSites(lastAllRules, lastPausedMap);
    });
  });
}

// 검색어(hostname 또는 selector 일부)로 사이트 카드를 걸러낸다.
// 실제 웹페이지 텍스트나 개인정보는 애초에 저장하지 않으므로 검색 대상이 될 수 없다.
function matchesSearchQuery(hostname, rules, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  if (hostname.toLowerCase().includes(q)) return true;
  return rules.some((rule) => typeof rule.selector === "string" && rule.selector.toLowerCase().includes(q));
}

function renderSites(all, pausedMap) {
  listEl.innerHTML = "";

  const allHostnames = Object.keys(all || {})
    .filter((hostname) => Array.isArray(all[hostname]) && all[hostname].some(isValidRule))
    .sort((a, b) => a.localeCompare(b));

  const totalRuleCount = allHostnames.reduce((sum, h) => sum + all[h].filter(isValidRule).length, 0);
  summaryEl.textContent =
    allHostnames.length === 0 ? "" : msg("optionsSummary", "전체 $1개 사이트 · 규칙 $2개", [String(allHostnames.length), String(totalRuleCount)]);

  if (allHostnames.length === 0) {
    emptyEl.hidden = false;
    noMatchEl.hidden = true;
    listEl.hidden = true;
    resetAllBtn.disabled = true;
    return;
  }

  const query = (searchInput.value || "").trim();
  const hostnames = allHostnames.filter((hostname) => matchesSearchQuery(hostname, all[hostname], query));

  emptyEl.hidden = true;
  resetAllBtn.disabled = false;

  if (hostnames.length === 0) {
    noMatchEl.hidden = false;
    listEl.hidden = true;
    return;
  }

  noMatchEl.hidden = true;
  listEl.hidden = false;

  hostnames.forEach((hostname) => {
    const rules = all[hostname].filter(isValidRule);
    const paused = pausedMap && pausedMap[hostname] === true;
    listEl.appendChild(buildSiteCard(hostname, rules, paused));
  });

  highlightRequestedHost();
}

function buildSiteCard(hostname, rules, paused) {
  const card = document.createElement("section");
  card.className = "cloakli-site-card";
  card.dataset.hostname = hostname;

  const header = document.createElement("div");
  header.className = "cloakli-site-card-header";

  const title = document.createElement("h2");
  title.className = "cloakli-site-hostname";
  title.textContent = hostname;

  const count = document.createElement("span");
  count.className = "cloakli-site-count";
  count.textContent = msg("optionsSiteCount", "저장된 가림 $1개", [String(rules.length)]);

  header.appendChild(title);
  header.appendChild(count);

  if (paused) {
    const badge = document.createElement("span");
    badge.className = "cloakli-site-paused-badge";
    badge.textContent = msg("optionsPausedBadge", "일시중지됨");
    header.appendChild(badge);
  }

  card.appendChild(header);

  const list = document.createElement("ol");
  list.className = "cloakli-rule-list";
  rules.forEach((rule, index) => {
    list.appendChild(buildRuleItem(hostname, rule, index + 1));
  });
  card.appendChild(list);

  const siteDeleteBtn = document.createElement("button");
  siteDeleteBtn.type = "button";
  siteDeleteBtn.className = "cloakli-btn cloakli-btn-outline-danger cloakli-site-delete-btn";
  siteDeleteBtn.textContent = msg("optionsDeleteSite", "이 사이트의 규칙 전부 삭제");
  siteDeleteBtn.addEventListener("click", () => handleDeleteSite(hostname, rules.length));
  card.appendChild(siteDeleteBtn);

  return card;
}

function buildRuleItem(hostname, rule, orderIndex) {
  const item = document.createElement("li");
  item.className = "cloakli-rule-item";
  if (rule.id) item.dataset.ruleId = rule.id;

  const selectorEl = document.createElement("div");
  selectorEl.className = "cloakli-rule-selector";
  selectorEl.textContent = `${orderIndex}. ${truncateSelector(rule.selector)}`;
  selectorEl.title = rule.selector; // 전체 selector는 title(마우스 오버)로 확인 가능

  const metaEl = document.createElement("div");
  metaEl.className = "cloakli-rule-meta";

  const scopeSpan = document.createElement("span");
  scopeSpan.textContent = msg("optionsScopeLabel", "적용 범위: $1", [describeScope(rule)]);

  const modeSpan = document.createElement("span");
  modeSpan.textContent = msg("optionsModeLabel", "가림 방식: $1", [rule.mode || "block"]);

  const dateSpan = document.createElement("span");
  dateSpan.textContent = msg("optionsCreatedLabel", "생성일: $1", [formatDate(rule.createdAt)]);

  metaEl.appendChild(scopeSpan);
  metaEl.appendChild(modeSpan);
  metaEl.appendChild(dateSpan);

  // "현재 페이지 유형" 범위는 저장 당시의 page pattern도 함께 보여준다.
  if (rule.scope === "page" && rule.pagePattern) {
    const patternSpan = document.createElement("span");
    patternSpan.textContent = msg("optionsPagePatternLabel", "페이지 범위: $1", [rule.pagePattern]);
    metaEl.appendChild(patternSpan);
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "cloakli-btn cloakli-btn-secondary cloakli-rule-delete-btn";
  deleteBtn.textContent = msg("optionsDeleteRule", "삭제");
  deleteBtn.addEventListener("click", () => handleDeleteRule(hostname, rule));

  item.appendChild(selectorEl);
  item.appendChild(metaEl);

  // 기존에(이전 버전에서) 저장된 규칙에는 경고를 보여준다. 자동으로 삭제하지는 않으며,
  // 사용자가 직접 판단해 삭제할 수 있게만 한다. 위험 조건:
  //  - 지나치게 광범위한 selector (bare "img"/"ytd-thumbnail"/"#thumbnail" 등, 조상 맥락 없음)
  //  - role/family 정보가 없는 page/site 규칙 (역할/카드 종류 구분 도입 이전 방식이라,
  //    롱폼과 Shorts처럼 서로 다른 종류의 요소를 한꺼번에 가릴 수 있음)
  const isLegacyBroadRule =
    CloakliCore.isRiskySelector(rule.selector) ||
    ((rule.scope === "page" || rule.scope === "site") && (!rule.role || !rule.family));
  if (isLegacyBroadRule) {
    const riskWarning = document.createElement("p");
    riskWarning.className = "cloakli-rule-risk-warning";
    riskWarning.textContent = msg("optionsRiskWarning", "이 규칙은 이전 방식으로 저장되어 여러 요소에 적용될 수 있습니다.\n삭제 후 다시 등록해 주세요.");
    item.appendChild(riskWarning);
  }

  item.appendChild(deleteBtn);
  return item;
}

// 규칙 하나만 영구 삭제한다. 삭제 직전 storage를 다시 읽어, 다른 곳에서 먼저
// 바뀐 최신 상태를 기준으로 지운다(설정 페이지를 여러 개 열어도 안전).
function handleDeleteRule(hostname, rule) {
  const confirmed = window.confirm(msg("optionsConfirmDeleteRule", "이 가림 규칙을 영구 삭제하시겠습니까?"));
  if (!confirmed) return;

  chrome.storage.local.get([STORAGE_KEY], (result) => {
    if (chrome.runtime.lastError) {
      showMessage(msg("optionsDeleteRuleFailed", "규칙을 삭제하지 못했습니다. 다시 시도해 주세요."));
      return;
    }
    const all = (result && result[STORAGE_KEY]) || {};
    const list = Array.isArray(all[hostname]) ? all[hostname] : [];

    // id가 있으면 id로, 없는(예전) 규칙은 selector+생성 시각 조합으로 대체 매칭한다.
    const outcome = rule.id
      ? CloakliCore.removeRuleById(list, rule.id)
      : CloakliCore.removeRuleBySelectorAndCreatedAt(list, rule.selector, rule.createdAt);
    const nextList = outcome.list;

    if (!outcome.removed) {
      showMessage(msg("optionsRuleNotFound", "규칙을 찾지 못해 삭제하지 못했습니다. 목록을 새로고침합니다."));
      render();
      return;
    }

    if (nextList.length === 0) {
      delete all[hostname];
    } else {
      all[hostname] = nextList;
    }

    chrome.storage.local.set({ [STORAGE_KEY]: all }, () => {
      if (chrome.runtime.lastError) {
        showMessage(msg("optionsDeleteRuleFailed", "규칙을 삭제하지 못했습니다. 다시 시도해 주세요."));
        return;
      }
      showMessage(msg("optionsDeletedRule", "가림 규칙을 삭제했습니다."));
      render();
    });
  });
}

// 해당 hostname의 규칙 전체를 삭제한다. 다른 사이트의 규칙은 건드리지 않는다.
function handleDeleteSite(hostname, count) {
  const confirmed = window.confirm(msg("optionsConfirmDeleteSite", "$1에 저장된 가림 규칙 $2개를 모두 삭제하시겠습니까?", [hostname, String(count)]));
  if (!confirmed) return;

  chrome.storage.local.get([STORAGE_KEY], (result) => {
    if (chrome.runtime.lastError) {
      showMessage(msg("optionsDeleteSiteFailed", "삭제하지 못했습니다. 다시 시도해 주세요."));
      return;
    }
    const all = (result && result[STORAGE_KEY]) || {};
    delete all[hostname];

    chrome.storage.local.set({ [STORAGE_KEY]: all }, () => {
      if (chrome.runtime.lastError) {
        showMessage(msg("optionsDeleteSiteFailed", "삭제하지 못했습니다. 다시 시도해 주세요."));
        return;
      }
      showMessage(msg("optionsDeletedSite", "$1의 저장 규칙을 모두 삭제했습니다.", [hostname]));
      render();
    });
  });
}

// 모든 사이트의 Cloakli 규칙을 초기화한다. STORAGE_KEY 하나만 제거하므로
// chrome.storage.local의 다른 key(향후 설정 등)는 영향을 받지 않는다.
function handleResetAll() {
  const confirmed = window.confirm(
    msg("optionsConfirmResetAll", "모든 사이트에 저장된 Cloakli 가림 규칙이 영구 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.\n\n계속하시겠습니까?")
  );
  if (!confirmed) return;

  chrome.storage.local.remove([STORAGE_KEY], () => {
    if (chrome.runtime.lastError) {
      showMessage(msg("optionsResetFailed", "초기화하지 못했습니다. 다시 시도해 주세요."));
      return;
    }
    showMessage(msg("optionsResetDone", "모든 저장 규칙을 초기화했습니다."));
    render();
  });
}

// 팝업의 "저장된 가림 관리"에서 ?host=hostname 형태로 넘어온 경우,
// 해당 사이트 카드로 스크롤하고 잠깐 강조 표시한다.
function highlightRequestedHost() {
  try {
    const params = new URLSearchParams(location.search);
    const targetHost = params.get("host");
    if (!targetHost) return;

    const card = listEl.querySelector(
      '.cloakli-site-card[data-hostname="' + escapeForAttributeSelector(targetHost) + '"]'
    );
    if (!card) return;

    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.classList.add("cloakli-site-card-highlight");
    setTimeout(() => card.classList.remove("cloakli-site-card-highlight"), 2000);
  } catch (err) {
    // 강조 표시 실패는 목록 자체를 보여주는 데는 영향을 주지 않는다.
  }
}

resetAllBtn.addEventListener("click", handleResetAll);

// 검색어가 바뀔 때마다 storage를 다시 읽지 않고, 마지막으로 불러온 값으로만 다시 그린다.
searchInput.addEventListener("input", () => {
  renderSites(lastAllRules, lastPausedMap);
});

// 다른 탭(웹페이지에서 새로 저장, popup에서의 일시중지 전환, 또는 다른 options 탭에서의 삭제)으로
// 인해 규칙이나 일시중지 상태가 바뀌면 화면을 다시 그려 항상 최신 상태를 보여준다.
// 통합 entitlement 레코드의 storage key. license-client.js의 ENTITLEMENT_STORAGE_KEY와
// 반드시 같은 문자열이어야 한다(자동 테스트가 두 파일을 비교해 확인한다). options는
// 이 키의 "값"을 직접 읽어 판정하지 않고, 변경 신호로만 사용해 background에 다시 묻는다.
const ENTITLEMENT_STORAGE_KEY = "cloakli.entitlement.v1";

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!changes) return;
  // popup에서 라이선스를 활성화/비활성화하면 이 페이지의 요금제 요약도 즉시 갱신한다.
  // 값은 storage에서 직접 해석하지 않고 background(GET_ENTITLEMENT)에 다시 묻는다.
  if (changes[ENTITLEMENT_STORAGE_KEY]) {
    refreshEntitlementFromBackground();
  }
  if (!changes[STORAGE_KEY] && !changes[PAUSED_STORAGE_KEY]) return;
  render();
});

// 규칙 목록은 즉시 그리고, 요금제 요약은 background 응답이 올 때까지 "확인 중"으로
// 표시한다(응답 전 Free로 단정하지 않는다).
render();
refreshEntitlementFromBackground();
