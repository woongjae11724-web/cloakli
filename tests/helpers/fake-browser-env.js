// 테스트 전용 "가짜 브라우저" 환경.
//
// Node의 vm 모듈로 새 전역 컨텍스트를 만들고, 그 안에 최소한의 window/document/
// chrome.*/MutationObserver/history를 채운 뒤 실제 content-core.js + content.js
// 소스를 그대로 실행한다. 이렇게 하면 content.js를 한 줄도 바꾸지 않고도
// (테스트를 위한 코드를 제품 코드에 섞지 않고도) 진짜 동작을 검증할 수 있다.
//
// 외부 라이브러리(jsdom 등)를 쓰지 않기 위해 DOM은 fake-dom.js의 최소 구현을 사용한다.
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { URL } = require("url");
const { FakeElement, FakeDocument, fireListeners } = require("./fake-dom");

const ROOT_DIR = path.join(__dirname, "..", "..");
const CORE_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "content-core.js"), "utf8");
const BUILD_CONFIG_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "build-config.js"), "utf8");
const ENTITLEMENT_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "entitlement.js"), "utf8");
const LICENSE_CLIENT_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "license-client.js"), "utf8");
const CONTENT_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "content.js"), "utf8");

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// chrome.storage.local / chrome.storage.onChanged / chrome.runtime.onMessage의 최소 모의 구현.
// 실제 chrome API처럼 콜백이 비동기(매크로태스크)로 불리도록 setTimeout(fn, 0)을 사용한다.
function createChromeMock() {
  const storageData = {};
  const onChangedListeners = [];
  const onMessageListeners = [];

  return {
    runtime: {
      lastError: undefined,
      onMessage: {
        addListener(fn) {
          onMessageListeners.push(fn);
        },
      },
      __listeners: onMessageListeners,
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
          const changes = {};
          Object.keys(obj).forEach((k) => {
            changes[k] = { oldValue: clone(storageData[k]), newValue: clone(obj[k]) };
            storageData[k] = clone(obj[k]);
          });
          setTimeout(() => {
            if (cb) cb();
            setTimeout(() => onChangedListeners.forEach((fn) => fn(changes, "local")), 0);
          }, 0);
        },
        remove(keys, cb) {
          const list = Array.isArray(keys) ? keys : [keys];
          const changes = {};
          list.forEach((k) => {
            if (Object.prototype.hasOwnProperty.call(storageData, k)) {
              changes[k] = { oldValue: clone(storageData[k]), newValue: undefined };
              delete storageData[k];
            }
          });
          setTimeout(() => {
            if (cb) cb();
            setTimeout(() => onChangedListeners.forEach((fn) => fn(changes, "local")), 0);
          }, 0);
        },
      },
      onChanged: {
        addListener(fn) {
          onChangedListeners.push(fn);
        },
      },
      __data: storageData,
      __onChangedListeners: onChangedListeners,
    },
  };
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    FakeMutationObserver.instances.push(this);
  }
  observe(target, options) {
    this.target = target;
    this.options = options;
  }
  disconnect() {
    this.disconnected = true;
  }
}
FakeMutationObserver.instances = [];

function makeEvent(type, extra) {
  const evt = Object.assign(
    {
      type,
      target: null,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.__stopped = true;
      },
      stopImmediatePropagation() {
        this.__stopped = true;
        this.__stoppedImmediate = true;
      },
    },
    extra
  );
  return evt;
}

// document -> ... -> target 순서(capture)로, 그 다음 target -> ... -> document 순서(bubble)로 발사한다.
function dispatchOn(env, target, evt) {
  evt.target = target;
  const chain = [];
  let node = target;
  while (node) {
    chain.push(node);
    node = node.parentNode;
  }
  chain.push(env.document);
  const captureOrder = chain.slice().reverse(); // document ... target

  for (const n of captureOrder) {
    fireListeners(n, evt.type, true, evt);
    if (evt.__stopped) return evt;
  }
  for (const n of chain) {
    // target ... document
    fireListeners(n, evt.type, false, evt);
    if (evt.__stopped) return evt;
  }
  return evt;
}

