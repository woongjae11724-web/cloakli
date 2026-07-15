// 테스트 전용 "가짜 popup" 환경.
//
// content-integration.test.js가 content.js를 Node의 vm으로 그대로 실행해 검증하는 것과
// 같은 방식으로, popup.js도 실제 소스를 한 줄도 바꾸지 않고 vm으로 그대로 실행해
// 버튼 클릭 -> 활성 탭 조회 -> content script 주입 -> 메시지 전송 흐름을 검증한다.
// popup.html을 파싱하지는 않고(HTML 파서를 추가하지 않기 위해), popup.js가 실제로
// 참조하는 모든 id를 프로그램적으로 동일하게 구성한다.
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { URL } = require("url");
const { FakeElement, FakeDocument, fireListeners, makeEventTarget } = require("./fake-dom");

const ROOT_DIR = path.join(__dirname, "..", "..");
const CORE_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "content-core.js"), "utf8");
const BUILD_CONFIG_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "build-config.js"), "utf8");
const ENTITLEMENT_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "entitlement.js"), "utf8");
const LICENSE_CLIENT_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "license-client.js"), "utf8");
const LICENSE_SERVICE_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "license-service.js"), "utf8");
const TAB_ACTIONS_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "tab-actions.js"), "utf8");
const POPUP_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "popup.js"), "utf8");

// 실제 background와 같은 구성(별도 JS 실행 컨텍스트 + 같은 chrome.storage)을 만든다.
// popup.js가 chrome.runtime.sendMessage로 보내는 라이선스 메시지를 실제
// license-service.js(background 코드)가 처리하고, fetch는 테스트가 주입한 구현을 쓴다.
function createBackgroundBridge(chromeMock, fetchImpl, buildConfigSource) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    chrome: chromeMock,
    crypto: globalThis.crypto,
    AbortController: globalThis.AbortController,
    URL: URL,
    fetch: fetchImpl || (() => Promise.resolve({ status: 200, json: async () => ({ ok: false, error: "no_fetch_impl_configured" }) })),
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(CORE_SOURCE, context, { filename: "content-core.js" });
  vm.runInContext(buildConfigSource || BUILD_CONFIG_SOURCE, context, { filename: "build-config.js" });
  vm.runInContext(ENTITLEMENT_SOURCE, context, { filename: "entitlement.js" });
  vm.runInContext(LICENSE_CLIENT_SOURCE, context, { filename: "license-client.js" });
  vm.runInContext(LICENSE_SERVICE_SOURCE, context, { filename: "license-service.js" });
  return {
    sandbox,
    handle(message) {
      return sandbox.CloakliLicenseService.handleLicenseServiceMessage(message);
    },
  };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function buildConfigSourceFor(config) {
  return [
    "(function (root) {",
    '  "use strict";',
    "  const CLOAKLI_BUILD_CONFIG = " + JSON.stringify(config) + ";",
    '  if (typeof module !== "undefined" && module.exports) {',
    "    module.exports = CLOAKLI_BUILD_CONFIG;",
    "  } else {",
    "    root.CloakliBuildConfig = CLOAKLI_BUILD_CONFIG;",
    "  }",
    '})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);',
    "",
  ].join("\n");
}

