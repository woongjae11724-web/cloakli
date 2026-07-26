// 테스트 전용 "가짜 options 페이지" 환경.
//
// fake-popup-env.js와 같은 방식(vm으로 실제 소스를 그대로 실행)으로 options.js를 검증한다.
// options.html이 실제로 참조하는 모든 id를 프로그램적으로 동일하게 구성하고, 라이선스
// 관련 메시지(GET_ENTITLEMENT 등)는 popup과 동일하게 실제 background(license-service.js)로
// 라우팅한다(createBackgroundBridge 재사용 — 로직을 두 곳에 따로 두지 않는다).
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { FakeDocument, makeEventTarget } = require("./fake-dom");
const { createChromeMock, buildConfigSourceFor, createBackgroundBridge } = require("./fake-popup-env.js");

const ROOT_DIR = path.join(__dirname, "..", "..");
const CORE_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "content-core.js"), "utf8");
const BUILD_CONFIG_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "build-config.js"), "utf8");
const ENTITLEMENT_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "entitlement.js"), "utf8");
const OPTIONS_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "options.js"), "utf8");

// options.html이 실제로 갖고 있는 id들을 그대로 구성한다(HTML 파서 없이).
function buildOptionsDom(env) {
  const doc = new FakeDocument(env);

  function make(tag, id, hidden) {
    const el = doc.createElement(tag);
    el.id = id;
    if (hidden) el.hidden = true;
    return el;
  }

  const devBanner = make("div", "cloakli-dev-banner", true);
  const heading = make("h1", "cloakli-options-heading");
  const desc = make("p", "cloakli-options-desc");
  desc.setAttribute("data-i18n", "optionsIntro");
  const planEl = make("div", "cloakli-options-plan");
  const proInfoBtn = make("button", "cloakli-options-pro-info-btn");
  proInfoBtn.setAttribute("data-i18n", "proInfoBtn");
  const proInfoSection = make("section", "cloakli-options-pro-info", true);
  const proInfoCloseBtn = make("button", "cloakli-options-pro-info-close-btn");
  proInfoSection.appendChild(proInfoCloseBtn);
  const summaryEl = make("p", "cloakli-options-summary");
  const searchInput = make("input", "cloakli-options-search");
  searchInput.setAttribute("data-i18n-placeholder", "optionsSearchPlaceholder");
  searchInput.setAttribute("data-i18n-aria", "optionsSearchAria");
  searchInput.value = "";

  const emptyEl = make("div", "cloakli-options-empty", true);
  emptyEl.setAttribute("data-i18n", "optionsEmpty");
  const noMatchEl = make("div", "cloakli-options-no-match", true);
  noMatchEl.setAttribute("data-i18n", "optionsNoMatch");
  const listEl = make("div", "cloakli-options-list");
  const messageEl = make("p", "cloakli-options-message");
  const resetAllBtn = make("button", "cloakli-reset-all-btn");
  resetAllBtn.setAttribute("data-i18n", "optionsResetAll");

  [
    devBanner,
    heading,
    desc,
    planEl,
    proInfoBtn,
    proInfoSection,
    summaryEl,
    searchInput,
    emptyEl,
    noMatchEl,
    listEl,
    messageEl,
    resetAllBtn,
  ].forEach((el) => doc.body.appendChild(el));

  return doc;
}

function createOptionsEnv(options) {
  const opts = options || {};
  const sandbox = {};

  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.URL = URL;
  sandbox.crypto = globalThis.crypto;
  sandbox.AbortController = globalThis.AbortController;
  sandbox.chrome = createChromeMock(opts.chrome);
  sandbox.confirm = typeof opts.confirmImpl === "function" ? opts.confirmImpl : () => true;
  sandbox.fetch = function fetch() {
    return Promise.resolve({ status: 200, json: async () => ({ ok: false, error: "no_fetch_impl_configured" }) });
  };

  const env = { sandbox, chrome: sandbox.chrome };
  env.notifyMutation = function notifyMutation() {};
  env.document = buildOptionsDom(env);
  sandbox.document = env.document;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.location = { search: "" };
  Object.assign(sandbox, makeEventTarget());

  const context = vm.createContext(sandbox);
  env.context = context;

  env.click = function click(el) {
    const evt = { type: "click", target: el, defaultPrevented: false, preventDefault() {}, stopPropagation() {} };
    const listeners = el.__listeners && el.__listeners.click;
    (listeners || []).forEach((fn) => fn(evt));
    return evt;
  };

  env.wait = function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  // popup.js와 동일한 순서: content-core -> build-config -> entitlement -> options.js.
  // 라이선스 메시지(GET_ENTITLEMENT 등)는 실제 background(license-service.js)로 라우팅한다.
  env.loadOptionsScript = function loadOptionsScript(loadOptions) {
    const loadOpts = loadOptions || {};
    const configSource = loadOpts.buildConfig ? buildConfigSourceFor(loadOpts.buildConfig) : BUILD_CONFIG_SOURCE;

    if (!opts.noBackground) {
      env.background = createBackgroundBridge(sandbox.chrome, opts.fetchImpl, loadOpts.skipBuildConfig ? undefined : configSource);
      sandbox.chrome.runtime = sandbox.chrome.runtime || {};
      sandbox.chrome.runtime.sendMessage = function sendMessage(message, cb) {
        env.background
          .handle(message)
          .then((response) => setTimeout(() => cb && cb(response), 0))
          .catch(() => setTimeout(() => cb && cb({ ok: false, error: "internal_error" }), 0));
      };
    }

    vm.runInContext(CORE_SOURCE, context, { filename: "content-core.js" });
    if (!loadOpts.skipBuildConfig) {
      vm.runInContext(configSource, context, { filename: "build-config.js" });
    }
    vm.runInContext(ENTITLEMENT_SOURCE, context, { filename: "entitlement.js" });
    vm.runInContext(OPTIONS_SOURCE, context, { filename: "options.js" });
  };

  return env;
}

module.exports = { createOptionsEnv };
