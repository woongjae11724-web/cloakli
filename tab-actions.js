// Cloakli 공용 탭 동작 모듈.
//
// popup(확장 페이지)과 background(서비스 워커)는 서로 다른 실행 컨텍스트라 JS 클로저를
// 직접 공유할 수 없지만, 둘 다 DOM 없이 chrome.* API만 사용하는 이 파일은 그대로 불러 쓸 수 있다.
// popup.html은 <script src="tab-actions.js">로, background.js(classic service worker)는
// importScripts("tab-actions.js")로 불러온다. 팝업 버튼과 키보드 단축키가 같은 함수
// (dispatchCloakliMessage)를 호출하므로 "탭을 찾고 content script를 주입하고 메시지를 보내는"
// 로직이 두 곳에 따로 존재하지 않는다.
(function (root) {
  "use strict";

  // content script를 사용할 수 없는 페이지인지 확인 (chrome://, 웹스토어, 새 탭 등)
  function isUnsupportedUrl(url) {
    if (!url) return true;
    const blockedPrefixes = [
      "chrome://",
      "chrome-extension://",
      "edge://",
      "about:",
      "https://chrome.google.com/webstore",
      "https://chromewebstore.google.com",
    ];
    return blockedPrefixes.some((prefix) => url.startsWith(prefix));
  }

  // 현재 활성 탭을 가져온다.
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // content script와 CSS를 탭에 주입한다. content.js는 content-core.js(순수 로직)와
  // entitlement.js(요금제 판정, build-config.js의 값을 읽음)에 의존하므로, manifest.json의
  // content_scripts와 정확히 같은 순서(content-core.js -> build-config.js -> entitlement.js
  // -> content.js)로 주입해야 한다. 이 목록이 하나라도 빠지면(예: 이미 열려 있던 탭처럼
  // manifest의 정적 content_scripts가 적용되지 않은 탭에서) content.js가 CloakliEntitlement/
  // CloakliBuildConfig 없이 실행되어, 요소를 클릭하는 순간 ReferenceError로 조용히 멈춘다.
  // (이미 주입되어 있으면 content.js 내부의 window.__cloakliContentLoaded 플래그가 중복 실행을 막는다)
  const CONTENT_SCRIPT_FILES = ["content-core.js", "build-config.js", "entitlement.js", "license-client.js", "content.js"];

  async function ensureContentInjected(tabId) {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPT_FILES,
    });
  }

  // content script로 메시지를 보내고, 수신자가 없어도(탭에 content script가 없어도) 호출자가 죽지 않게 처리한다.
  function sendMessageToTab(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: true });
      });
    });
  }

  // 현재 활성 탭이 지원되는 페이지인지 확인하고, content script를 주입한 뒤 메시지를 보낸다.
  // 팝업의 버튼 클릭과 background의 키보드 단축키 처리가 모두 이 함수 하나를 공유한다.
  // 반환값: { ok, unsupported, error }
  async function dispatchCloakliMessage(messageType) {
    let tab;
    try {
      tab = await getActiveTab();
    } catch (err) {
      return { ok: false, unsupported: true };
    }

    if (!tab || !tab.id || isUnsupportedUrl(tab.url)) {
      return { ok: false, unsupported: true };
    }

    try {
      await ensureContentInjected(tab.id);
    } catch (err) {
      // 내부 페이지 등 스크립트 주입 자체가 거부되는 경우도 "지원하지 않는 페이지"로 취급한다.
      return { ok: false, unsupported: true };
    }

    return sendMessageToTab(tab.id, { type: messageType });
  }

  const TabActions = {
    isUnsupportedUrl,
    getActiveTab,
    ensureContentInjected,
    sendMessageToTab,
    dispatchCloakliMessage,
    CONTENT_SCRIPT_FILES,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = TabActions;
  } else {
    root.TabActions = TabActions;
  }
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);