// popup.html이 실제로 갖고 있는 모든 id를 그대로 구성한다(HTML 파서 없이).
function buildPopupDom(env) {
  const doc = new FakeDocument(env);

  function make(tag, id, hidden) {
    const el = doc.createElement(tag);
    el.id = id;
    if (hidden) el.hidden = true;
    return el;
  }

  const onboarding = make("section", "cloakli-onboarding", true);
  const onboardingStartBtn = make("button", "cloakli-onboarding-start-btn");
  onboarding.appendChild(onboardingStartBtn);

  const main = make("section", "cloakli-main");
  const devBadge = make("p", "cloakli-dev-badge", true);
  const planBadge = make("p", "cloakli-plan-badge");
  const statusHostname = make("p", "cloakli-status-hostname");
  const statusCount = make("p", "cloakli-status-count");
  const statusState = make("p", "cloakli-status-state");
  const statusMessage = make("div", "cloakli-status");
  const selectBtn = make("button", "cloakli-select-btn");
  const pauseBtn = make("button", "cloakli-pause-btn");
  const clearBtn = make("button", "cloakli-clear-btn");
  const manageBtn = make("button", "cloakli-manage-btn");
  const helpBtn = make("button", "cloakli-help-btn");
  const proInfoBtn = make("button", "cloakli-pro-info-btn");
  const proInfoSection = make("section", "cloakli-pro-info", true);
  const proInfoCta = make("div", "cloakli-pro-info-cta");
  const proInfoCloseBtn = make("button", "cloakli-pro-info-close-btn");
  proInfoSection.appendChild(proInfoCta);
  proInfoSection.appendChild(proInfoCloseBtn);

  const licenseFreeActions = make("div", "cloakli-license-free-actions", true);
  const buyProBtn = make("button", "cloakli-buy-pro-btn");
  const showLicenseInputBtn = make("button", "cloakli-show-license-input-btn");
  licenseFreeActions.appendChild(buyProBtn);
  licenseFreeActions.appendChild(showLicenseInputBtn);

  const licenseInputArea = make("div", "cloakli-license-input-area", true);
  const licenseKeyInput = make("input", "cloakli-license-key-input");
  licenseKeyInput.type = "password";
  licenseKeyInput.value = "";
  const toggleLicenseVisibilityBtn = make("button", "cloakli-toggle-license-visibility-btn");
  const activateLicenseBtn = make("button", "cloakli-activate-license-btn");
  const licenseMessage = make("p", "cloakli-license-message");
  licenseInputArea.appendChild(licenseKeyInput);
  licenseInputArea.appendChild(toggleLicenseVisibilityBtn);
  licenseInputArea.appendChild(activateLicenseBtn);
  licenseInputArea.appendChild(licenseMessage);

  const licenseActiveInfo = make("div", "cloakli-license-active-info", true);
  const licenseStatusText = make("span", "cloakli-license-status-text");
  const licenseLastChecked = make("span", "cloakli-license-last-checked");
  const licenseMaskedKey = make("span", "cloakli-license-masked-key");
  const recheckLicenseBtn = make("button", "cloakli-recheck-license-btn");
  const deactivateLicenseBtn = make("button", "cloakli-deactivate-license-btn");
  [licenseStatusText, licenseLastChecked, licenseMaskedKey, recheckLicenseBtn, deactivateLicenseBtn].forEach((el) =>
    licenseActiveInfo.appendChild(el)
  );

  [
    devBadge,
    planBadge,
    statusHostname,
    statusCount,
    statusState,
    statusMessage,
    selectBtn,
    pauseBtn,
    clearBtn,
    manageBtn,
    helpBtn,
    proInfoBtn,
    proInfoSection,
    licenseFreeActions,
    licenseInputArea,
    licenseActiveInfo,
  ].forEach((el) => main.appendChild(el));

  doc.body.appendChild(onboarding);
  doc.body.appendChild(main);

  return doc;
}

// popup.js/tab-actions.js가 쓰는 chrome.* API의 최소 모의 구현.
// options.chrome으로 tabs.query/sendMessage/scripting 동작을 시나리오별로 바꿀 수 있다.
function createChromeMock(options) {
  const opts = options || {};
  const storageData = clone(opts.initialStorage) || {};
  const calls = { tabsQuery: 0, sendMessage: [], executeScript: [], insertCSS: 0, tabsCreate: [] };

  const activeTab = "activeTab" in opts ? opts.activeTab : { id: 1, url: "https://example.com/" };

  const chromeMock = {
    runtime: {
      lastError: undefined,
      getURL(p) {
        return "chrome-extension://fake-extension-id/" + p;
      },
      getManifest() {
        return { version: "0.1.0" };
      },
    },
    tabs: {
      query() {
        calls.tabsQuery++;
        if (opts.tabsQueryThrows) return Promise.reject(new Error("tabs.query failed"));
        return Promise.resolve(activeTab ? [activeTab] : []);
      },
      sendMessage(tabId, message, cb) {
        calls.sendMessage.push({ tabId, message });
        if (opts.sendMessage) return opts.sendMessage(tabId, message, cb);
        cb({ ok: true });
      },
      update() {
        return Promise.resolve();
      },
      create(details) {
        calls.tabsCreate.push(details);
        return Promise.resolve();
      },
    },
    scripting: {
      insertCSS(details) {
        calls.insertCSS++;
        if (opts.insertCSSThrows) return Promise.reject(new Error("insertCSS failed"));
        return Promise.resolve();
      },
      executeScript(details) {
        calls.executeScript.push(details);
        if (opts.executeScriptThrows) return Promise.reject(new Error("executeScript failed"));
        return Promise.resolve();
      },
    },
    storage: {
      local: {
        get(keys, cb) {
          const list = Array.isArray(keys) ? keys : [keys];
          const result = {};
          list.forEach((k) => {
            if (Object.prototype.hasOwnProperty.call(storageData, k)) result[k] = clone(storageData[k]);
          });
          setTimeout(() => cb(result), 0);
        },
        set(obj, cb) {
          if (chromeMock.__storageSetFails) {
            // 실제 chrome은 저장 실패 시 lastError를 설정한 채 콜백을 호출한다.
            setTimeout(() => {
              chromeMock.runtime.lastError = { message: "QUOTA_BYTES quota exceeded" };
              if (cb) cb();
              chromeMock.runtime.lastError = undefined;
            }, 0);
            return;
          }
          Object.keys(obj).forEach((k) => {
            storageData[k] = clone(obj[k]);
          });
          setTimeout(() => {
            if (cb) cb();
          }, 0);
        },
        remove(keys, cb) {
          const list = Array.isArray(keys) ? keys : [keys];
          list.forEach((k) => {
            delete storageData[k];
          });
          setTimeout(() => {
            if (cb) cb();
          }, 0);
        },
      },
      onChanged: {
        addListener() {},
      },
    },
    __calls: calls,
    __storageData: storageData,
  };

  return chromeMock;
}

