// Cloakli 백그라운드 서비스 워커.
// 설치 로그를 남기고, 키보드 단축키(chrome.commands)를 처리하고, chrome.alarms로
// 라이선스 서버 재검증을 주기적으로 수행한다.
// 탭을 찾아 content script를 주입하고 메시지를 보내는 로직은 popup.js와 완전히 공유하기 위해
// tab-actions.js 하나로 분리했다(같은 로직을 두 곳에 따로 작성하지 않는다). 라이선스
// 재검증 로직도 마찬가지로 license-client.js 하나만 사용한다.
importScripts("content-core.js", "build-config.js", "entitlement.js", "license-client.js", "license-service.js", "tab-actions.js");

const LICENSE_REVALIDATE_ALARM_NAME = "cloakli-license-revalidate";

function debugLog(...args) {
  try {
    if (typeof CloakliBuildConfig !== "undefined" && CloakliBuildConfig && CloakliBuildConfig.debug === true) {
      console.debug("[Cloakli]", ...args);
    }
  } catch (err) {
    // 로그 실패가 서비스 워커를 중단시키지 않게 한다.
  }
}

// service worker는 언제든 종료/재시작될 수 있으므로, 상태를 메모리 변수가 아니라
// chrome.storage.local(license-client.js를 통해)과 chrome.alarms(브라우저가 유지)에
// 둔다 - 재시작되어도 예약된 재검증과 캐시된 entitlement가 그대로 유지된다.
async function revalidateLicenseIfNeeded() {
  try {
    await self.CloakliLicenseClient.primeLicenseEntitlementCache();
    const result = await self.CloakliLicenseClient.validateLicense();
    debugLog("license revalidation:", result && result.ok);
  } catch (err) {
    // 재검증 실패가 확장 프로그램을 중단시키지 않게 한다. 실패해도 사용자 데이터를
    // 지우지 않으며(license-client.js가 네트워크 오류 시 캐시를 보존한다), 다음 주기에 다시 시도한다.
  }
}

function scheduleLicenseRevalidateAlarm() {
  try {
    const periodInMinutes = self.CloakliLicenseClient.LICENSE_REVALIDATE_INTERVAL_MS / 60000;
    chrome.alarms.create(LICENSE_REVALIDATE_ALARM_NAME, { periodInMinutes, delayInMinutes: 1 });
  } catch (err) {
    // alarms를 사용할 수 없어도(권한 문제 등) 나머지 기능은 계속 동작해야 한다.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // 설치/업데이트 시 콘솔 확인용 로그만 남긴다. (기능에 영향 없음, 개인정보 없음)
  try {
    console.log("Cloakli installed.");
  } catch (err) {
    // 서비스 워커 환경에서 console 사용이 막혀 있어도 확장 프로그램이 중단되지 않게 한다.
  }
  scheduleLicenseRevalidateAlarm();
  revalidateLicenseIfNeeded();
});

// 브라우저(Chrome)가 새로 시작될 때도 캐시를 다시 채우고 즉시 한 번 검증을 시도한다.
chrome.runtime.onStartup.addListener(() => {
  scheduleLicenseRevalidateAlarm();
  revalidateLicenseIfNeeded();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LICENSE_REVALIDATE_ALARM_NAME) {
    revalidateLicenseIfNeeded();
  }
});

// 라이선스 상태의 단일 source of truth: popup/options/content script는 아래 메시지로만
// Pro 여부를 묻는다. 처리 로직은 license-service.js 하나에 있다(여기서는 라우팅만 한다).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!self.CloakliLicenseService.isLicenseServiceMessage(message)) {
    return false; // 우리 메시지가 아니면 다른 리스너/기본 처리에 맡긴다.
  }
  self.CloakliLicenseService.handleLicenseServiceMessage(message)
    .then((response) => sendResponse(response))
    .catch(() => sendResponse({ ok: false, error: "internal_error" }));
  return true; // 비동기 응답
});

// 통합 entitlement 레코드가 바뀌면(활성화/비활성화/재검증) 서비스 워커가 살아 있는 동안
// 인메모리 캐시도 즉시 함께 갱신해, background의 판정이 storage와 어긋나는 구간을 없앤다.
// sessionToken은 인메모리 캐시에 넣지 않는다(공개 부분만).
chrome.storage.onChanged.addListener((changes, areaName) => {
  try {
    if (areaName !== "local" || !changes) return;
    const recordChange = changes[self.CloakliLicenseClient.ENTITLEMENT_STORAGE_KEY];
    if (recordChange) {
      self.CloakliEntitlement.setLicenseEntitlement(
        self.CloakliLicenseClient.publicEntitlementFromRecord(recordChange.newValue || null)
      );
    }
  } catch (err) {
    // 리스너 오류가 서비스 워커를 중단시키지 않게 한다.
  }
});

// 서비스 워커는 이벤트(단축키/알람 등)로 언제든 새로 깨어난다. 그때마다 저장된 캐시를
// 인메모리로 복구해, onInstalled/onStartup을 거치지 않은 재기동에서도 entitlement가
// 항상 storage 기준으로 판정되게 한다.
self.CloakliLicenseClient.primeLicenseEntitlementCache().catch(() => {});

// manifest.json의 commands 이름과 정확히 일치해야 한다: start-selection, temporarily-clear-page.
// popup.js의 버튼 클릭과 같은 메시지 이름(START_SELECTION_MODE/CLEAR_ALL_MASKS)을 사용해
// content script 쪽 처리 로직이 하나로 통일되도록 한다.
chrome.commands.onCommand.addListener((command) => {
  try {
    if (command === "start-selection") {
      self.TabActions.dispatchCloakliMessage("START_SELECTION_MODE").catch(() => {});
    } else if (command === "temporarily-clear-page") {
      self.TabActions.dispatchCloakliMessage("CLEAR_ALL_MASKS").catch(() => {});
    }
  } catch (err) {
    // 단축키 충돌이나 지원하지 않는 페이지에서의 오류가 서비스 워커를 중단시키지 않게 한다.
  }
});