function createEnv(initialUrl) {
  const sandbox = {};
  const chromeMock = createChromeMock();

  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.chrome = chromeMock;
  sandbox.MutationObserver = FakeMutationObserver;
  sandbox.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&") };
  // content-core.js의 normalizePagePattern이 new URL(...)을 사용하므로, vm 컨텍스트에도
  // Node의 URL을 전역으로 심어 준다. (기본 vm.createContext는 Node 전용 전역을 상속하지 않는다)
  sandbox.URL = URL;
  sandbox.getComputedStyle = (el) => ({
    position: (el && el.style && el.style.position) || "static",
    display: "block",
  });
  sandbox.innerWidth = 1024;
  sandbox.innerHeight = 768;

  const url = new URL(initialUrl || "https://example.com/");
  sandbox.location = { href: url.href, hostname: url.hostname };

  // window.open(url, target, features) 모의 구현. 저장된 가림의 오버레이가 ctrl/cmd/shift+클릭,
  // 중간 클릭을 새 탭으로 여는 데 사용한다(forwardOverlayClick/forwardOverlayAuxClick 참고).
  const windowOpenCalls = [];
  sandbox.open = function open(openUrl, target, features) {
    windowOpenCalls.push({ url: openUrl, target: target, features: features });
    return null;
  };

  sandbox.history = {
    pushState(state, title, newUrl) {
      if (newUrl) {
        const resolved = new URL(newUrl, sandbox.location.href);
        sandbox.location.href = resolved.href;
        sandbox.location.hostname = resolved.hostname;
      }
      return undefined;
    },
    replaceState(state, title, newUrl) {
      if (newUrl) {
        const resolved = new URL(newUrl, sandbox.location.href);
        sandbox.location.href = resolved.href;
        sandbox.location.hostname = resolved.hostname;
      }
      return undefined;
    },
  };

  const env = {
    sandbox: sandbox,
    chrome: chromeMock,
    _pendingMutations: [],
    windowOpenCalls: windowOpenCalls,
  };

  env.notifyMutation = function notifyMutation(record) {
    env._pendingMutations.push(record);
  };

  env.document = new FakeDocument(env);
  sandbox.document = env.document;

  // window === self === globalThis, content script의 isolated world와 비슷하게 구성한다.
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox._listeners = Object.create(null);
  const { makeEventTarget } = require("./fake-dom");
  Object.assign(sandbox, makeEventTarget());

  const context = vm.createContext(sandbox);
  env.context = context;

  env.flushMutations = function flushMutations() {
    if (env._pendingMutations.length === 0) return;
    const records = env._pendingMutations;
    env._pendingMutations = [];
    FakeMutationObserver.instances.forEach((obs) => {
      if (obs.disconnected) return;
      try {
        obs.callback(records);
      } catch (err) {
        // 실제 브라우저도 observer 콜백 오류로 다른 observer를 막지 않는다.
      }
    });
  };

  env.dispatch = function dispatch(target, type, extra) {
    return dispatchOn(env, target, makeEvent(type, extra));
  };

  env.setLocation = function setLocation(href) {
    const resolved = new URL(href, sandbox.location.href);
    sandbox.location.href = resolved.href;
    sandbox.location.hostname = resolved.hostname;
  };

  env.triggerWindowEvent = function triggerWindowEvent(type) {
    dispatchOn(env, sandbox, makeEvent(type, {}));
  };

  env.sendRuntimeMessage = function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      const listeners = chromeMock.runtime.__listeners;
      if (listeners.length === 0) {
        resolve(undefined);
        return;
      }
      // popup.js와 동일하게 첫 리스너의 응답만 사용한다.
      listeners[0](message, {}, (response) => resolve(response));
    });
  };

  env.seedRules = function seedRules(hostname, rules) {
    chromeMock.storage.__data.cloakliRules = chromeMock.storage.__data.cloakliRules || {};
    chromeMock.storage.__data.cloakliRules[hostname] = rules;
  };

  env.getStoredRules = function getStoredRules(hostname) {
    const all = chromeMock.storage.__data.cloakliRules || {};
    return all[hostname] || [];
  };

  // 사이트 일시중지 상태를 직접 설정/조회하는 테스트 헬퍼.
  env.setHostPaused = function setHostPaused(hostname, paused) {
    const map = chromeMock.storage.__data.cloakliPausedHostnames || {};
    if (paused) {
      map[hostname] = true;
    } else {
      delete map[hostname];
    }
    chromeMock.storage.__data.cloakliPausedHostnames = map;
  };

  env.getPausedMap = function getPausedMap() {
    return chromeMock.storage.__data.cloakliPausedHostnames || {};
  };

  // 실제 chrome.storage.local.set 경로(및 그로 인한 storage.onChanged 발화)를 그대로 타도록
  // 하는 버전. popup.js가 일시중지를 토글할 때와 동일한 경로를 재현한다.
  env.setHostPausedViaStorage = function setHostPausedViaStorage(hostname, paused) {
    return new Promise((resolve) => {
      chromeMock.storage.local.get(["cloakliPausedHostnames"], (result) => {
        const map = (result && result.cloakliPausedHostnames) || {};
        if (paused) {
          map[hostname] = true;
        } else {
          delete map[hostname];
        }
        chromeMock.storage.local.set({ cloakliPausedHostnames: map }, resolve);
      });
    });
  };

  // content-core.js -> build-config.js -> entitlement.js -> license-client.js -> content.js
  // 순서로 실행한다. (manifest.json의 content_scripts 순서와 동일한 방식)
  //
  // options.entitlementOverride: 실제 CLOAKLI_DEVELOPER_MODE 상수를 건드리지 않고도
  // content.js가 "Pro였다면" 어떻게 동작하는지(범위 선택/저장 제한 해제) 검증하기 위한
  // 테스트 전용 훅. entitlement.js 실행 직후, content.js가 실행되기 전에
  // CloakliEntitlement.getEntitlementState를 교체해 content.js가 그 값을 그대로 사용하게 한다.
  //
  // 기본값은 항상 free다 — 이 저장소의 실제 build-config.js는 개발자가 로컬에서
  // Developer Pro를 테스트하려고 developerPro를 true로 바꿔 둔 상태일 수 있으므로,
  // "무료 한도가 실제로 동작하는지" 검증하는 테스트가 그 값에 우연히 좌우되면 안 된다.
  // 실제 build-config.js 값을 그대로 반영해 보고 싶다면 entitlementOverride: null을 넘긴다.
  env.loadContentScript = function loadContentScript(options) {
    const opts = options || {};
    vm.runInContext(CORE_SOURCE, context, { filename: "content-core.js" });
    vm.runInContext(BUILD_CONFIG_SOURCE, context, { filename: "build-config.js" });
    vm.runInContext(ENTITLEMENT_SOURCE, context, { filename: "entitlement.js" });
    if ("entitlementOverride" in opts) {
      if (opts.entitlementOverride) {
        sandbox.CloakliEntitlement.getEntitlementState = () => opts.entitlementOverride;
      }
      // entitlementOverride: null이면 의도적으로 실제 build-config.js 값을 그대로 쓴다.
    } else {
      sandbox.CloakliEntitlement.getEntitlementState = () => ({ plan: "free", source: "default", isPro: false });
    }
    vm.runInContext(LICENSE_CLIENT_SOURCE, context, { filename: "license-client.js" });
    vm.runInContext(CONTENT_SOURCE, context, { filename: "content.js" });
  };

  return env;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 규칙 저장(chrome.storage.local.set) 후에는 storage.onChanged가 다시 발화되어
// removeAllCloakliMasks + applyStoredRules를 한 번 더 거치는 비동기 라운드트립이 있다.
// 고정된 wait()만 쓰면 시스템 부하에 따라 그 라운드트립이 끝나기 전에 검사해 버려
// 드물게 flaky해질 수 있으므로, 조건이 실제로 참이 될 때까지 짧은 간격으로 폴링한다.
function waitUntil(conditionFn, options) {
  const timeoutMs = (options && options.timeoutMs) || 2000;
  const intervalMs = (options && options.intervalMs) || 10;
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      let result;
      try {
        result = conditionFn();
      } catch (err) {
        result = false;
      }
      if (result) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("waitUntil: 시간 내에 조건이 참이 되지 않았습니다."));
        return;
      }
      setTimeout(check, intervalMs);
    }
    check();
  });
}

module.exports = { createEnv, wait, waitUntil, FakeMutationObserver, FakeElement };