function createPopupEnv(options) {
  const opts = options || {};
  const sandbox = {};
  const fetchCalls = [];

  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.URL = URL;
  sandbox.crypto = globalThis.crypto;
  sandbox.AbortController = globalThis.AbortController;
  sandbox.chrome = createChromeMock(opts.chrome);
  sandbox.confirm = typeof opts.confirmImpl === "function" ? opts.confirmImpl : () => true;
  // license-client.js가 우리 라이선스 서버를 호출하는 fetch(...)만 가짜로 구현한다.
  // options.fetchImpl(url, requestInit) => Promise<Response 유사 객체>로 원하는 응답을 만들 수 있다.
  sandbox.fetch = function fetch(url, init) {
    fetchCalls.push({ url, init });
    if (opts.fetchImpl) return opts.fetchImpl(url, init);
    return Promise.resolve({ status: 200, json: async () => ({ ok: false, error: "no_fetch_impl_configured" }) });
  };

  const env = { sandbox, chrome: sandbox.chrome, fetchCalls };
  // popup 환경에서는 MutationObserver를 쓰지 않지만, fake-dom.js의 appendChild/removeChild/
  // remove()가 연결 여부를 확인하며 무조건 호출하므로 아무 것도 하지 않는 구현을 제공한다.
  env.notifyMutation = function notifyMutation() {};
  env.document = buildPopupDom(env);
  sandbox.document = env.document;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.location = { search: "" };
  Object.assign(sandbox, makeEventTarget());

  const context = vm.createContext(sandbox);
  env.context = context;

  env.click = function click(el) {
    const evt = {
      type: "click",
      target: el,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
    };
    fireListeners(el, "click", false, evt);
    return evt;
  };

  env.wait = function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  // content-core.js -> build-config.js -> entitlement.js -> tab-actions.js -> popup.js
  // 순서는 popup.html의 <script> 순서와 정확히 같다(popup은 license-client.js를 더 이상
  // 직접 로드하지 않는다 — 라이선스는 전부 background 메시지로 처리).
  // options.buildConfig가 있으면 그 값으로 build-config.js를 대체해 실행한다(예: development/production 모드 시뮬레이션).
  // options.skipBuildConfig가 true면 build-config.js 자체를 아예 실행하지 않는다(빌드 파일 누락 시나리오).
  env.loadPopupScript = function loadPopupScript(loadOptions) {
    const loadOpts = loadOptions || {};
    const configSource = loadOpts.buildConfig ? buildConfigSourceFor(loadOpts.buildConfig) : BUILD_CONFIG_SOURCE;

    // 실제 구조와 동일하게, popup과는 별도의 실행 컨텍스트에서 background(license-service)를
    // 띄우고 같은 chrome.storage를 공유시킨다. popup의 chrome.runtime.sendMessage가 이
    // background로 전달된다. opts.noBackground: 응답 없는 background(오류 경로) 모의.
    // opts.backgroundDelayMs: 응답 지연(로딩 상태 검증용).
    if (!opts.noBackground) {
      env.background = createBackgroundBridge(sandbox.chrome, sandbox.fetch, loadOpts.skipBuildConfig ? undefined : configSource);
      sandbox.chrome.runtime.sendMessage = function sendMessage(message, cb) {
        const delay = typeof opts.backgroundDelayMs === "number" ? opts.backgroundDelayMs : 0;
        env.background
          .handle(message)
          .then((response) => setTimeout(() => cb && cb(response), delay))
          .catch(() => setTimeout(() => cb && cb({ ok: false, error: "internal_error" }), delay));
      };
    } else {
      sandbox.chrome.runtime.sendMessage = function sendMessage(message, cb) {
        sandbox.chrome.runtime.lastError = { message: "Could not establish connection" };
        setTimeout(() => {
          if (cb) cb(undefined);
          sandbox.chrome.runtime.lastError = undefined;
        }, 0);
      };
    }

    vm.runInContext(CORE_SOURCE, context, { filename: "content-core.js" });
    if (!loadOpts.skipBuildConfig) {
      vm.runInContext(configSource, context, { filename: "build-config.js" });
    }
    vm.runInContext(ENTITLEMENT_SOURCE, context, { filename: "entitlement.js" });
    vm.runInContext(TAB_ACTIONS_SOURCE, context, { filename: "tab-actions.js" });
    vm.runInContext(POPUP_SOURCE, context, { filename: "popup.js" });
  };

  return env;
}

module.exports = { createPopupEnv, createChromeMock, buildConfigSourceFor };
