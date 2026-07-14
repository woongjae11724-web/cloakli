# Cloakli (10단계: Lemon Squeezy 결제 + Cloudflare Workers 라이선스 서버)

## 프로젝트 목적

Cloakli는 화면 공유(줌, 구글 미트, 팀즈 등) 전에 웹페이지에서 보여주고 싶지 않은 부분(개인정보, 알림, 메신저 미리보기 등)을 클릭 한 번으로 즉시 가릴 수 있게 해주는 Chrome 확장 프로그램입니다.

- **1단계**: 팝업에서 "가릴 영역 선택"을 누르고 요소를 클릭하면 해당 요소가 즉시 완전히 가려집니다.
- **2단계**: 한 번 가린 요소를 사이트별로 브라우저 로컬 저장소(`chrome.storage.local`)에 저장하고, 같은 사이트를 새로고침하거나 다시 방문했을 때 자동으로 다시 가립니다.
- **2.5단계**: 저장한 가림 규칙을 확인하고 **영구적으로 삭제**할 수 있는 설정(options) 페이지를 추가했습니다. 규칙 하나만 삭제, 사이트 전체 삭제, 모든 사이트 초기화가 가능하며, 삭제한 내용은 열려 있는 웹페이지에도 즉시 반영됩니다.
- **3단계**: YouTube, Gmail, Notion처럼 페이지 전체 새로고침 없이 내부 콘텐츠와 URL만 바뀌는 동적(SPA) 사이트에서도, 저장된 규칙을 다시 찾아 자동으로 가립니다. 이 단계에서 Node 내장 테스트 러너(`node:test`)를 이용한 자동 테스트 환경도 함께 도입했습니다.
- **5단계**: 요소를 클릭한 뒤 곧바로 저장하지 않고, **가림을 적용할 범위**(이 요소만 / 현재 페이지 유형의 같은 종류 모두 / 이 사이트의 같은 종류 모두)를 사용자가 직접 고르게 합니다.
- **6단계**: 처음 쓰는 사람도 설명 없이 이해할 수 있도록 팝업 UI를 정리하고, **사이트 단위 일시중지**, **첫 사용 안내**, **키보드 단축키**, 통일된 안내 메시지(toast), 설정 페이지 검색을 추가했습니다.
- **7단계**: 무료판(Free)과 Pro판의 기능 차이를 만들고, 결제 없이 개발자만 Pro 기능을 테스트할 수 있는 **Developer Pro** 모드와, 앞으로 실제 결제/라이선스 서버를 연결할 수 있는 **단일 권한 판정 구조**(`entitlement.js`)를 추가했습니다. 실제 결제, 회원가입, 로그인, 라이선스 서버는 아직 없습니다.
- **8단계**: **개발 빌드**(`dist/development`)와 **출시 빌드**(`dist/production`)를 명확히 분리하고, 출시 빌드에서는 Developer Pro/디버그 로그를 자동으로 강제 비활성화합니다. 출시 전 자동 검사(`scripts/validate-release.js`)와 Chrome Web Store 제출용 ZIP 자동 생성(`scripts/package-release.js`)을 추가했습니다. 번들러(Webpack/Vite/Rollup)나 새 npm 의존성 없이 Node 내장 모듈만 사용합니다.
- **9단계**: 8단계 직후 실제 Chrome에서 발견된 버그(`가릴 영역 선택`이 개발 빌드에서 조용히 멈추는 문제)를 고쳤습니다. 원인은 `tab-actions.js`의 content script 주입 목록이 `build-config.js`/`entitlement.js`를 빠뜨리고 있던 것이었습니다. 함께 개발 빌드(`Cloakli DEV`)와 출시 빌드(`Cloakli`)를 확장 프로그램 이름/팝업 배지/설정 페이지 배너로 명확히 구분하고, popup.js를 실제로 vm에서 실행해 버튼 클릭부터 메시지 전송까지 검증하는 통합 테스트를 추가했습니다.
- **10단계(이번 단계)**: 실제 결제(Lemon Squeezy)와 라이선스 검증 서버(Cloudflare Workers + D1, `server/`)를 연결했습니다. 확장 프로그램은 여전히 API 키/웹훅 시크릿/관리자 토큰을 전혀 갖고 있지 않으며, 오직 우리 라이선스 서버 하나(`license-client.js`)에만 `fetch`로 접근합니다. 자세한 아키텍처는 아래 "라이선스(Pro) 결제 연동" 절과 [server/SETUP.md](server/SETUP.md)를 참고하세요. **이 저장소만으로는 아직 실제 결제가 동작하지 않습니다** — Lemon Squeezy/Cloudflare 계정을 실제로 만들고 연결해야 합니다.

## 파일별 역할

| 파일 | 역할 |
|---|---|
| `manifest.json` | Manifest V3 설정. 권한, 팝업/백그라운드, `content_scripts`, `options_ui`, 키보드 단축키(`commands`)를 정의합니다. `content_scripts`는 `content-core.js` → `build-config.js` → `entitlement.js` → `license-client.js` → `content.js` 순서로 로드합니다. **(10단계)** 라이선스 재확인 알람(`chrome.alarms`)을 위해 `permissions`에 `alarms`를 추가했습니다(`activeTab`/`scripting`/`storage`/`alarms`). |
| `build-config.js` | **(8단계 신규)** 단 하나의 빌드 설정 객체(`CloakliBuildConfig`)를 내보냅니다. `entitlement.js`(Developer Pro 여부)와 `content.js`(디버그 로그 여부)가 이 값만 참조합니다. `scripts/build.js`가 출시 빌드를 만들 때 출력 폴더 안의 이 파일 **사본만** 강제로 덮어쓰고, 원본 소스는 건드리지 않습니다. **(10단계)** 비밀이 아닌 두 필드 `licenseServerUrl`(라이선스 서버 주소)과 `checkoutUrl`(Lemon Squeezy 결제 URL)을 추가했습니다. 실제 API 키/시크릿은 이 파일에도, 확장 프로그램 어디에도 없습니다. |
| `entitlement.js` | 요금제/권한 판정 단일 모듈(`CloakliEntitlement`). 무료 한도(`FREE_PLAN_LIMITS`)를 이 파일에서만 관리하며, `getEntitlementState`/`isProUser`/`canCreateRule`/사용량 계산(`computeUsage`)/화면 표시 문구 생성(`describePopupPlanBadge`, `describeOptionsPlanSummary`)을 내보냅니다. **(8단계)** Developer Pro 여부는 이 파일이 직접 상수로 갖지 않고 `build-config.js`(`CloakliBuildConfig.developerPro`)에서만 읽어옵니다. **(9단계)** `getEntitlementState()`가 `build-config.js`가 아예 로드되지 않은 경우에도 안전하게 free로 처리하도록 `typeof` 가드를 추가했습니다. **(10단계)** `setLicenseEntitlement`/`getCachedLicenseEntitlement`/`isLicenseEntitlementCurrentlyValid`를 추가해 라이선스 서버 검증 결과를 인메모리로 캐시하고, `getEntitlementState()`의 판정 우선순위를 **Developer Pro → 유효한 라이선스 서버 결과(오프라인 유예 포함) → Free** 순으로 확장했습니다. 이 파일 자신은 여전히 `chrome.*`나 네트워크를 직접 건드리지 않습니다(순수 로직 유지). |
| `license-client.js` | **(10단계 신규)** 라이선스 클라이언트 모듈(`CloakliLicenseClient`). installation ID 생성/보관(`cloakliInstallationId`), 라이선스 서버(`server/`) 호출(`activateLicense`/`validateLicense`/`deactivateLicense`), 결과를 `entitlement.js`의 캐시에 반영(`primeLicenseEntitlementCache`)하는 일만 담당합니다. 저장하는 것은 세션 토큰(`cloakliLicenseSession`: `sessionToken`/`licenseKeyLast4`/`activatedAt`)과 entitlement 캐시(`cloakliLicenseCache`)뿐이며, **라이선스 키 원문은 활성화 호출이 끝나면 어디에도 남지 않습니다.** 서버 주소는 `build-config.js`(`licenseServerUrl`) 하나만 참조하고, `scripts/validate-release.js`가 이 파일에서만 `fetch` 사용을 예외적으로 허용합니다(다른 파일은 여전히 `fetch` 금지). |
| `popup.html` | 툴바 아이콘을 클릭했을 때 뜨는 팝업의 구조. 첫 사용 안내 화면, 사이트 상태 패널(hostname/저장 개수/작동 상태), 가릴 영역 선택/사이트 일시중지·재시작/현재 화면 임시 해제/저장된 가림 관리 버튼, 사용 방법 다시 보기 링크를 포함합니다. **(7단계)** 요금제 배지(`cloakli-plan-badge`)와 "Pro 알아보기" 안내 영역을 추가했습니다. **(9단계)** `CLOAKLI_DEV_ONLY_START/END` 주석으로 감싼 `DEV BUILD` 배지(`cloakli-dev-badge`)를 추가했으며, `scripts/build.js`가 production 빌드에서는 이 블록을 통째로 잘라냅니다. **(10단계)** 라이선스 관리 영역(`cloakli-license-section`: Free 상태의 구매/키 입력 버튼, 라이선스 키 입력 폼, 활성 Pro 상태 표시/다시 확인/비활성화 버튼)을 추가했고, "Pro 알아보기" 패널의 하드코딩된 "출시 준비 중" 문구를 `checkoutUrl` 유무에 따라 동적으로 채우는 `cloakli-pro-info-cta` 컨테이너로 바꿨습니다. |
| `popup.css` | 팝업의 스타일. 너비 340px, 기본/보조/조용한(ghost) 버튼 구분, `focus-visible` 스타일, 긴 hostname 말줄임 처리. **(7단계)** 요금제 배지와 Pro 안내 패널 스타일 추가. **(9단계)** DEV BUILD 배지 스타일 추가. **(10단계)** 라이선스 섹션(입력 폼, 마스킹 토글 버튼, 활성 정보 패널, 위험 버튼) 스타일을 추가했습니다. |
| `popup.js` | 팝업 UI 로직. 탭을 찾고 content script를 주입하고 메시지를 보내는 부분은 `tab-actions.js`(`TabActions`)를 그대로 사용한다. 상태 패널 갱신, 사이트 일시중지 토글(storage 직접 기록), 첫 사용 안내 표시/완료 처리, 버튼 중복 클릭 방지(`withButtonGuard`), 저장된 가림 관리 탭 재사용을 담당한다. **(7단계)** 전체 저장 규칙을 기준으로 `CloakliEntitlement.computeUsage`/`describePopupPlanBadge`를 호출해 요금제 배지를 갱신합니다. **(9단계)** `describeDispatchFailure()`로 "지원하지 않는 페이지"와 "실제 실패"를 구분한 구체적인 안내를 표시하고, `CloakliBuildConfig.mode`로 DEV BUILD 배지를 렌더링합니다(`renderDevBadge`). **(10단계)** `renderLicenseSection()`으로 Free/License Pro/Developer Pro 세 상태를 구분해 그리고, `CloakliLicenseClient.activateLicense/validateLicense/deactivateLicense`를 호출하는 버튼 핸들러, `isSafeCheckoutUrl()`(https만 허용)로 검증한 결제 URL 열기(`openCheckoutUrl`/`renderProInfoCta`), 라이선스 오류 코드를 한국어 문구로 바꾸는 `describeLicenseError()`를 추가했습니다. 결제 URL은 이 파일 한 곳(`getCheckoutUrl()`)에서만 읽습니다. |
| `tab-actions.js` | `popup.js`와 `background.js`(키보드 단축키)가 함께 쓰는 공용 모듈. 활성 탭 조회, 지원하지 않는 URL 판별, content script 주입, 메시지 전송을 한 곳에만 구현해 중복 로직을 없앤다. **(9단계 버그 수정)** `ensureContentInjected()`가 주입하는 파일 목록(`CONTENT_SCRIPT_FILES`)에서 빠져 있던 `build-config.js`/`entitlement.js`를 추가했습니다. **(10단계)** 이 목록에 `license-client.js`를 추가했습니다(`content-core.js` → `build-config.js` → `entitlement.js` → `license-client.js` → `content.js`). 이 목록은 `manifest.json`의 `content_scripts.js`와 항상 같은지 자동 테스트로 고정되어 있습니다. |
| `content.js` | 웹페이지 안에서 동작. 선택 모드, 가림/해제, CSS 선택자 생성(구체 selector `generateStableSelector` + 일반화 selector `generateGeneralizedSelector`), 가림 범위 선택 UI, 규칙 저장/자동 재적용, `MutationObserver`/SPA URL 감지, `chrome.storage.onChanged` 동기화, 사이트 단위 일시중지(`cloakliPausedHostnames`) 판별과 통일된 `showCloakliToast(text, type)` 안내를 담당합니다. **(7단계)** 새 규칙을 저장하기 직전에 `CloakliEntitlement.canCreateRule()`로 무료 한도를 확인하고, 범위 선택 UI에서 무료 상태면 `page`/`site` 버튼에 `PRO` 배지를 표시합니다. **(10단계)** 페이지 로딩 시 `CloakliLicenseClient.primeLicenseEntitlementCache()`를 호출해 라이선스 캐시를 채우고, `chrome.storage.onChanged`로 `cloakliLicenseCache` 변경도 구독해(`handleLicenseCacheChanged`) 실시간으로 반영합니다. DOM/브라우저 API가 필요한 부분만 남기고, 순수 로직은 `content-core.js`/`entitlement.js`에 위임합니다. |
| `content-core.js` | DOM이나 `chrome.*` API 없이 동작하는 순수 로직 모음: 디바운스, URL 변경 판별, 저장 규칙 필터링/중복 방지/삭제, Cloakli 자체 UI 판별, 규칙 적용 오케스트레이션, 일시 해제 상태 전환, `normalizePagePattern`, `doesRuleApplyToCurrentPage`, `evaluateGeneralizedSelectorSafety`, `isHostnamePaused`(사이트 일시중지 조회), `normalizeToastType`(toast 종류 검증)을 포함합니다. `content.js`와 `options.js`가 같은 로직을 그대로 재사용하며, Node 테스트에서 브라우저 없이 단위 테스트합니다. |
| `content.css` | 웹페이지에 주입되는 스타일. 파란 테두리, 가림 레이어, 선택 모드 안내 바, 범위 선택 UI, 미리보기 outline, toast 종류별(success/info/warning/error) 강조 색상을 정의합니다. **(7단계)** 범위 선택 UI의 `PRO` 잠금 배지 스타일을 추가했습니다. |
| `background.js` | 서비스 워커. 설치 로그를 남기고, `tab-actions.js`를 `importScripts`로 불러와 키보드 단축키(`chrome.commands.onCommand`)를 popup과 동일한 메시지로 처리합니다. **(10단계)** `content-core.js`/`build-config.js`/`entitlement.js`/`license-client.js`도 함께 `importScripts`로 불러오고, `chrome.alarms`로 24시간마다(`LICENSE_REVALIDATE_INTERVAL_MS`) 라이선스를 재확인하는 `revalidateLicenseIfNeeded()`/`scheduleLicenseRevalidateAlarm()`을 추가해 `onInstalled`/`onStartup`/`onAlarm`에 연결했습니다. 실패해도 기존 로컬 라이선스 상태를 지우지 않습니다. |
| `options.html` | 설정 페이지의 구조. 사이트별 카드 목록, 빈 상태 안내, 전체 초기화 버튼, 검색 입력창과 전체 규칙/사이트 개수 요약을 포함하며, `options.js`보다 먼저 `content-core.js`를 불러옵니다. **(7단계)** 현재 요금제 요약(`cloakli-options-plan`)과 "Pro 알아보기" 안내 영역을 추가했습니다. **(9단계)** `CLOAKLI_DEV_ONLY_START/END` 주석으로 감싼 개발 빌드 안내 배너(`cloakli-dev-banner`)를 추가했으며, production 빌드에서는 이 블록이 통째로 제거됩니다. **(10단계)** `license-client.js`를 `options.js`보다 먼저 불러오도록 스크립트 순서를 갱신했습니다(라이선스 키 관리 UI 자체는 popup에만 있고, options는 요금제 요약만 최신 상태로 표시합니다). |
| `options.css` | 설정 페이지 스타일. 최대 너비 800px, 카드 레이아웃, monospace selector, 위험 버튼 색상, 검색 입력창과 일시중지 상태 배지 스타일. **(7단계)** 요금제 요약과 Pro 안내 패널, 링크형 버튼 스타일 추가. **(9단계)** 개발 빌드 안내 배너 스타일 추가. |
| `options.js` | `chrome.storage.local`에서 규칙을 읽어 렌더링하고, id/scope가 없는 예전 규칙을 마이그레이션하며, 규칙 하나 삭제/사이트 전체 삭제/전체 초기화를 처리합니다. 규칙마다 적용 범위(scope)와 page pattern을 표시하며, hostname/selector 검색 필터링과 사이트별 일시중지 상태 배지, 전체 규칙/사이트 개수 요약을 제공합니다. selector 직접 편집 기능은 없습니다. **(7단계)** `CloakliEntitlement.computeUsage`/`describeOptionsPlanSummary`로 현재 요금제 요약을 렌더링하고, "Pro 알아보기" 안내 영역 토글을 처리합니다. 삭제 기능은 요금제와 무관하게 항상 그대로 동작합니다. **(9단계)** `CloakliBuildConfig.mode`로 개발 빌드 안내 배너를 렌더링합니다(`renderDevBanner`). |
| `icons/` | 아이콘 파일을 넣는 폴더 (현재 비어 있음, manifest에서 아이콘 설정 생략). |
| `scripts/build.js` | `dist/development` 또는 `dist/production`을 만든다. 실행에 필요한 파일(`scripts/file-manifest.js`의 목록)만 복사하고, production 모드에서만 `build-config.js` 사본을 강제로 안전한 값으로 덮어쓴다. **(9단계)** manifest의 `name`/`description`을 빌드 모드에 맞게 다시 쓰고(`applyManifestBuildLabel`), production 모드에서는 popup.html/options.html 안의 DEV BUILD 배지·배너 마크업 블록을 통째로 잘라낸다(`stripDevOnlyMarkup`). |
| `scripts/validate-release.js` | `dist/production`을 검사한다: manifest 유효성, Developer Pro/디버그 강제 비활성화 여부, 외부 통신 코드, 금지 파일(tests/node_modules/README 등) 포함 여부를 확인하고 문제가 있으면 실패한다. **(9단계)** manifest `name`/`description`에 개발 빌드 표시가 남아 있는지, DEV BUILD 배지/배너 마크업이 남아 있는지, `content_scripts`/`<script>` 로드 순서가 올바른지(`validateScriptOrder`)까지 확인한다. |
| `scripts/package-release.js` | **(8단계 신규)** `dist/production`을 `releases/cloakli-v<version>.zip`으로 압축한다. 외부 zip 도구나 새 npm 패키지 없이 Node 내장 모듈(`zlib` 없이 순수 JS)로 ZIP 파일 형식을 직접 작성하는 `scripts/zip-writer.js`를 사용하며, 생성 직후 같은 모듈로 ZIP을 다시 읽어 내부 구조(최상단 `manifest.json`, 금지 폴더 없음)를 스스로 검증한다. |
| `scripts/zip-writer.js` | **(8단계 신규)** 외부 의존성 없는 최소 ZIP 작성/읽기 구현(CRC-32 포함). |
| `scripts/fs-utils.js`, `scripts/file-manifest.js` | **(8단계 신규)** 빌드/검증 스크립트가 공유하는 파일 복사·나열 도우미와, 출시 패키지에 포함될 파일 목록(단일 출처). |
| `package.json` | `npm test`와 **(8단계 신규)** `build:dev`/`build:prod`/`validate:prod`/`package:prod`/`release:check` 스크립트를 정의합니다. 외부 의존성은 여전히 0개입니다(Node 내장 `node:test`/`fs`/`crypto`/`path`만 사용). |
| `tests/` | 자동 테스트와 테스트 전용 보조 코드. 실제 확장 프로그램에는 포함되지 않습니다. `tests/build.test.js`가 빌드/검증/ZIP 스크립트를 검증합니다. **(9단계 신규)** `tests/popup.test.js`(+ `tests/helpers/fake-popup-env.js`)가 popup.js를 vm으로 그대로 실행해 버튼 클릭부터 content script 메시지 전송까지의 실제 흐름과 DEV BUILD 배지를 검증합니다. **(10단계)** `tests/popup.test.js`에 라이선스 섹션 테스트(Free/License Pro/Developer Pro 표시, 결제 URL https 검증, 활성화 성공/실패, 중복 클릭 방지, 다시 확인/비활성화)를 추가했고, `tests/regression.test.js`에 "Lemon Squeezy 연동이 확장 프로그램에 안전하게 분리되어 있다" 검사(서버 전용 비밀 이름/직접 API 호출 금지/가짜 결제 완료 문구 금지)를 추가했습니다. |
| `dist/`, `releases/` | **(8단계 신규)** 빌드/패키징 결과물이 저장되는 폴더. `.gitignore`에 등록되어 있으며, 저장소에 커밋하지 않습니다. |
| `server/` | **(10단계 신규)** Cloudflare Workers + D1 기반 라이선스 검증 서버. 확장 프로그램과 완전히 분리된 별도 프로젝트이며, `npm test`(루트)에는 포함되지 않고 `server/` 안에서 `npm test`로 따로 실행합니다. 자세한 구조는 아래 "라이선스(Pro) 결제 연동" 절과 [server/SETUP.md](server/SETUP.md) 참고. |

## 권한 설명

- `activeTab`: 사용자가 툴바에서 Cloakli 팝업 버튼을 직접 눌렀을 때, 현재 활성 탭에 한해 즉시 스크립트를 주입할 수 있게 해주는 최소 권한입니다. (이미 페이지에 자동 주입되어 있어도, 확장 설치/새로고침 이전부터 열려 있던 탭을 위한 보조 수단으로 유지합니다.)
- `scripting`: `chrome.scripting.executeScript` / `insertCSS`로 `content.js` / `content.css`를 탭에 주입하기 위해 필요합니다.
- `storage`: 사용자가 가린 요소의 CSS 선택자를 사이트별로 `chrome.storage.local`에 저장하고, 페이지 로딩 시(그리고 SPA 내부 이동 시) 다시 불러오며, (4단계) 설정 페이지에서 읽고 삭제하기 위해 필요합니다. 이 저장소는 사용자의 브라우저 안에만 존재하며, `chrome.storage.sync`(여러 기기 동기화)는 사용하지 않습니다.
- `alarms`: **(10단계 신규)** `background.js`가 24시간마다 라이선스 유효성을 서버에 다시 확인하기 위해 `chrome.alarms`를 사용합니다. 실제로 알람을 등록/사용하는 코드가 있을 때만 선언했습니다.

**10단계에서 추가로 확인할 점**: 확장 프로그램은 여전히 Lemon Squeezy API를 직접 호출하지 않습니다(`license-client.js`가 오직 우리 라이선스 서버에만 `fetch`합니다). `scripts/validate-release.js`가 `api.lemonsqueezy.com` 직접 호출과 `license-client.js` 외 파일의 `fetch` 사용을 모두 금지된 패턴으로 검사합니다.

`content_scripts`(`manifest.json`)에 `http://*/*`, `https://*/*`를 등록해, 일반 웹사이트가 로딩될 때 `content.js`가 자동으로 실행되도록 했습니다. `chrome://` 등 브라우저 내부 페이지는 이 패턴에 포함되지 않으므로 애초에 스크립트가 실행되지 않습니다. `<all_urls>`나 별도의 `host_permissions`는 선언하지 않았습니다. 설정 페이지는 `manifest.json`의 `options_ui`(`{ "page": "options.html", "open_in_tab": true }`)로 등록했으며, 이 자체는 별도 Chrome 권한이 필요 없습니다. `chrome.tabs.create`/`chrome.tabs.update`로 설정 페이지를 새 탭으로 열거나 재사용하는 것 역시 확장 프로그램 자신의 페이지를 다루는 동작이라 `tabs` 권한이 필요하지 않습니다.

**6단계에서도 새로 요청한 권한은 없습니다.** 키보드 단축키는 `manifest.json`의 `commands` 키만으로 등록되며 Chrome 공식 문서 기준으로 별도의 `permissions` 항목이 필요하지 않습니다. `background.js`가 `importScripts("tab-actions.js")`로 공용 모듈을 불러오는 것도 이미 서비스 워커에 포함된 파일을 불러오는 것일 뿐, 권한이 필요한 동작이 아닙니다. `tabs`, `history`, `webNavigation`, `notifications`, `unlimitedStorage`, 넓은 범위의 `host_permissions` 등은 이번 단계에서도 필요하지 않아 추가하지 않았습니다.

**7단계에서도 새로 요청한 권한은 없습니다.** `entitlement.js`는 `chrome.*` API를 전혀 호출하지 않는 순수 로직 모듈이며(입력으로 받은 규칙 데이터만 계산합니다), 결제/로그인/원격 라이선스 검증이 없으므로 추가 네트워크 권한도 필요하지 않습니다. 무료 한도 판단에 필요한 데이터(저장된 규칙 전체)는 이미 `storage` 권한으로 읽던 것과 동일한 `cloakliRules` 값입니다.

## Chrome에 로컬 설치하는 방법

1. 아직 빌드하지 않았다면 먼저 `npm run build:dev`를 실행합니다(자세한 내용은 아래 "개발 빌드와 출시 빌드" 참고).
2. Chrome 주소창에 `chrome://extensions` 를 입력하고 이동합니다.
3. 오른쪽 위의 `개발자 모드` 스위치를 켭니다.
4. `압축해제된 확장 프로그램을 로드합니다` 버튼을 클릭합니다.
5. `dist/development` 폴더(1번에서 만든 개발 빌드 결과)를 선택합니다.
6. 확장 프로그램 목록에 Cloakli가 나타나면, 툴바의 퍼즐 아이콘을 눌러 Cloakli를 상단에 고정합니다.
7. 아무 일반 웹사이트(예: 뉴스 사이트, 블로그, YouTube, Gmail)에 접속해 테스트합니다.
   - 이미 열려 있던 탭이 있다면, 자동 주입(`content_scripts`)이 적용되도록 한 번 새로고침하는 것을 권장합니다.

## 개발 빌드와 출시 빌드

8단계부터 개발용 빌드와 Chrome Web Store 제출용 출시 빌드를 명확히 분리했습니다. 번들러(Webpack/Vite/Rollup)는 쓰지 않고, Node 내장 모듈만으로 필요한 파일을 폴더 사이에 복사합니다.

### 개발 빌드

```
npm run build:dev
```

- 출력 폴더: `dist/development`
- 소스의 `build-config.js`를 **그대로(수정 없이)** 복사합니다. 즉, 로컬에서 `developerPro`를 `true`로 바꿔 두었다면 그 상태 그대로 개발 빌드에 반영되어 Developer Pro를 테스트할 수 있고, 기본값(`false`)이면 일반 사용자와 동일하게 Free로 동작합니다.
- `chrome://extensions`에서 `압축해제된 확장 프로그램을 로드합니다`로 이 폴더를 선택해 로드합니다.
- **(9단계)** `chrome://extensions` 목록과 팝업에서 확장 프로그램 이름이 **"Cloakli DEV"**로 표시됩니다(출시 빌드는 "Cloakli").

### 개발 빌드와 출시 빌드를 Chrome에서 구분하는 법 (9단계)

`dist/development`와 `dist/production`을 압축해제된 확장 프로그램으로 각각 로드하면 Chrome은 이들을 서로 다른 별개의 설치본으로 취급합니다. 겉모습(팝업 아이콘, popup 색상)만 봐서는 구분하기 어려울 수 있어, 다음 3가지 표시를 명확히 다르게 만들었습니다. 모두 `build-config.js`(정확히는 그 안의 `mode` 값) 하나로만 판정하며, `chrome.storage`로는 켤 수 없습니다.

| 표시 위치 | 개발 빌드(`dist/development`) | 출시 빌드(`dist/production`) |
|---|---|---|
| `chrome://extensions` 목록의 확장 이름 | `Cloakli DEV` | `Cloakli` |
| manifest의 `description` | `[개발 빌드] ...`로 시작 | 개발 문구 없음 |
| popup 상단 | `DEV BUILD` 배지 표시(요금제 배지와 별도) | 배지 요소 자체가 파일에 없음 |
| 설정(options) 페이지 상단 | `개발 빌드 / 실제 출시용 데이터와 혼동하지 마세요.` 배너 | 배너 요소 자체가 파일에 없음 |

`scripts/build.js`가 이름/설명을 빌드 시점에 다시 쓰고, 출시 빌드에서는 popup.html/options.html 안의 DEV BUILD 배지·배너 마크업 블록 자체를 파일에서 잘라내므로(런타임에 숨기는 것보다 더 확실합니다), 출시 ZIP 파일 어디를 열어봐도 "Cloakli DEV"나 "DEV BUILD" 문구가 남아 있지 않습니다.

**저장소(storage) 분리 주의**: `dist/development`와 `dist/production`을 Chrome에 동시에 로드하면 서로 다른 확장 프로그램 ID를 받으므로, 각자 `chrome.storage.local`에 저장하는 가림 규칙도 완전히 별개입니다. 개발 빌드에서 저장한 규칙이 출시 빌드에는 보이지 않으며(반대도 마찬가지), 테스트 중 헷갈린다면 지금 열어본 popup/옵션 화면의 이름(`Cloakli DEV`인지 `Cloakli`인지)을 먼저 확인하세요.

### 출시 빌드

```
npm run package:prod
```

- 이 명령 하나가 다음을 순서대로 실행합니다: ① 전체 자동 테스트 → ② `dist/production` 정리 후 새로 빌드 → ③ 출시 안전 검사(`validate:prod`) → ④ `releases/cloakli-v<version>.zip` 생성 및 내부 구조 재검사.
- 출력 폴더: `dist/production` (검증 완료 후 `releases/cloakli-v<version>.zip`)
- **Developer Pro는 항상 자동으로 꺼집니다.** `scripts/build.js`가 production 빌드를 만들 때 원본 소스의 `build-config.js`는 건드리지 않고, 출력 폴더 안의 사본만 `{ mode: "production", developerPro: false, debug: false }`로 강제로 덮어씁니다 — 개발자가 소스에서 `developerPro: true`로 바꿔 둔 채 실수로 이 명령을 실행해도 출시 빌드는 항상 안전합니다.
- 실제 결제/라이선스 서버가 아직 없으므로, 출시 빌드를 설치한 모든 일반 사용자는 항상 **Free**로 동작합니다.

개별 단계만 실행하려면:

```
npm run build:prod       # dist/production만 새로 빌드
npm run validate:prod    # dist/production을 검증만 (빌드는 하지 않음)
npm run release:check    # 테스트 + build:prod + validate:prod (ZIP은 만들지 않음)
```

### 출시 전 자동 검사 (`validate:prod`)

`scripts/validate-release.js`가 `dist/production`에 대해 다음을 자동으로 확인하며, 문제가 있으면 오류 목록과 함께 실패합니다.

- **manifest.json**: JSON 문법, `manifest_version`/`name`/`version`/`description` 존재, `version` 형식(예: `1.0.0`), `action.default_popup`/`background.service_worker`/`options_ui.page`가 가리키는 파일 존재, `content_scripts`의 모든 js/css 파일 존재, `icons`가 선언되어 있다면 해당 파일 존재, `commands`와 `background.js`의 처리 이름 일치, `permissions`가 정확히 `activeTab`/`scripting`/`storage`인지, `host_permissions`나 `<all_urls>`가 없는지.
- **Developer Pro 비활성화**: `build-config.js`를 직접 불러와 `developerPro === false`, `debug === false`, `mode === "production"`인지 확인하고, 추가로 `developerPro: true`, `CLOAKLI_DEVELOPER_MODE = true`, 테스트 전용 `entitlementOverride` 같은 패턴이 남아 있지 않은지 전체 파일을 다시 스캔합니다. (사용자에게 보여주는 "Developer Pro" 문구 자체는 정상적인 UI 텍스트이므로 금지하지 않고, 실제로 켜는 코드/설정값만 검사합니다.)
- **디버그 코드**: `debugger` 문, 하드코딩된 `CLOAKLI_DEBUG = true`, 테스트 전용 함수/가짜 DOM 참조가 있으면 실패합니다. `console.log(...)`는 실패시키지 않고 경고만 남깁니다(예: `background.js`의 설치 로그처럼 개인정보 없는 로그일 수 있어, 무조건 차단하지 않고 사람이 확인하도록 안내합니다). `console.error`/`console.warn`은 검사하지 않습니다.
- **외부 통신**: `fetch(...)`, `XMLHttpRequest`, `WebSocket`, Google Analytics/Sentry/Bugsnag 등 분석·오류수집 SDK 키워드, `<script src="https://...">` 같은 원격 스크립트 참조가 있으면 실패합니다.
- **금지 파일**: `dist/production` 안에 `tests/`, `node_modules/`, `package.json`, `.git`, fixture, `coverage`, `.map`, `.log`, `README` 등이 없는지 확인합니다.
- **(9단계 신규) 개발 빌드 전용 표시 유출**: manifest의 `name`이 "Cloakli DEV"이거나 `DEV`를 포함하는지, `description`에 `[개발 빌드]`가 남아 있는지, popup.html/options.html에 `cloakli-dev-badge`/`cloakli-dev-banner` 마크업이나 `CLOAKLI_DEV_ONLY_START` 마커가 남아 있는지 확인합니다.
- **(9단계 신규) 스크립트 로드 순서**: manifest의 `content_scripts.js`와 popup.html/options.html의 `<script>` 태그가 항상 `content-core.js → build-config.js → entitlement.js → (content.js|popup.js|options.js)` 순서인지 확인합니다. 이 순서가 어긋나면 요소 클릭 시 `CloakliEntitlement`가 정의되지 않아 조용히 멈추는 문제가 재발할 수 있습니다(아래 "9단계: 실제 발견된 문제" 참고).

### ZIP 결과 (`package-release.js`)

`releases/cloakli-v<version>.zip`이 생성되며, 생성 직후 같은 ZIP을 다시 읽어(외부 unzip 도구 없이 `scripts/zip-writer.js`로 직접) 다음을 스스로 검증합니다.

- ZIP 최상단에 `manifest.json`이 있는지 (압축 시 `dist/production/` 같은 상위 폴더가 함께 들어가지 않도록, 파일마다 `dist/production` 기준 상대 경로만 사용합니다)
- `tests/`, `node_modules/`, `dist/`, `production/` 같은 폴더가 섞여 있지 않은지
- ZIP이 비어 있지 않은지
- 파일명에 `manifest.json`의 `version`이 포함되는지 (예: `cloakli-v0.1.0.zip`)

같은 버전의 ZIP 파일이 이미 있으면 새로 만들기 전에 명확히 삭제한 뒤 다시 씁니다(버전을 자동으로 올리지는 않으며, 버전은 `manifest.json`에서 직접 관리합니다).

### 현재 Pro 상태 (8단계 기준)

실제 결제/라이선스 서버가 아직 없으므로, `npm run package:prod`로 만든 출시 ZIP을 설치한 모든 일반 사용자는 **항상 Free**로 동작합니다. Developer Pro는 이 저장소를 직접 열어 `build-config.js`를 수정하고 `npm run build:dev`로 로컬 개발 빌드를 만들 때만 켤 수 있으며, 출시 빌드에는 어떤 경로로도 전달되지 않습니다.

### Chrome Web Store 제출

`releases/cloakli-v<version>.zip`을 Chrome Web Store 개발자 대시보드에 그대로 업로드하면 됩니다. ZIP 내부 최상단에 `manifest.json`이 바로 보이므로(하위 폴더로 한 번 더 감싸져 있지 않으므로) 별도의 압축 해제·재압축이 필요 없습니다. 이 단계에서는 실제 업로드나 제출은 자동화하지 않았습니다(사람이 직접 업로드).

### 9단계: 실제 발견된 문제와 원인

8단계 직후 실제 Chrome에서 `dist/development`를 로드해 확인한 결과, 팝업의 `가릴 영역 선택` 버튼을 눌러도 선택 모드가 정상 동작하지 않는 문제가 발견됐습니다.

**원인**: `tab-actions.js`의 `ensureContentInjected()`가 탭에 content script를 주입할 때 사용하는 파일 목록이 `["content-core.js", "content.js"]`로, `entitlement.js`가 추가된 이후에도 갱신되지 않은 채 남아 있었습니다. `manifest.json`의 정적 `content_scripts`는 4개 파일(`content-core.js`/`build-config.js`/`entitlement.js`/`content.js`)을 올바른 순서로 선언하고 있어 **확장 프로그램을 새로 로드한 뒤 새로 연 탭**에서는 문제가 드러나지 않지만, **이미 열려 있던 탭**(정적 `content_scripts`가 적용될 기회가 없었던 탭)에서 팝업 버튼을 누르면 `chrome.scripting.executeScript`가 이 두 파일만 주입합니다. 그 결과 `content.js`가 `CloakliBuildConfig`/`CloakliEntitlement` 없이 실행되고, 요소를 클릭해 `openScopePicker()`/`saveRule()`이 `CloakliEntitlement`를 참조하는 순간 `ReferenceError`가 발생해 조용히 멈췄습니다.

**수정**: `tab-actions.js`에 `CONTENT_SCRIPT_FILES = ["content-core.js", "build-config.js", "entitlement.js", "content.js"]` 상수를 만들어 `ensureContentInjected()`가 이 목록을 그대로 쓰게 했고, `manifest.json`의 `content_scripts.js`와 항상 같은 목록·순서인지 자동 테스트(`tab-actions.test.js`)로 고정했습니다. 추가로 `entitlement.js`의 `getEntitlementState()`가 `build-config.js` 로드 여부와 무관하게 안전하게 동작하도록 `typeof` 가드를 더했습니다(방어적 보강, 이번 버그의 직접 원인은 아닙니다).

## 기본 사용법

1. 가릴 영역 선택
2. 요소 클릭
3. 적용 범위 선택
4. 화면 공유 시작

풀어서 설명하면:

1. 일반 웹사이트에 접속합니다.
2. 툴바에서 Cloakli 아이콘을 클릭해 팝업을 엽니다. 상태 패널에 현재 사이트 hostname, 저장된 가림 개수, 작동 상태가 표시됩니다.
3. `가릴 영역 선택` 버튼을 클릭합니다(또는 단축키 `Ctrl+Shift+H` / Mac `Command+Shift+H`).
4. 웹페이지로 이동해, 파란 테두리가 표시되는 것을 확인하며 가리고 싶은 요소를 클릭합니다.
5. 클릭하면 즉시 가려지는 대신, 화면 중앙에 범위 선택 창이 뜹니다. `이 요소만` / `현재 페이지의 같은 종류 모두` / `이 사이트의 같은 종류 모두` 중 하나를 고르거나 `취소`를 누릅니다(ESC도 동일).
6. 범위를 고르면 그제서야 실제로 가려지고, 페이지 하단에 "가림 영역이 저장되었습니다." 같은 안내가 잠깐 표시됩니다.
7. 화면 공유를 시작합니다. 페이지를 새로고침하거나, YouTube에서 다른 영상으로 이동하거나, Gmail에서 다른 메일을 열어봐도 같은 종류의 요소가 다시 나타나면(선택한 범위에 따라) 자동으로 다시 가려집니다.
8. 필요하면 팝업을 다시 열어 `현재 화면 가림만 잠시 해제` 버튼을 클릭합니다(또는 단축키 `Ctrl+Shift+U` / Mac `Command+Shift+U`). 화면의 가림만 사라지고, 저장된 규칙은 남아 있습니다.
9. 이 사이트에서만 자동 가림 전체를 잠시 꺼 두고 싶으면 `현재 사이트 가림 일시중지`를 누릅니다. 다시 켜려면 같은 자리의 `현재 사이트 가림 다시 시작`을 누릅니다.
10. 저장한 규칙을 영구적으로 지우고 싶으면 팝업의 `저장된 가림 관리` 버튼을 눌러 설정 페이지를 엽니다. 규칙 옆의 `삭제` 버튼이나 `이 사이트의 규칙 전부 삭제`, 맨 아래의 `모든 저장 규칙 초기화`를 사용합니다.

## popup 구조

팝업은 처음 보는 사람도 개발 용어 없이 이해할 수 있도록 다음 순서로 구성되어 있습니다.

1. **제목/설명**: "Cloakli" + "화면 공유 전에 민감한 정보를 가리세요."
2. **현재 사이트 상태 패널**: `현재 사이트: youtube.com`, `저장된 가림: 3개`, `상태: 가림 작동 중`(일시중지 중이면 `상태: 이 사이트에서 일시중지됨`, 지원하지 않는 페이지면 `이 페이지에서는 Cloakli를 사용할 수 없습니다.`)를 보여줍니다.
3. **가릴 영역 선택** (가장 눈에 띄는 기본 버튼)
4. **현재 사이트 가림 일시중지 / 다시 시작** (보조 버튼, 상태에 따라 문구가 바뀜)
5. **현재 화면 가림만 잠시 해제** (더 조용한 스타일의 버튼) + 바로 아래 "저장된 규칙은 유지되며 새로고침하거나 페이지를 이동하면 다시 적용됩니다." 설명
6. **저장된 가림 관리** (설정 페이지로 이동)
7. **사용 방법 다시 보기** / **Pro 알아보기** (하단의 작은 링크 두 개)
8. **(7단계 신규) 요금제 배지**: 헤더 아래 아주 작은 글씨로 `Free · 규칙 2/3 · 사이트 1/1` 처럼 현재 사용량을 보여줍니다. 핵심 버튼보다 훨씬 눈에 띄지 않도록 작게 표시됩니다.
9. **(7단계 신규) Pro 알아보기 안내 영역**: 실제 결제를 시작하지 않고, Pro 기능 목록과 "Pro 결제 기능은 출시 준비 중입니다." 문구만 보여주는 접었다 펼 수 있는 패널입니다.

CSS selector, scope, pagePattern 같은 개발 용어는 팝업 어디에도 노출하지 않으며, 삭제처럼 되돌릴 수 없는 기능은 팝업에 두지 않고 설정(options) 페이지에만 둡니다.

## 요금제 (Free / Pro / Developer Pro)

7단계에서 무료판과 Pro판의 기능 차이를 도입했습니다. 아직 실제 결제, 로그인, 라이선스 서버는 없습니다.

| | Free (기본값) | Pro | Developer Pro |
|---|---|---|---|
| 저장 가능한 사이트(hostname) | 최대 1개 | 무제한 | 무제한 |
| 저장 가능한 규칙 수 | 전체 최대 3개 | 무제한 | 무제한 |
| `이 요소만`(element) 범위 | 가능 | 가능 | 가능 |
| `현재 페이지의 같은 종류 모두`(page) 범위 | **불가** (저장 시 Pro 안내만 표시) | 가능 | 가능 |
| `이 사이트의 같은 종류 모두`(site) 범위 | **불가** (저장 시 Pro 안내만 표시) | 가능 | 가능 |
| 규칙 삭제 / 사이트 일시중지 / 현재 화면 임시 해제 | 가능 | 가능 | 가능 |
| 기존에 저장되어 있던 규칙(범위 무관) | 계속 적용됨 | 계속 적용됨 | 계속 적용됨 |

무료 한도(`maxHostnames: 1`, `maxRules: 3`, `allowedScopes: ["element"]`)는 `entitlement.js`의 `FREE_PLAN_LIMITS` 상수 하나에만 정의되어 있으며, 다른 파일에는 이 숫자를 중복해서 적어두지 않았습니다.

### 단일 권한 판정 구조 (`entitlement.js`)

`content.js`/`popup.js`/`options.js`가 각자 다른 기준으로 "지금 Pro인가?"를 판단하지 않도록, 판정 로직을 `entitlement.js` 한 파일에만 모았습니다.

- `getEntitlementState()` — `{ plan, source, isPro }` 형태로 현재 권한 상태를 돌려주는 단일 진입점입니다. (예: `{ plan: "free", source: "default", isPro: false }`)
- `isProUser(state)` — 위 상태가 Pro인지 안전하게 판별합니다(손상된 값은 항상 `false`).
- `canCreateRule(context)` — 새 규칙을 저장해도 되는지 판단합니다. Pro 여부 → scope 허용 여부 → hostname 한도 → 규칙 개수 한도 순으로 확인하고, `{ allowed, reason }`을 돌려줍니다.
- `computeUsage(allRulesByHostname)` — 저장된 규칙 전체에서 유효한 규칙 수/hostname 수를 계산합니다. `selector`/`hostname`이 없는 손상된 데이터나 배열이 아닌 값은 조용히 제외하고, 완전히 같은 규칙이 중복 저장되어 있어도 한 번만 셉니다.
- `describePopupPlanBadge`/`describeOptionsPlanSummary` — popup/options에 그대로 표시할 문구를 만들어 주므로, 두 화면이 서로 다른 문구·기준으로 어긋나지 않습니다.

`content.js`(규칙 저장 직전 검사), `popup.js`(요금제 배지), `options.js`(요금제 요약)는 모두 이 함수들만 호출하며, 나중에 실제 라이선스 서버가 생기더라도 `getEntitlementState()` 내부만 바꾸면 되고 이 함수를 호출하는 쪽은 그대로 둘 수 있습니다.

### 개발자 전용 Pro 테스트 모드 (Developer Pro)

`entitlement.js` 안의 `CLOAKLI_DEVELOPER_MODE` 상수 하나로만 제어합니다. 이 상수는 `entitlement.js` 밖의 어떤 파일에서도 직접 참조하지 않으며, storage에도 저장하지 않습니다.

```javascript
// entitlement.js
const CLOAKLI_DEVELOPER_MODE = false; // 출시 전 반드시 false여야 합니다.
```

- `true`로 바꾸면 이 설치본은 (일반 사용자와 구분 없이) 항상 `{ plan: "pro", source: "developer", isPro: true }`로 동작해, 결제 없이 Pro 기능(무제한 hostname/규칙, page/site 범위)을 테스트할 수 있습니다.
- `false`이면 실제 라이선스 검증이 아직 없으므로 항상 무료(Free) 기본값으로 동작합니다.
- popup 하단에는 일반 Pro 표시(`Pro · 규칙 및 사이트 무제한`)와 구분되는 `Developer Pro · 테스트용 Pro 모드` 문구가 표시됩니다. options 페이지 상단에도 `현재 요금제: Developer Pro`로 별도 표시됩니다.
- **options 페이지에는 개발자 모드를 켜는 토글이 없습니다.** 일반 사용자가 화면에서 직접 Pro로 바꿀 방법은 없으며, 오직 이 소스 코드 상수를 고쳐 확장 프로그램을 다시 로드해야만 바뀝니다.
- 개발자 모드 상태는 어떤 외부 서버로도 전송되지 않습니다(애초에 `entitlement.js`는 네트워크 요청을 하지 않습니다).

**⚠️ 출시 전 반드시 확인하세요**: [entitlement.js](entitlement.js)의 `CLOAKLI_DEVELOPER_MODE`가 `false`인지 확인한 뒤 배포하세요. `true`인 채로 배포하면 이 확장을 설치한 모든 사용자가 결제 없이 Pro로 동작합니다.

### 무료 한도 초과 시 안내

한도에 걸려 저장이 차단되면 상황에 맞는 문구가 웹페이지 위 toast(`showCloakliToast`, `warning` 종류)로 표시되며, 규칙은 저장되지 않습니다.

| 상황 | 안내 문구 |
|---|---|
| 이미 규칙 3개를 사용 중 | "무료판에서는 가림 규칙을 최대 3개까지 저장할 수 있습니다.\n기존 규칙을 삭제하거나 Pro로 업그레이드하세요." |
| 이미 다른 사이트에서 사용 중 | "무료판에서는 1개 사이트에서만 저장 기능을 사용할 수 있습니다.\n기존 사이트 규칙을 삭제하거나 Pro로 업그레이드하세요." |
| `page`/`site` 범위 선택 | "페이지 유형과 사이트 전체 가림은 Pro 기능입니다.\n무료판에서는 '이 요소만'을 사용할 수 있습니다." |

`page`/`site` 범위 버튼은 무료 상태에서도 숨기지 않고 `PRO` 배지와 함께 그대로 보여주되, 클릭하면 범위 선택 창을 닫지 않은 채로 위 안내만 표시하고 저장을 진행하지 않습니다. 그 자리에서 바로 `이 요소만`으로 다시 선택할 수 있게 하기 위함입니다.

### 기존 규칙 보호

무료 한도는 **새 규칙을 저장하려는 시점에만** 적용됩니다. 예전에(또는 Pro였을 때) 이미 저장해 둔 `page`/`site` 범위 규칙이 있는 사용자가 나중에 무료 상태가 되어도:

- 기존 규칙은 삭제되거나 자동으로 비활성화되지 않습니다.
- 기존 `page`/`site` 규칙은 무료 상태에서도 계속 정상적으로 적용됩니다.
- 규칙 개별 삭제 / 사이트 전체 삭제 / 전체 초기화는 요금제와 무관하게 항상 그대로 동작합니다.
- 마이그레이션 과정에서 범위를 축소하거나 규칙을 바꾸지 않습니다.

즉 무료 한도의 영향을 받는 것은 "새로 `가릴 영역 선택`을 눌러 저장하려는 순간"뿐입니다.

### Pro 알아보기

popup과 options 페이지의 `Pro 알아보기` 버튼을 누르면, 같은 화면 안에 다음 내용을 보여주는 안내 영역이 펼쳐집니다.

- 사이트 무제한
- 규칙 무제한
- 페이지 유형 범위
- 사이트 전체 범위
- 향후 추가될 Pro 기능
- **(10단계)** `build-config.js`의 `checkoutUrl`이 유효한 `https://` URL이면 `Pro 구매하기` 버튼이 표시되고(새 탭으로 Lemon Squeezy 결제 페이지를 엽니다), 아직 설정되지 않았으면 "Pro 결제 기능은 아직 준비되지 않았습니다." 안내만 표시됩니다. 두 경우 모두 버튼을 눌러도 결제가 자동으로 완료된 것처럼 보이는 동작은 없습니다 — 실제 결제는 Lemon Squeezy 페이지에서, 라이선스 활성화는 사용자가 직접 키를 입력해야 이루어집니다.

## 라이선스(Pro) 결제 연동 (10단계)

7단계에서 만든 "요금제 판정"과 "Pro 기능 제한" 구조는 그대로 유지한 채, 실제 결제(Lemon Squeezy)와
라이선스 검증 서버(Cloudflare Workers + D1, `server/`)를 새로 연결했습니다. **이 저장소를 그대로 받은
상태로는 아직 실제 결제가 동작하지 않습니다** — `server/SETUP.md`를 따라 실제 Lemon Squeezy/Cloudflare
계정을 만들고 연결해야 합니다.

### 전체 흐름

```
[사용자] --(1. 결제)--> [Lemon Squeezy 결제 페이지]
                              |
                              | (2. 라이선스 키 발급, 이메일 등으로 전달)
                              v
[사용자] --(3. 팝업에 키 입력)--> [Cloakli 확장 프로그램]
                              |
                              | (4. 활성화 요청: 라이선스 키 + installation ID)
                              v
                    [Cloudflare Worker(server/)] --(5. 라이선스 확인)--> [Lemon Squeezy License API]
                              |
                              | (6. 세션 토큰 + entitlement 발급, D1에 기록)
                              v
[Cloakli 확장 프로그램] (세션 토큰만 저장, 라이선스 키 원문은 버림)

[Lemon Squeezy] --(구독 취소/만료/결제 실패 등)--> [웹훅] --(서명 검증)--> [Worker] --(D1 갱신)--> 다음 "라이선스 다시 확인"에 반영
```

핵심 원칙: **확장 프로그램은 Lemon Squeezy API 키, 웹훅 시크릿, 관리자 토큰을 전혀 갖고 있지 않습니다.**
확장 프로그램이 아는 것은 우리 라이선스 서버의 URL(`build-config.js`의 `licenseServerUrl`, 비밀이 아님)
하나뿐이며, 그 서버만 호출합니다. 모든 비밀값은 Cloudflare Worker 쪽(`wrangler secret put` 또는
로컬 전용 `.dev.vars`)에만 존재합니다.

### 서버 구조 (`server/`)

확장 프로그램 소스와 완전히 분리된 별도 Node/Cloudflare Workers 프로젝트입니다(`server/` 안에서
별도의 `npm test`/`npm install`을 사용하며, 루트 `npm test`에는 포함되지 않습니다). 번들러나 무거운
웹 프레임워크 없이 Workers의 기본 `fetch(request, env)` 핸들러와 Node 내장 `node:test`만 사용합니다.

| 경로 | 역할 |
|---|---|
| `server/src/index.js` | 모든 요청의 진입점. CORS 판정 → 경로별 라우팅 → 오류는 항상 일반화된 500으로 응답. |
| `server/src/routes/health.js` | `GET /health` — 비밀값 노출 없이 서버 생존만 확인. |
| `server/src/routes/activate.js` | `POST /v1/license/activate` — 라이선스 키 검증 → 기기 활성화 한도 확인 → 세션 토큰 발급. |
| `server/src/routes/validate.js` | `POST /v1/license/validate` (`Authorization: Bearer <세션 토큰>`) — D1에 저장된(웹훅으로 갱신되는) 최신 상태를 돌려줌. |
| `server/src/routes/deactivate.js` | `POST /v1/license/deactivate` — **이 기기의 인스턴스만** 비활성화. |
| `server/src/routes/webhook.js` | `POST /v1/webhooks/lemonsqueezy` — 서명 검증(파싱 전) → 중복 처리 방지 → D1 갱신. |
| `server/src/routes/admin.js` | `GET /v1/admin/license-summary` — 관리자 시크릿이 있을 때만, 집계 수치만(활성/비활성 라이선스 수 등) 반환. 개별 라이선스 키/이메일/설치 ID는 절대 반환하지 않음. |
| `server/src/services/licenseProviders/` | `LemonSqueezyLicenseProvider`(실제 API 호출)와 `MockLicenseProvider`(개발/테스트 전용, 고정 키 `CLOAKLI-TEST-PRO`/`CLOAKLI-TEST-EXPIRED`/`CLOAKLI-TEST-LIMIT`)를 같은 인터페이스로 추상화. `LICENSE_PROVIDER=mock`이면서 `ENVIRONMENT=production`이면 서버가 요청 처리 시점에 즉시 에러를 던지도록 코드로 강제됩니다. |
| `server/src/services/d1Repository.js` / `tests/helpers/memory-repository.js` | 같은 `LicenseRepository` 인터페이스의 두 구현. 자동 테스트는 메모리 구현으로 실행되며(D1/Miniflare 없이도 빠르고 결정적), 실제 D1 구현은 이 저장소 환경에서 자동 테스트로 검증되지 않았음을 명시합니다(실 배포 후 수동 확인 필요). |
| `server/migrations/0001_init.sql` | D1 스키마: `licenses`, `license_instances`, `webhook_events`, `rate_limit_events`. |

### D1에 저장하는 것 / 저장하지 않는 것

- **저장**: 라이선스 키의 해시(`license_key_hash`, SHA-256), 세션 토큰의 해시(`session_token_hash`), 설치 ID의 해시(`installation_id_hash`), 라이선스 상태/활성화 한도/사용량/만료일, 웹훅 이벤트의 payload 해시(중복 처리 방지용)와 처리 상태.
- **저장하지 않음**: 라이선스 키 원문, 이메일/사용자 이름 등 개인정보, 설치 ID 원문, 웹훅 전체 payload의 장기 보관.

### 세션 토큰 (라이선스 키를 반복해서 저장하지 않는 이유)

Lemon Squeezy의 라이선스 검증 API는 매번 라이선스 키 원문을 요구하지만, 이 서버는 라이선스 키를
저장하지 않기로 했습니다. 대신 `activate` 성공 시 서버가 무작위 **세션 토큰**을 한 번만 발급하고,
확장 프로그램은 이후 `validate`/`deactivate`에서 라이선스 키 대신 이 세션 토큰만 사용합니다. D1에는
세션 토큰의 해시만 저장되며, 실제 상태 확인은 (Lemon Squeezy를 매번 다시 호출하지 않고) 웹훅으로
갱신되는 D1의 최신 상태를 기준으로 판단합니다.

`license-client.js`는 라이선스 키를 `chrome.storage.local`의 `cloakliLicenseSession`이 아니라
세션 토큰(`sessionToken`)과 마지막 4자리(`licenseKeyLast4`, 표시용)만 저장하며, `activateLicense()`
호출이 끝나는 즉시 라이선스 키 원문은 이 파일의 메모리에서도 더 이상 참조되지 않습니다.

### 확장 프로그램의 요금제 판정 우선순위 (`entitlement.js`)

1. **Developer Pro** (`build-config.js`의 `developerPro`) — 개발 빌드에서만 존재, 항상 최우선.
2. **라이선스 서버 검증 결과** — `license-client.js`가 채운 캐시가 `status: "active"`이고 오프라인
   유예 기간(`offlineValidUntil`) 안이면 네트워크 없이도 Pro로 유지.
3. 그 외에는 항상 **Free**.

### 오프라인 유예 정책

라이선스 서버에 성공적으로 연결해 Pro를 확인한 뒤에는, 짧은 네트워크 단절만으로 바로 Free로
떨어지지 않도록 7일(`OFFLINE_GRACE_PERIOD_MS`)의 유예 기간을 둡니다. `background.js`가 24시간마다
(`LICENSE_REVALIDATE_INTERVAL_MS`, `chrome.alarms`) 백그라운드에서 다시 확인하며, 네트워크 실패는
기존 캐시를 그대로 두고(`offline: true`), 서버가 **명확히** 거부(취소/만료/비활성화)한 경우에만 즉시
Free로 전환합니다. 만료/유예 판단은 서버가 내려준 타임스탬프를 기준으로 하며, 클라이언트 시계를
신뢰하지 않습니다(로컬 시계를 조작해 영구 Pro로 만드는 것을 막기 위함). Developer Pro는 이 정책과
무관하게 항상 최우선으로 적용됩니다.

### 라이선스 키 입력 UI (popup)

팝업의 라이선스 섹션은 세 가지 상태를 명확히 구분해서 보여줍니다.

- **Free**: `현재 요금제: Free` 배지 + `Pro 구매하기` / `라이선스 키 입력` 버튼.
- **라이선스 키 입력**: 기본적으로 비밀번호처럼 마스킹된 입력란(표시/숨기기 토글 가능) + `Pro 활성화`
  버튼. 활성화 요청이 끝나면 입력란의 원문 키도 즉시 지웁니다.
- **License Pro(활성)**: 상태/마지막 확인 시각/라이선스 키의 **마지막 4자리만**(`•••• 1234`) 표시 +
  `라이선스 다시 확인` / `이 기기에서 비활성화`(확인 대화상자 통과 후 실행) 버튼.
- **Developer Pro**: 위 라이선스 섹션 전체(구매/입력/활성 정보)가 표시되지 않습니다 — 실제 결제와
  혼동되지 않도록 구분합니다.

결제 버튼(`Pro 구매하기`)이 여는 URL은 `build-config.js`의 `checkoutUrl` 한 곳에서만 읽으며,
`https://`가 아니면(빈 값 포함) 새 탭을 열지 않고 안내만 표시합니다(`javascript:` 등 다른 스킴은
당연히 거부됩니다). 결제가 끝났다고 자동으로 간주하지 않으며, 사용자가 발급받은 라이선스 키를
직접 입력해야 활성화됩니다(이번 단계에서는 이메일 기반 자동 연동을 만들지 않았습니다).

### 보안 요약

- 모든 비밀값(웹훅 시크릿, Lemon Squeezy Store/Product/Variant ID, 관리자 시크릿)은 Cloudflare
  Worker에만 존재하며, 확장 프로그램 코드에는 어떤 API 키/시크릿/관리자 토큰도 없습니다.
- 웹훅은 원문 바디에 대해 서명(HMAC-SHA256)을 **JSON 파싱 전에** 시간차 공격에 안전한 방식으로
  비교해 검증하며, 서명이 없거나 틀리면 파싱조차 하지 않고 거부합니다.
- 웹훅 이벤트는 payload 해시를 유니크 키로 저장해 중복 처리(재시도)를 안전하게 무시하되, 이전에
  실패한 이벤트는 같은 payload로 재시도해도 다시 처리를 시도합니다(성공 처리된 이벤트만 건너뜁니다).
- CORS는 `ALLOWED_EXTENSION_IDS` 환경변수로 등록한 `chrome-extension://` origin만 허용하며, `*`는
  운영 환경에서 절대 쓰지 않습니다. Origin만으로 신뢰하지 않고, 실제 라이선스/세션 검증도 항상
  함께 수행합니다.
- 활성화/검증 요청에는 설치 단위·IP 단위 요청 빈도 제한(rate limit)이 있어, 무차별 대입으로 라이선스
  키를 추측하거나 서버를 과도하게 호출하는 것을 어렵게 합니다.
- 개발용 `MockLicenseProvider`(고정 테스트 키 3개)는 `ENVIRONMENT=production`에서 사용하면 서버가
  즉시 에러를 던지도록 코드로 강제되어 있으며, 이는 서버 유닛 테스트와 HTTP 레벨 통합 테스트 양쪽에서
  확인했습니다.

### 아직 만들지 않은 것 (이번 단계 범위 밖)

이메일 로그인/자체 회원가입/비밀번호 저장, Google 로그인, 자동 계정 연동(결제 후 이메일로 자동 활성화),
팀/좌석(seat) 관리 UI, 쿠폰 관리, 자체 카드 결제 폼, 확장 프로그램 안의 관리자 화면, 분석/광고
추적, 사용자 행동 추적, 화면 콘텐츠 수집/전송은 이번 단계에서 만들지 않았습니다.

### 실제로 연결하려면

이 저장소에는 실제 Lemon Squeezy/Cloudflare 계정 정보가 전혀 없습니다. [server/SETUP.md](server/SETUP.md)에
클릭 단위로 정리된 순서(Lemon Squeezy 스토어/상품/웹훅 생성 → Cloudflare Workers/D1 생성/배포 →
`build-config.js`에 실제 서버 주소/결제 URL 입력)가 있으며, 이 문서의 절차를 실제로 따르기 전까지는
계속 Free로만 동작합니다(의도된 안전한 기본값입니다).

## 가림 적용 범위

요소를 클릭하면 저장 전에 세 가지 범위 중 하나를 선택합니다.

| 범위 | 설명 | 저장되는 형태 |
|---|---|---|
| **이 요소만** | 지금 선택한 요소 하나에만 적용됩니다. 페이지 구조가 바뀌면 다시 적용되지 않을 수 있습니다. | `scope: "element"` |
| **현재 페이지의 같은 종류 모두** | 지금 페이지와 같은 "페이지 유형"(URL의 query/hash를 뺀 경로)에서, 같은 구조를 가진 요소를 전부 가립니다. | `scope: "page"`, `pagePattern`에 정규화된 경로 저장 |
| **이 사이트의 같은 종류 모두** | 이 사이트(hostname) 전체에서, URL과 관계없이 같은 역할의 요소가 나타날 때마다 가립니다. | `scope: "site"` |

`현재 페이지의 같은 종류 모두` / `이 사이트의 같은 종류 모두`를 고르기 전에, 몇 개의 요소가 가려질지 버튼에 "(N개)"로 미리 표시되고 해당 요소들에 점선 outline이 잠깐 표시됩니다(저장 전 미리보기일 뿐이며, 취소하면 즉시 사라집니다).

**(7단계)** 무료(Free) 상태에서는 `현재 페이지의 같은 종류 모두` / `이 사이트의 같은 종류 모두` 버튼에 `PRO` 배지가 표시됩니다. 버튼 자체는 숨기지 않지만, 클릭해도 저장되지 않고 Pro 안내만 표시됩니다(자세한 내용은 "요금제(Free / Pro / Developer Pro)" 섹션 참고). Pro/Developer Pro 상태에서는 배지 없이 기존과 동일하게 동작합니다.

### YouTube 예시

YouTube에서 영상 제목을 클릭해 `이 사이트의 같은 종류 모두`로 저장하면:

- 지금 보고 있는 영상의 제목이 즉시 가려집니다.
- 다른 영상으로 이동해도(새로고침 없이) 그 영상의 제목이 자동으로 가려집니다.
- 저장되는 것은 "제목처럼 보이는 요소의 구조(태그+class 등)"일 뿐, 실제 영상 제목 텍스트나 영상 ID는 저장되지 않습니다.

다만 YouTube 같은 사이트는 DOM 구조가 자주 바뀌고, 페이지에 따라 제목 요소의 class 구성이 다를 수 있습니다. 일반화 selector 생성이 항상 성공한다고 보장하지 않으며, 실패하면(또는 범위가 너무 넓으면) 해당 버튼이 비활성화되고 이유가 함께 표시됩니다. 이런 경우 `이 요소만`으로 저장하거나 다른 요소를 다시 선택해야 합니다. Cloakli는 YouTube 전용 selector를 코드에 미리 넣어두지 않으며, 어떤 사이트에서도 같은 일반화 로직을 사용합니다.

## 저장 규칙 관리

팝업의 `저장된 가림 관리` 버튼을 누르면, 현재 활성 탭의 hostname을 함께 담아 설정 페이지(`options.html`)를 새 탭으로 엽니다. 설정 페이지에서는:

- **사이트별 규칙 목록**: hostname, 저장 규칙 개수, 각 규칙의 selector(일부만 표시하고 전체는 마우스를 올리면 title 툴팁으로 확인 가능)/가림 방식/생성일을 카드 형태로 보여줍니다.
- **규칙 하나만 영구 삭제**: 각 규칙 옆의 `삭제` 버튼. 확인창(`이 가림 규칙을 영구 삭제하시겠습니까?`)을 거칩니다.
- **사이트 전체 삭제**: 카드 하단의 `이 사이트의 규칙 전부 삭제` 버튼. 확인창에 규칙 개수를 함께 보여줍니다.
- **모든 규칙 초기화**: 페이지 맨 아래의 위험 버튼(`모든 저장 규칙 초기화`). 강한 경고 문구가 있는 확인창을 거치며, Cloakli의 가림 규칙 데이터(`cloakliRules` key)만 삭제하고 다른 데이터는 건드리지 않습니다.
- **빈 상태 안내**: 저장된 규칙이 하나도 없으면 "아직 저장된 가림 규칙이 없습니다"라는 안내만 보여주고 오류 없이 정상 동작합니다.

설정 페이지를 열지 않고 팝업이 열려 있는 웹페이지에서 `가릴 영역 선택`을 계속 사용해 규칙을 추가하는 것도 그대로 가능합니다.

## 현재 화면 임시 해제 / 사이트 일시중지 / 영구 삭제의 차이

이름이 비슷해 보이는 세 기능은 적용 범위와 유지 기간이 서로 다릅니다.

```text
현재 화면 가림만 잠시 해제 (popup)
→ 현재 탭·현재 화면에만 적용
→ 저장 규칙 유지
→ 새로고침하거나 다른 URL로 이동하면 다시 적용됨 (저장되지 않는 임시 상태)

현재 사이트 가림 일시중지 (popup)
→ 해당 hostname 전체에 적용 (탭이나 화면 단위가 아님)
→ 저장 규칙 유지
→ 새로고침해도, 다른 페이지로 이동해도 계속 유지됨
→ 사용자가 '다시 시작'을 누를 때까지 계속 켜져 있음

저장된 가림 관리에서 삭제 (options)
→ 저장 규칙 자체를 영구적으로 제거
→ 새로고침해도, 일시중지를 풀어도 다시 나타나지 않음
```

`현재 화면 가림만 잠시 해제`는 "지금 화면 공유 중에 잠깐만 다시 보이고 싶다" 같은 상황에, `현재 사이트 가림 일시중지`는 "이 사이트에서는 당분간 자동으로 가리지 않았으면 좋겠다"는 상황에 씁니다. 둘 다 저장된 규칙 자체는 전혀 건드리지 않으며, 규칙을 완전히 지우려면 반드시 설정 페이지의 삭제 기능을 사용해야 합니다.

## 사이트 단위 일시중지 동작 방식

가림 규칙 데이터(`cloakliRules`)와 완전히 분리된 별도의 `chrome.storage.local` key(`cloakliPausedHostnames`)에 `{ hostname: true, ... }` 형태로만 저장합니다. 실제 URL 전체나 텍스트, 개인정보는 저장하지 않고 hostname과 `true`만 남습니다.

popup의 `현재 사이트 가림 일시중지` 버튼은 content script에 메시지를 보내지 않고 이 storage 값을 직접 바꿉니다. `content.js`는 이미 규칙 삭제 동기화에 쓰던 것과 같은 `chrome.storage.onChanged` 리스너로 이 key의 변경도 함께 구독하고 있어서(중복 구현 없이), 저장하는 즉시 열려 있는 페이지에도 반영됩니다.

- **일시중지 시**: 현재 화면의 Cloakli 가림을 모두 제거하고, 이후 `MutationObserver`/SPA URL 변경으로 규칙을 다시 불러오려 할 때마다 hostname이 일시중지 상태인지 먼저 확인해 저장 규칙을 불러오지도 않습니다.
- **다시 시작 시**: 저장 규칙을 즉시 다시 불러와 적용합니다.
- **새로고침/페이지 이동**: content script가 새로 시작될 때마다 이 storage 값을 다시 읽으므로, 일시중지 상태가 그대로 유지됩니다.
- **다른 사이트**: hostname이 다르면 이 값이 바뀌어도 전혀 영향을 받지 않습니다.
- **일시중지 중 직접 선택**: `가릴 영역 선택`으로 사용자가 직접 요소를 고르는 것은 자동 재적용 로직과 별개이므로, 일시중지 중에도 즉시 가려지고 정상적으로 저장됩니다.

## 첫 사용 안내 (onboarding)

처음 설치했거나 아직 안내를 본 적이 없으면(`cloakliOnboardingCompleted`가 저장되어 있지 않거나 `true`가 아니면) 팝업을 열 때 사용 방법 4단계와 `시작하기` 버튼을 먼저 보여줍니다. `시작하기`를 누르면 `chrome.storage.local`에 `cloakliOnboardingCompleted: true`를 저장하고 평소의 팝업 화면으로 전환하며, 이후에는 다시 표시되지 않습니다. 저장값이 없거나 손상되어 있어도 항상 "아직 안 봄"으로 안전하게 처리되어 팝업이 멈추지 않습니다.

언제든 팝업 하단의 `사용 방법 다시 보기`를 누르면 저장된 값과 무관하게 같은 안내 화면을 다시 볼 수 있습니다.

## 키보드 단축키

`manifest.json`의 `commands`로 다음 두 단축키를 등록했습니다.

| 동작 | 명령 이름 | 기본 단축키 | Mac |
|---|---|---|---|
| 가릴 영역 선택 시작 | `start-selection` | `Ctrl+Shift+H` | `Command+Shift+H` |
| 현재 화면 가림 잠시 해제 | `temporarily-clear-page` | `Ctrl+Shift+U` | `Command+Shift+U` |

단축키를 누르면 `background.js`(서비스 워커)가 `chrome.commands.onCommand`로 이를 받아, popup 버튼과 완전히 같은 메시지(`START_SELECTION_MODE`/`CLEAR_ALL_MASKS`)를 보냅니다. 이 "탭을 찾고 content script를 주입하고 메시지를 보내는" 로직은 `tab-actions.js` 하나에만 구현되어 있어, popup과 단축키가 같은 함수(`TabActions.dispatchCloakliMessage`)를 공유하고 중복 코드가 없습니다.

다른 확장 프로그램이나 브라우저 자체 단축키와 겹칠 수 있으므로, `chrome://extensions/shortcuts` 페이지에서 언제든지 원하는 키 조합으로 바꿀 수 있습니다. 지원하지 않는 페이지(`chrome://` 등)에서 단축키를 눌러도 오류 없이 조용히 무시됩니다(팝업이 열려 있지 않아 안내 메시지를 보여줄 화면이 없기 때문입니다).

## 안내 메시지(toast) 통일

웹페이지 위에 표시되는 모든 안내 메시지는 `content.js`의 `showCloakliToast(text, type)` 하나로 통일했습니다. `type`은 `success`/`info`/`warning`/`error` 중 하나이며(그 외 값은 자동으로 `info` 취급), 왼쪽 강조선 색상으로만 구분해 텍스트를 읽지 않아도 성격을 알 수 있게 했습니다. 다음 상황에서 사용합니다.

- 규칙 저장 성공(`success`), 중복 규칙(`info`), 이미 사이트 규칙에 포함됨(`info`)
- 일반화 selector가 너무 넓어 저장하지 않음(`warning`), 저장 자체 실패(`error`)
- 지원하지 않는 페이지 안내는 content script가 실행되지 않는 페이지이므로 popup의 상태 패널/상태 메시지로 표시합니다.
- 사이트 일시중지(`info`) / 다시 시작(`info`)
- 현재 화면 임시 해제(`info`)
- 저장 규칙 삭제로 인한 화면 동기화(`info`)

toast는 DOM 요소 하나를 계속 재사용하므로 동시에 여러 개가 쌓이지 않고, 새 안내가 오면 이전 안내를 즉시 대체합니다. 몇 초 후 자동으로 사라지며, Cloakli 자체 UI로 분류되어 있어 선택 대상이나 `MutationObserver` 처리 대상에서 제외됩니다.

## 지원하지 않는 페이지

`chrome://`, `edge://`, `about:`, Chrome 웹스토어, 새 탭 페이지, 브라우저 설정 페이지, 일부 내장 PDF 뷰어 등에서는 content script가 아예 실행되지 않습니다. `tab-actions.js`가 URL 패턴으로 이런 페이지를 먼저 걸러내므로, popup이나 단축키에서 시도해도 `chrome.runtime.lastError`나 탭 메시지 전송 오류가 콘솔에만 남고 조용히 무시되는 대신, popup에는 "이 페이지에서는 Cloakli를 사용할 수 없습니다. 일반 웹사이트에서 다시 시도해 주세요." 같은 문구가 표시됩니다. 이 경우에도 popup 전체가 멈추거나 버튼이 영구적으로 비활성화되지 않습니다.

## 동적 사이트 대응 (3단계에서 새로 추가)

Cloakli는 두 가지 방식을 함께 사용해, 페이지 전체 새로고침 없이 바뀌는 콘텐츠에도 저장된 규칙을 다시 적용합니다.

1. **`MutationObserver`**: 문서에 새로 추가되는 요소를 감지해, 저장된 selector와 일치하는 요소가 새로 나타나면 자동으로 가립니다. 늦게 로딩되는 요소, 무한 스크롤로 추가되는 요소에도 적용됩니다.
2. **SPA URL 변경 감지**: `history.pushState`/`replaceState`를 감싸고, `popstate`/`hashchange` 이벤트를 들어, 새로고침 없이 URL만 바뀌는 이동(예: YouTube 영상 전환, Gmail 메일함 이동, Notion 페이지 이동)을 감지해 규칙을 다시 적용합니다.

**지원 예시**
- YouTube에서 다른 영상 클릭 / 검색 결과에서 영상 상세로 이동
- Gmail에서 다른 메일 열기 / 받은편지함과 검색 결과 사이 이동
- Notion에서 다른 페이지로 이동
- 늦게 로딩되어 나중에 나타나는 요소
- 무한 스크롤로 새로 추가되는 요소

이 기능은 완전한 지원을 보장하지 않습니다. 사이트 구조나 렌더링 방식에 따라 일부 상황에서는 재적용되지 않을 수 있습니다(아래 "알려진 제한사항" 참고).

## Observer 동작 방식

- `document.documentElement`를 대상으로 `{ childList: true, subtree: true }`만 관찰합니다. `attributes`/`characterData`는 관찰하지 않아, 마우스 hover로 인한 class 토글 같은 변화에는 반응하지 않습니다.
- DOM 변경이 감지되면 즉시 규칙을 재적용하지 않고, **300ms debounce**로 재적용을 예약합니다(`scheduleRuleApplication`). 짧은 시간에 여러 번 변경이 발생해도 마지막 변경 이후 한 번만 실제로 적용됩니다.
- 관찰 콜백은 먼저 두 가지를 확인해 불필요한 작업을 피합니다.
  - 현재 사이트에 저장된 규칙이 0개라면(`ruleCountCache === 0`) 아무 작업도 하지 않습니다.
  - 이번 변경이 전부 Cloakli 자신이 만든 요소(가림 레이어, 안내 바, 토스트 등)에 대한 것이라면 무시합니다. 그렇지 않으면(=웹사이트 자체의 변경이라면) 재적용을 예약합니다.
- 실제 재적용(`applyStoredRules`)은 이미 가려진 요소를 건드리지 않고 건너뛰므로, 같은 요소에 가림 레이어가 중복 생성되지 않습니다.
- observer 콜백과 재적용 로직은 모두 `try/catch`로 감싸, 하나의 오류가 확장 프로그램 전체를 중단시키지 않습니다.

## URL 변경 감지 방식

- `history.pushState`와 `history.replaceState`를 각각 감싸서, 원래 함수를 호출한 뒤(인자와 반환값을 그대로 전달) URL 변경 감지 로직을 추가로 실행합니다. 원래 사이트의 동작(라우팅 등)은 그대로 유지됩니다.
- `window`에 `popstate`, `hashchange` 리스너를 등록해 뒤로가기/앞으로가기, 해시 변경도 함께 감지합니다.
- URL이 실제로 바뀐 경우에만(`location.href`를 이전 값과 비교) 동작하며, 짧은 시간 안에 여러 번 호출되어도 300ms debounce로 한 번만 재적용됩니다.
- URL 변경 시 **기존 가림 레이어를 무조건 지우지 않습니다.** 저장된 규칙을 다시 불러와 현재 문서에 존재하는 대상만 가리는 방식이라, 이미 가려져 있던 요소는 그대로 두고 새로 나타난 대상만 추가로 가립니다.

## 일시 해제 동작 (`현재 화면 가림만 잠시 해제`)

- 버튼을 누르면 화면의 Cloakli 가림(레이어/클래스/래퍼)만 제거하고, `chrome.storage.local`의 저장 규칙은 전혀 건드리지 않습니다.
- 동시에 현재 탭의 메모리 상태(`isTemporarilyDisabled`)를 켜서, 같은 페이지에 머무는 동안은 observer나 URL 변경 감지가 방금 해제한 화면을 즉시 다시 가리지 않도록 합니다. (서버나 데이터베이스가 아닌, content script의 메모리 변수로만 관리합니다.)
- 이 상태는 탭이 유지되는 동안만 존재하며, 페이지를 새로고침하거나(내용 새로 로드) SPA 내부에서 URL이 바뀌면 자동으로 해제되어, 저장 규칙이 다시 정상적으로 적용됩니다.
- 사이트 단위 일시중지(`isHostPaused`, 앞의 "사이트 단위 일시중지 동작 방식" 참고)와는 완전히 별개의 상태로 관리됩니다.

## 삭제/일시중지 후 화면 동기화 방식 (`chrome.storage.onChanged`)

설정 페이지에서 규칙을 삭제하거나 popup에서 사이트를 일시중지해도, 이미 열려 있는 웹페이지의 화면에는 가림이 그대로 남아 있을 수 있습니다. 이를 해결하기 위해 `content.js`가 `chrome.storage.onChanged`를 구독하며, `cloakliRules`(저장 규칙)와 `cloakliPausedHostnames`(일시중지 상태) 두 key를 각각 독립적으로 처리합니다.

**규칙 변경(`cloakliRules`) 처리**

1. 변경된 key가 Cloakli의 저장 키(`cloakliRules`)가 아니면 무시합니다. (다른 확장의 storage 변경과 섞이지 않습니다.)
2. 변경 전/후 값에서 **현재 페이지의 hostname에 해당하는 규칙 배열만** 비교합니다. 다른 사이트의 규칙만 바뀐 경우(다른 탭에서의 삭제 등)에는 이 페이지에서 아무 것도 하지 않습니다.
3. 현재 사이트의 규칙 목록이 실제로 달라졌다면, 이 페이지의 Cloakli 가림을 모두 제거한 뒤(`removeAllCloakliMasks`, 웹사이트 자체 클래스·스타일은 건드리지 않음) 남아 있는(=삭제되지 않은) 규칙만 다시 적용합니다(`applyStoredRules`).
4. 삭제된 규칙에 해당하던 가림은 자연히 사라지고, 남은 규칙에 해당하는 가림은 다시 나타납니다. `maskElement`가 이미 가려진 요소를 건너뛰므로 중복 레이어는 생기지 않습니다.

**일시중지 변경(`cloakliPausedHostnames`) 처리**

1. 변경 전/후 값에서 **현재 hostname의 일시중지 여부만** 비교합니다. 다른 사이트의 일시중지만 바뀐 경우 아무 것도 하지 않습니다.
2. 새로 일시중지되었으면 현재 화면의 가림을 모두 제거합니다. 다시 시작되었으면 저장 규칙을 즉시 재적용합니다.

두 리스너 모두 `window.__cloakliContentLoaded` 플래그로 스크립트 전체가 한 번만 실행되는 것과 함께 한 번만 등록되며, 콜백 내부는 `try/catch`로 감싸 오류가 확장 프로그램을 중단시키지 않습니다. 페이지 전체를 새로고침하지 않고, DOM 조작만으로 화면을 갱신합니다.

## 성능

- 모든 재적용은 **300ms debounce**를 거칩니다. YouTube, Gmail처럼 DOM 변경이 잦은 사이트에서도 초당 최대 3~4회 이하로만 규칙 재적용 함수가 호출됩니다.
- 저장된 규칙이 없는 사이트에서는 DOM 변경이 감지되어도 재적용 예약 자체를 하지 않습니다.
- Cloakli가 스스로 추가한 요소(가림 레이어, 안내 바, 토스트)로 인한 DOM 변경은 재적용을 다시 트리거하지 않도록 걸러냅니다. (그렇지 않으면 "가림 → DOM 변경 감지 → 재적용 → DOM 변경 감지 → …" 형태로 반복될 수 있습니다.)
- 이미 가려진 요소는 `maskElement` 내부에서 즉시 건너뛰므로, 같은 요소를 반복해서 다시 감싸거나 레이어를 다시 만들지 않습니다.

## 자동 테스트

Chrome을 직접 열지 않고도 핵심 로직을 검증할 수 있도록 Node의 내장 테스트 러너(`node:test`)로 자동 테스트를 작성했습니다. **외부 테스트 프레임워크나 jsdom 같은 라이브러리를 설치하지 않았습니다** — `package.json`에는 `npm test` 스크립트 하나만 있고 의존성은 0개입니다.

**실행 방법**

```
npm test
```

(내부적으로 `node --test --test-concurrency=1 tests/content-core.test.js tests/entitlement.test.js tests/content-integration.test.js tests/tab-actions.test.js tests/popup.test.js tests/regression.test.js tests/build.test.js`를 실행합니다. `--test-concurrency=1`은 파일들이 동시에 실행되며 서로 리소스를 다퉈 타이밍이 흔들리는 것을 막기 위함입니다. Node 18 이상이면 `node:test`를 바로 사용할 수 있습니다.)

**파일 위치**

| 파일 | 역할 |
|---|---|
| `tests/content-core.test.js` | `content-core.js`의 순수 함수 73개 테스트(디바운스/URL 판별/규칙 중복·삭제·마이그레이션/Cloakli UI 판별/규칙 적용 오케스트레이션/일시 해제 상태 전환/page pattern 정규화/scope 적용 판별/일반화 selector 안전성 검사/사이트 일시중지 조회/toast 종류 정규화). DOM/`chrome.*` 없이 즉시 실행됩니다. |
| `tests/entitlement.test.js` | `entitlement.js`의 순수 함수 40개 테스트: 개발자 모드 켜짐/꺼짐/손상된 값 처리, `isProUser` 안전 처리, `computeUsage`(손상된 데이터·중복 규칙 처리 포함), `canCreateRule`의 무료 규칙 수/hostname/scope 제한 전 조합, Pro/Developer Pro에서 모든 scope 허용, popup/options에 표시할 문구 생성, `getEntitlementState()`가 `build-config.js`의 `developerPro` 값과 항상 일치하는지까지 확인합니다. |
| `tests/content-integration.test.js` | `content.js`를 실제로 한 줄도 바꾸지 않고 Node의 `vm` 모듈로 실행해, `MutationObserver`/SPA URL 감지/일시 해제/storage 동기화/선택 모드/범위 선택 UI/일반화 selector 생성/scope별 적용/사이트 단위 일시중지/무료 한도 차단과 임시 가림 롤백까지 61개로 검증합니다. |
| `tests/tab-actions.test.js` | `tab-actions.js`(`TabActions`) 10개 테스트. 지원하지 않는 URL 판별, 탭을 찾지 못하거나 스크립트 주입이 실패하는 경우 항상 `unsupported`로 안전하게 처리되는지, 정상 경로에서는 content script를 주입한 뒤 메시지를 보내고 응답을 그대로 돌려주는지 확인합니다. **(9단계 신규)** `CONTENT_SCRIPT_FILES`가 `content-core.js`/`build-config.js`/`entitlement.js`/`content.js` 4개를 정확한 순서로 포함하고, `manifest.json`의 `content_scripts.js`와 항상 같은지 확인합니다(이 버그의 재발 방지 테스트). |
| `tests/popup.test.js` | **(9단계 신규)** `popup.js`를 실제로 한 줄도 바꾸지 않고 Node의 `vm` 모듈로 실행해 12개 테스트로 검증합니다: 버튼 클릭 시 활성 탭 조회/content script 주입(4개 파일 모두 포함)/`START_SELECTION_MODE` 메시지 전송/성공 안내 표시, 메시지 전송 실패 시 구체적인 안내와 버튼 재활성화, 지원하지 않는 페이지 안내, development/production 빌드에 따른 DEV BUILD 배지 표시 여부, storage로는 배지를 켤 수 없음, development에서만 개발 오류 코드가 추가로 표시되고 production에서는 내부 오류 내용이 노출되지 않음, build-config.js가 빠져도 조용히 멈추지 않음. |
| `tests/regression.test.js` | `manifest.json` 유효성(단축키 `commands` 포함), 필요한 파일 존재, popup/content/background 메시지·명령 이름 일치, popup/options HTML 기본 구조, 외부 네트워크·CDN·`eval` 미사용, `CloakliEntitlement` 단일 사용, 무료 한도 숫자 중복 정의 여부, 결제 관련 키워드/가격 표시 여부, `content-core.js → build-config.js → entitlement.js → content.js` 로드 순서, `build-config.js`의 기본 `developerPro`/`debug`가 false인지까지 75개 정적 점검을 합니다. |
| `tests/build.test.js` | 빌드/검증/ZIP 스크립트 36개 테스트: development 빌드가 소스의 `build-config.js`를 그대로 복사하는지, production 빌드가 `developerPro`/`debug`/`mode`를 항상 강제하는지, 필수 파일이 모두 존재하고 tests/node_modules/package.json/README가 없는지, `validate-release.js`가 Developer Pro 유출·`debugger`·`fetch`·원격 스크립트·금지 파일·깨진 manifest·존재하지 않는 아이콘·불필요한 권한을 각각 잡아내는지(`console.log`는 경고만 남기는지), ZIP이 실제로 생성되고 최상단이 `manifest.json`이며 금지 폴더가 없는지, 빈 폴더는 ZIP으로 만들 수 없는지 확인합니다. **(9단계 신규)** development manifest의 name/description이 `Cloakli DEV`/`[개발 빌드]`인지, production은 개발 문구가 전혀 없는지, DEV BUILD 배지·배너 마크업이 production에서 완전히 제거되는지, manifest name 유출·스크립트 순서 오류·필수 파일 누락 시 `validate-release.js`가 실패하는지까지 확인합니다. 실제 프로젝트의 `dist/`/`releases/`는 건드리지 않고 매번 임시 폴더에서 검증합니다. |
| `tests/helpers/fake-dom.js`, `tests/helpers/fake-browser-env.js` | 테스트 전용 최소 DOM/`chrome.*` 모의 구현. 실제 확장 프로그램 코드에는 포함되지 않습니다. |
| `tests/helpers/fake-popup-env.js` | **(9단계 신규)** popup.js 전용 테스트 환경. popup.html을 파싱하지 않고 popup.js가 참조하는 모든 id를 프로그램적으로 동일하게 구성한 뒤, 실제 popup.js 소스를 vm으로 실행한다. |
| `tests/fixtures/dynamic-page.html` | 사람이 직접 브라우저로 열어, 늦게 나타나는 요소/AJAX 교체/`pushState`/hash 변경/무한 스크롤 등을 눈으로도 확인해볼 수 있는 보조 페이지 (자동 테스트는 이 파일을 직접 로딩하지 않고, 같은 상황을 가짜 DOM으로 재현합니다). |

**검사하는 주요 기능**

- 저장된 selector와 일치하는 새 요소 자동 가림 / 불일치 요소는 무시
- 같은 요소·같은 selector에 중복 가림 레이어가 생기지 않음
- 잘못된 selector 하나가 있어도 나머지 규칙은 계속 적용됨
- 300ms debounce로 재적용 함수가 과도하게 호출되지 않음, Cloakli 자신의 DOM 변경은 재적용을 트리거하지 않음
- `pushState`/`replaceState`/`popstate`/`hashchange` 각각의 URL 변경 감지와 실제 URL이 안 바뀌면 재적용하지 않는지
- "현재 화면 가림만 잠시 해제" 이후 같은 URL에서는 재적용되지 않고, URL이 바뀌면 다시 적용되는지
- `chrome.storage.onChanged`로 규칙 하나 삭제 시 그 가림만 사라지고 나머지는 유지되는지, 다른 사이트 변경은 무시되는지, 이벤트가 반복 처리되지 않는지
- 선택 모드 중 DOM 변경이 있어도 선택 모드가 강제 종료되지 않는지, 선택 완료 후 저장/가림이 정상 동작하는지
- content script가 같은 문서에서 여러 번 실행되어도 `MutationObserver`/메시지 리스너/`storage.onChanged` 리스너가 하나만 등록되는지
- `manifest.json` 문법, 필요한 파일 존재, 메시지·명령 이름 일치, 외부 네트워크 요청/CDN/`eval` 미사용
- 요소 클릭 후 범위 선택 UI가 뜨고, 즉시 저장되지 않는지 / 취소·ESC 시 아무것도 저장되지 않는지 / picker 자신이 선택 대상이 되지 않는지 / 완료 후 picker의 리스너가 남지 않는지
- 일반화 selector가 같은 종류의 여러 요소를 정확히 찾는지 / 무작위 해시 class와 `nth-of-type`/`nth-child`가 절대 포함되지 않는지 / 한정자를 못 찾으면 범위 버튼이 비활성화되는지
- `element`/`page`/`site` 규칙이 각각 올바른 조건에서만 적용되는지, 다른 hostname에는 적용되지 않는지, SPA 이동 후 `page` 규칙은 재평가되고 `site` 규칙은 계속 적용되는지
- **사이트 일시중지 시 자동 적용이 중단되고 기존 가림이 제거되는지, 다시 시작하면 즉시 재적용되는지, 다른 hostname에는 영향이 없는지, 새로고침(스크립트 재시작)에 해당하는 상황에서도 유지되는지, 규칙 삭제 데이터와 분리되어 있는지, 일시중지 중에도 직접 선택은 허용되는지**
- **`TabActions.dispatchCloakliMessage`가 탭 없음/지원 안 함/스크립트 주입 실패/정상 케이스를 모두 안전하게 처리하는지**
- **manifest의 `commands` 두 개가 `background.js`의 처리 이름과 정확히 일치하는지, popup.js와 background.js가 같은 함수를 호출하는지(중복 로직 없음)**
- **(7단계) 무료 상태에서 규칙이 0~2개면 저장이 허용되고 3개면 4번째가 차단되는지, 삭제로 개수가 줄면 다시 허용되는지, 손상된 규칙 데이터는 개수에서 안전하게 제외되는지**
- **(7단계) 무료 상태에서 첫 hostname은 허용되고 다른 hostname은 차단되는지, 첫 hostname의 규칙을 모두 지우면 다른 hostname이 허용되는지**
- **(7단계) 무료 상태에서 `page`/`site` 범위 선택 시 저장되지 않고 Pro 안내가 표시되며, 범위 선택 UI가 닫히지 않고 그대로 열려 있는지**
- **(7단계) Pro/Developer Pro 상태에서는 hostname/규칙 개수 제한 없이 저장되고, 범위 선택 UI에 `PRO` 배지가 표시되지 않는지**
- **(7단계) 무료 상태에서도 기존에 저장되어 있던 page/site 규칙은 계속 적용되고, 삭제/관리 기능은 요금제와 무관하게 동작하는지**
- **(7단계) `entitlement.js` 밖에서 Pro 여부를 직접 판단하거나 storage에 `isPro`를 저장하는 코드가 없는지, 결제 관련 키워드/가격 표시가 없는지**
- **(8단계) development 빌드가 `build-config.js`를 그대로 복사하는지, production 빌드가 `developerPro`/`debug`를 항상 false로, `mode`를 `"production"`으로 강제하는지, production 빌드에서 `entitlement.js`가 항상 free를 돌려주는지**
- **(8단계) production 빌드에 필수 파일이 모두 있고 tests/node_modules/package.json/README가 없는지, manifest가 참조하는 모든 파일이 실제로 존재하는지**
- **(8단계) `validate-release.js`가 Developer Pro 유출·`debugger`·`fetch`·원격 스크립트·금지 파일·깨진 manifest·존재하지 않는 아이콘·불필요한 권한을 각각 실패로 잡아내고, `console.log`는 경고만 남기는지**
- **(8단계) ZIP이 실제로 생성되고 최상단이 `manifest.json`이며 `tests/`/`node_modules/`/`dist/` 폴더가 섞여 있지 않은지, 파일명에 버전이 포함되는지, 빈 폴더는 ZIP으로 만들 수 없는지**

**실제 사이트 UI에 대한 한계**: 이 자동 테스트는 YouTube/Gmail/Notion을 실제로 열지 않고, 그 사이트들이 공통적으로 사용하는 매커니즘(`MutationObserver`로 관찰 가능한 DOM 삽입/삭제, `history.pushState`/`popstate`/`hashchange`)을 최소한의 가짜 브라우저 환경으로 재현해 검증합니다. 실제 사이트의 구체적인 HTML 구조나 렌더링 타이밍까지 완전히 재현하지는 않으므로, 새 버전을 배포하기 전에는 "내가 직접 테스트할 순서"에 따라 실제 브라우저에서 최소 한 번 확인하는 것을 권장합니다.

**popup.js에 대한 한계 (9단계에서 대부분 해소)**: 9단계부터는 `content.js`와 같은 방식으로 `popup.js`도 실제 소스를 한 줄도 바꾸지 않고 Node의 `vm` 모듈로 그대로 실행해(`tests/popup.test.js`), 버튼 클릭 → 활성 탭 조회 → content script 주입 → 메시지 전송 → 상태 메시지 표시까지의 실제 흐름과 DEV BUILD 배지 렌더링을 검증합니다(이번 단계에서 실제로 발견되고 고쳐진 버그도 이 경로에 있었습니다). 다만 popup.html을 실제 HTML 파서로 파싱하지는 않고 필요한 id를 프로그램적으로 재구성했으므로, HTML 마크업 자체의 오타나 CSS 렌더링 문제까지는 잡아내지 못합니다. 온보딩 화면 전환, 실제 `Ctrl+Shift+H`/`Ctrl+Shift+U` 키 입력, `chrome://extensions/shortcuts`에서의 단축키 변경, 실제 픽셀 렌더링은 여전히 이 환경에서 자동으로 실행해 확인하지 못했습니다. 이 부분은 "내가 직접 확인할 최소 사항"으로 안내합니다.

## 이번 버전에서 지원하는 기능

- 팝업에서 선택 모드를 시작/취소하는 UI, 저장 규칙 개수 표시
- 마우스 오버 시 파란 테두리 표시, 십자형 커서
- 요소 클릭 시 즉시 완전 가림 (원래 크기 유지, "HIDDEN" 텍스트 표시)
- 클릭 시 원래 링크/버튼 동작 차단
- ESC 키로 선택 모드 취소
- 선택 모드 반복 실행 시 이벤트 리스너 중복 방지
- 이미 가려진 요소 재선택 시 중복 레이어 방지
- 현재 페이지의 모든 가림을 한 번에 해제 (저장 규칙은 유지, 같은 페이지에서는 즉시 재적용되지 않음)
- `chrome://` 등 지원하지 않는 페이지에서 오류 없이 안내 문구 표시
- 가린 요소를 사이트별로 저장하고, 새로고침/재방문 시 자동으로 다시 가림
- 저장 성공/중복/실패를 웹페이지 위 토스트로 안내
- **(3단계)** `MutationObserver`로 늦게 나타나거나 무한 스크롤로 추가되는 요소에도 저장 규칙 자동 재적용
- **(3단계)** `history.pushState`/`replaceState`/`popstate`/`hashchange` 감지로, 새로고침 없는 SPA 내부 이동에도 저장 규칙 자동 재적용
- **(4단계)** 설정 페이지에서 사이트별 저장 규칙 목록 확인 (selector/가림 방식/생성일)
- **(4단계)** 규칙 하나만 영구 삭제, 확인창을 취소하면 삭제되지 않음
- **(4단계)** 특정 사이트의 규칙 전체 삭제 (다른 사이트 규칙은 유지)
- **(4단계)** 모든 사이트의 모든 규칙 초기화 (Cloakli 데이터만 삭제, 다른 확장 설정에는 영향 없음)
- **(2.5단계)** 삭제 직후 `chrome.storage.onChanged`로 열려 있는 웹페이지의 화면을 즉시 갱신 (새로고침 불필요)
- **(2.5단계)** 저장 규칙이 0개일 때 빈 상태 안내 화면 표시
- **(5단계)** 요소 클릭 후 범위 선택 UI: `이 요소만` / `현재 페이지의 같은 종류 모두` / `이 사이트의 같은 종류 모두` / `취소`, ESC로도 취소 가능
- **(5단계)** "같은 종류 모두"를 위한 일반화 selector 생성(`generateGeneralizedSelector`) — id/nth-of-type/nth-child/실제 텍스트를 사용하지 않음
- **(5단계)** 일반화 selector 저장 전 안전성 검사(0개/50개 초과/너무 흔한 태그/화면의 절반 이상 차지 등을 차단)와 미리보기(개수 표시 + 임시 outline)
- **(5단계)** `scope`(element/page/site)에 따라 규칙이 적용되는 범위를 판별(`doesRuleApplyToCurrentPage`)해, MutationObserver/SPA URL 변경/storage 동기화 모두 같은 기준을 재사용
- **(5단계)** 설정 페이지에서 규칙마다 적용 범위와 (있다면) 페이지 범위(page pattern) 표시
- **(6단계)** 처음 사용하는 사람도 이해할 수 있는 popup 재구성: 상태 패널(hostname/저장 개수/작동 상태), 버튼 구분(기본/보조/조용한 스타일)
- **(6단계)** 사이트 단위 가림 일시중지/다시 시작 (저장 규칙은 유지, 새로고침·페이지 이동 후에도 유지)
- **(6단계)** 첫 사용 안내(onboarding) 화면, `사용 방법 다시 보기`로 언제든 재확인
- **(6단계)** 키보드 단축키 2종 (`Ctrl+Shift+H` 선택 시작, `Ctrl+Shift+U` 화면 임시 해제), `chrome://extensions/shortcuts`에서 변경 가능
- **(6단계)** 모든 안내 메시지를 `showCloakliToast(text, type)` 하나로 통일 (success/info/warning/error)
- **(6단계)** 버튼 중복 클릭 방지, 오류 발생 후에도 버튼이 영구 비활성화되지 않음
- **(6단계)** 설정 페이지에 hostname/selector 검색, 전체 규칙·사이트 개수 요약, 일시중지 상태 배지 추가
- **(7단계)** 무료(Free)/Pro 기능 분리: 무료는 hostname 1개·규칙 3개·element 범위만, Pro는 무제한 + page/site 범위 포함
- **(7단계)** 결제 없이 Pro 기능을 테스트하는 개발자 전용 Developer Pro 모드(`build-config.js`의 소스 코드 상수로만 제어)
- **(7단계)** 단일 권한 판정 모듈(`entitlement.js`)로 popup/options/content가 항상 같은 기준으로 Pro 여부와 사용량을 계산
- **(7단계)** popup/options에 현재 요금제(Free 사용량, Pro 무제한, Developer Pro) 표시와 "Pro 알아보기" 안내 영역 추가
- **(7단계)** 무료 상태에서 page/site 범위 선택 시 저장 대신 Pro 안내 표시(버튼은 숨기지 않고 `PRO` 배지로 표시)
- **(7단계)** 기존에 저장된 page/site 규칙은 무료 상태가 되어도 삭제·비활성화되지 않고 계속 적용
- **(8단계)** 개발 빌드(`dist/development`)와 출시 빌드(`dist/production`)를 명령 하나로 분리 생성(`npm run build:dev`/`build:prod`)
- **(8단계)** 출시 빌드에서 Developer Pro/디버그 로그를 항상 자동으로 강제 비활성화(`build-config.js` 사본 교체)
- **(8단계)** 출시 전 자동 검사(`npm run validate:prod`): manifest 유효성, Developer Pro 유출, 디버그/테스트 코드, 외부 통신, 금지 파일을 모두 확인
- **(8단계)** Chrome Web Store 제출용 ZIP 자동 생성(`npm run package:prod`), 생성 직후 내부 구조를 스스로 재검증하고 크기/SHA-256 해시 출력
- **(8단계)** 번들러(Webpack/Vite/Rollup) 없이 Node 내장 모듈만으로 빌드/검증/ZIP 생성을 구현(새 npm 의존성 0개)

## 저장하는 데이터

Cloakli는 `chrome.storage.local`에만 데이터를 저장합니다. 외부 서버, 데이터베이스, API 전송은 전혀 없습니다. 저장 구조는 이전 단계와 최대한 동일하게 유지했고, 규칙별 `id`(2.5단계)에 이어 5단계에서는 적용 범위를 나타내는 `scope`, `pagePattern` 필드가 추가되었습니다.

**저장하는 정보**
- `id` (규칙별 고유 식별자 — 개별 삭제에 사용)
- `hostname` (예: `www.youtube.com`)
- 생성된 CSS `selector` 문자열 (요소를 다시 찾기 위한 구조적 정보일 뿐, 요소의 실제 내용이 아닙니다)
- `scope` (`"element"` | `"page"` | `"site"` — 적용 범위)
- `pagePattern` (`scope`가 `"page"`일 때만, query/hash를 뺀 정규화된 경로. 그 외에는 `null`)
- 가림 방식(`mode`, 현재는 항상 `"block"`)
- 생성 시각(`createdAt`)

**저장하지 않는 정보**
- 실제 텍스트 내용 (예: 영상 제목, 댓글 내용)
- 이메일 주소, 이름 등 개인정보
- 이미지 자체
- 비밀번호
- 웹페이지 본문 전체
- 화면 캡처/스크린샷
- 영상 ID 등 URL의 콘텐츠별 식별자 (page pattern은 query/hash를 제거하므로 포함되지 않습니다)

### 6단계에서 추가된 저장 key

가림 규칙(`cloakliRules`)과는 완전히 별개인 두 key를 추가했습니다.

- `cloakliPausedHostnames`: `{ "www.youtube.com": true, "mail.google.com": true }` 형태로, 일시중지한 hostname만 저장합니다. 실제 URL 전체나 텍스트, 개인정보는 저장하지 않습니다.
- `cloakliOnboardingCompleted`: `true`/`false` 값 하나만 저장하는 첫 사용 안내 완료 여부입니다.

### 7단계: 요금제(Free/Pro) 상태는 storage에 저장하지 않습니다

`isPro`, `plan` 같은 요금제 상태는 어떤 `chrome.storage.local` key에도 저장하지 않습니다. `entitlement.js`의 `getEntitlementState()`가 매번 소스 코드 상수(`CLOAKLI_DEVELOPER_MODE`)만 보고 즉시 계산하므로, 사용자가 개발자도구로 storage 값을 아무리 바꿔도 Pro가 되는 경로 자체가 없습니다. (`chrome.storage.local.set({ isPro: true })` 같은 코드는 이 프로젝트 어디에도 없으며, 자동 테스트로도 이를 확인합니다.)

### 저장 데이터 구조 예시

```json
{
  "cloakliRules": {
    "mail.google.com": [
      {
        "id": "m5k2x9-ab12cd",
        "hostname": "mail.google.com",
        "selector": "#inbox-preview-3",
        "scope": "element",
        "pagePattern": null,
        "mode": "block",
        "createdAt": 1752300000000
      }
    ],
    "www.youtube.com": [
      {
        "id": "m5k2xa-ef34gh",
        "hostname": "www.youtube.com",
        "selector": "h1.video-title",
        "scope": "site",
        "pagePattern": null,
        "mode": "block",
        "createdAt": 1752300123456
      },
      {
        "id": "m5k2xb-gh56ij",
        "hostname": "www.youtube.com",
        "selector": "ytd-comment-renderer #content-text",
        "scope": "page",
        "pagePattern": "/watch",
        "mode": "block",
        "createdAt": 1752300234567
      }
    ]
  }
}
```

`chrome.storage.local`의 최상위 키 하나(`cloakliRules`)에 `{ hostname: [규칙, ...] }` 형태의 객체를 저장합니다. `popup.js`, `content.js`, `options.js`는 모두 동일한 키 이름(`"cloakliRules"`)을 사용합니다.

### 기존 데이터와의 호환성

2단계에서 저장된 규칙에는 `id`/`scope`/`pagePattern` 필드가 없습니다. `options.js`가 설정 페이지를 열 때마다 저장된 모든 규칙을 훑어, 없는 필드만 채워 넣는 마이그레이션을 수행합니다(`ensureRuleIds` — id가 없으면 새로 부여하고, `scope`가 없으면 `"element"`로, `pagePattern`은 `null`로 채웁니다). `"element"`는 예전 규칙의 실제 동작(하나의 특정 요소를 hostname 안에서 계속 찾아 적용)과 가장 가깝기 때문입니다. 이미 모든 규칙에 필드가 다 있으면 storage에 다시 쓰지 않으므로, 설정 페이지를 여러 번 열어도 중복 데이터가 생기지 않습니다(idempotent). 기존 규칙의 `hostname`/`selector`/`mode`/`createdAt`은 그대로 유지되며, 어떤 규칙도 삭제되거나 초기화되지 않습니다. 새로 저장되는 규칙(5단계 이후)은 저장 시점에 바로 모든 필드를 채워서 저장됩니다.

## 데이터 삭제

모든 가림 규칙은 사용자의 브라우저 안 `chrome.storage.local`에만 저장되며, 외부로 전송되지 않습니다. 설정 페이지(`저장된 가림 관리`)에서 언제든지 다음 단위로 직접 삭제할 수 있습니다.

- 규칙 하나
- 특정 사이트(hostname)의 모든 규칙
- 모든 사이트의 모든 Cloakli 규칙 (한 번에 초기화)

삭제는 모두 `chrome.storage.local`에서 즉시 영구적으로 이루어지며, 별도의 휴지통이나 복구 기능은 없습니다.

## 선택자 생성 방식

### 구체 selector (`이 요소만`)

`content.js`의 `generateStableSelector(element)`가 다음 우선순위로 후보를 시도하고, 문서에서 해당 요소 정확히 하나만 가리키는지(`document.querySelectorAll`로 검증) 확인해 첫 번째로 성공하는 선택자를 사용합니다.

1. 고유한 `id`
2. 안정적인 `data-*` 속성 (`data-testid`, `data-test` 제외)
3. `data-testid`
4. `data-test`
5. `aria-label`
6. `name`
7. 무작위 해시처럼 보이지 않는 class 조합 (CSS 모듈/emotion류의 동적 class는 제외하는 간단한 휴리스틱 사용)
8~9. 위 방법이 모두 실패하면 부모 요소들과의 조합(id/안정적 class/`nth-of-type`)으로 최대 5단계까지 올라가며 경로를 구성

값이 비어 있거나(80자 초과 등) 지나치게 길면 후보에서 제외하고, 만들어진 선택자도 200자를 넘으면 사용하지 않습니다. 끝까지 유일한 선택자를 만들지 못하면(매우 드문 경우) 범위 선택 UI에서 `이 요소만` 버튼이 비활성화되고 "안정적인 가림 규칙을 만들지 못했습니다" 안내가 표시됩니다.

### 일반화 selector (`현재 페이지의 같은 종류 모두` / `이 사이트의 같은 종류 모두`)

`content.js`의 `generateGeneralizedSelector(element)`는 "이 요소 하나"가 아니라 "같은 종류의 요소들"을 가리키는 selector를 만듭니다.

1. 먼저 클릭한 요소 자신에서 태그명 + `data-testid`/`data-component`(값 포함) + `role`(값 포함) + 안정적인 class(최대 2개)를 조합합니다. class/속성 등 "한정자"가 하나라도 있으면 이 조합을 그대로 사용합니다.
2. 조합에 한정자가 전혀 없으면(예: class도 속성도 없는 흔한 `<div>`), 부모 요소로 최대 2단계까지 올라가며 같은 방식으로 한정자를 찾고, 찾으면 `조상 조합 자손 조합` 형태(공백으로 구분되는 후손 선택자)로 만듭니다.
3. 그래도 한정자를 찾지 못하면 `null`을 반환해 저장을 포기합니다.

`id`, `nth-of-type`, `nth-child`, 실제 텍스트, 페이지마다 달라지는 동적 속성은 절대 사용하지 않습니다.

### 일반화 selector 안전성 검사

생성된 일반화 selector는 저장하기 전에 `content-core.js`의 `evaluateGeneralizedSelectorSafety`로 검사합니다. 기준값은 `GENERALIZED_SELECTOR_LIMITS`에 상수로 모아 두었습니다.

| 조건 | 기준 | 이유 |
|---|---|---|
| 일치 개수 | 1~50개만 허용 | 0개는 저장할 이유가 없고, 50개 초과는 "몇 개 요소"를 넘어 페이지 대부분일 가능성이 높다고 봄 |
| selector 길이 | 200자 이하 | 너무 긴 selector는 사이트 구조 변경에 더 취약함 |
| 흔한 단독 태그 | `div`/`span`/`a`/`li`/`p`/`section`/`article`/`td`/`tr`/`img`/`html`/`body` 단독 selector 차단 | class/속성 없이 이 태그들만 쓰면 사실상 페이지 전체에 걸침 |
| 원본 포함 여부 | 사용자가 클릭한 요소가 결과에 포함되어야 함 | 포함되지 않으면 사용자 의도와 다른 요소들을 가리는 것이므로 신뢰할 수 없음 |
| 화면 점유 비율 | 일치 요소들의 면적 합이 뷰포트의 50% 이하 | 개수는 적어도 화면 대부분을 차지하면 사실상 전체 가림과 다르지 않음 |

검사를 통과하지 못하면 해당 범위 버튼이 비활성화되고, 실패 사유에 맞는 안내 문구가 표시됩니다(예: "선택 범위가 너무 넓어 저장하지 않았습니다"). 안전 기준 숫자는 프로젝트 상황에 맞게 조정할 수 있도록 `content-core.js`에 상수로 분리해 두었습니다.

### page pattern 정규화

`content-core.js`의 `normalizePagePattern(url)`은 URL에서 origin/query/hash를 제거하고 pathname만 남깁니다.

```
https://www.youtube.com/watch?v=abc  ->  /watch
https://www.youtube.com/watch?v=xyz  ->  /watch   (다른 영상 ID라도 같은 패턴)
https://mail.google.com/mail/u/0/#inbox/xyz  ->  /mail/u/0/   (해시 제거)
```

query에는 영상 ID/검색어처럼 콘텐츠별로 달라지는 값이, hash에는 SPA 내부 라우팅 정보가 들어있는 경우가 많아 "페이지 유형"을 가르는 기준에서 제외했습니다. 잘못된 형식의 URL이 들어와도 예외를 던지지 않고 `null`을 돌려줍니다.

### scope 적용 판별

`content-core.js`의 `doesRuleApplyToCurrentPage(rule, location)` 하나가 규칙이 현재 위치에 적용되어야 하는지를 판별하며, 초기 로딩/`MutationObserver`/SPA URL 변경/storage 동기화 **모두 이 함수 하나만** 사용합니다(중복 구현하지 않음).

- `element`: hostname만 같으면 통과 (실제 매칭은 `document.querySelectorAll`이 담당)
- `page`: hostname이 같고, 정규화한 현재 URL이 저장 당시의 `pagePattern`과 같아야 통과
- `site`: hostname만 같으면 URL과 무관하게 항상 통과

## 아직 지원하지 않는 기능

- 규칙 이름 변경, 규칙 편집, selector 직접 수정
- JSON 내보내기/가져오기
- URL 패턴별(경로가 아닌 세부 쿼리 기준) 규칙, 사이트 전역/페이지 전용 규칙의 더 세밀한 구분
- blur(흐림) 방식, 흐림 강도 조절, blur/block 선택
- 자동 개인정보 탐지(AI)
- 로그인 / 회원가입 / 이메일 인증
- **실제 결제(Stripe/Lemon Squeezy/Paddle/Gumroad 등)**, 라이선스 서버, 원격 Pro 검증, 웹훅, 구독 해지, 환불 처리, Chrome 웹스토어 결제 (7단계에서는 무료/Pro **기능 차이**만 만들었고, 실제 결제 연동은 아직 없습니다)
- 서버 통신 / 데이터베이스 / 여러 기기 간 동기화(Chrome Sync 포함)
- **Chrome 웹스토어 자동 업로드/제출** (8단계는 제출용 ZIP을 자동으로 만들 뿐, 업로드는 사람이 직접 합니다)
- 모바일 브라우저 지원
- Firefox, Safari 지원 (Firefox/Safari용 별도 패키징도 포함)
- 가림 색상 변경, blur 강도 변경(위와 중복이지만 6단계 기준으로도 명시)
- 분석 도구, 사용자 행동 추적, 외부 오류 수집 서비스, telemetry
- **(8단계에서도 만들지 않음)** manifest `version` 자동 증가, Git 자동 커밋/푸시(이번 단계에서 어떤 git 명령도 실행하지 않았습니다)

## 테스트 방법 (비개발자용)

1. 위의 "Chrome에 로컬 설치하는 방법"을 따라 확장 프로그램을 로드합니다(이미 설치되어 있다면 `chrome://extensions`에서 재로드).
2. 아무 뉴스 사이트나 블로그에 접속해 서로 다른 요소 3개를 `가릴 영역 선택`으로 가립니다. 매번 범위 선택 창이 뜨면 `이 요소만`을 눌러 확정하고, "가림 영역이 저장되었습니다." 토스트가 뜨는지 확인합니다.
3. Cloakli 아이콘을 다시 클릭해, 팝업에 "이 사이트에 저장된 가림: 3개"로 표시되는지 확인합니다.
4. 페이지를 새로고침해, 3개 요소가 자동으로 다시 가려지는지 확인합니다.
5. **YouTube**에 접속해 영상 제목이나 채널명 등 한 요소를 가립니다. 다른 영상을 클릭해 이동한 뒤, 같은 위치(요소)가 다시 가려지는지 확인합니다.
6. **Gmail**에 접속해 메일 목록의 한 항목을 가립니다. 다른 메일을 열었다가 받은편지함으로 돌아와, 가림이 유지/재적용되는지 확인합니다.
7. **Notion**에서 사이드바나 특정 블록을 가립니다. 다른 페이지로 이동했다가 돌아와, 가림이 다시 적용되는지 확인합니다.
8. 위 사이트들에서 스크롤을 내려 새 콘텐츠가 로딩되는 것을 지켜보며, 페이지가 눈에 띄게 느려지지 않는지 확인합니다.
9. 이미 가려진 요소를 다시 선택해도 팝업의 저장 개수가 늘어나지 않는지 확인합니다.
10. `현재 페이지 가림 모두 해제`를 클릭한 뒤, 같은 페이지에 머무는 동안 가림이 즉시 다시 나타나지 않는지 확인합니다.
11. 그 상태에서 새로고침하거나 다른 URL로 이동하면, 저장 규칙에 따라 가림이 다시 적용되는지 확인합니다.
12. 웹페이지 개발자도구 Console에 빨간 오류나 반복되는 로그가 없는지 확인합니다.
13. 개발자도구 `Network` 탭에서 Cloakli로 인한 외부 요청이 없는지 확인합니다(원래 사이트 자체 요청 외에는 없어야 합니다).
14. 규칙을 3개 이상 저장한 사이트를 열어 둔 채로, 팝업의 `저장된 가림 관리`를 눌러 설정 페이지를 엽니다. 해당 사이트로 스크롤/강조되며 저장한 규칙들이 목록에 보이는지 확인합니다.
15. 규칙 하나의 `삭제` 버튼을 누르고 확인창에서 `취소`를 눌러, 규칙이 그대로 남아 있는지 확인합니다.
16. 다시 `삭제`를 누르고 이번엔 `확인`을 눌러, 그 규칙만 목록에서 사라지는지 확인합니다. 원래 열려 있던 웹페이지 탭으로 돌아가, 새로고침 없이도 그 요소의 가림만 사라지고 다른 가림은 그대로인지 확인합니다.
17. 팝업을 열어 저장 규칙 개수가 1 줄어들었는지 확인합니다.
18. `이 사이트의 규칙 전부 삭제`를 눌러 해당 사이트의 남은 규칙을 모두 지우고, 다른 사이트의 규칙 카드는 그대로 남아 있는지 확인합니다.
19. 페이지를 새로고침해, 방금 영구 삭제한 규칙들이 다시 나타나지 않는지 확인합니다(1~2단계의 "영구 삭제 vs 일시 해제" 차이 확인).
20. 다른 사이트에도 규칙이 남아 있는 상태에서 `모든 저장 규칙 초기화`를 누르고 경고 문구를 확인한 뒤 진행해, 모든 사이트 카드가 사라지고 빈 상태 안내가 표시되는지 확인합니다.
21. **YouTube**에서 영상 제목을 클릭해 범위 선택 창에서 `이 사이트의 같은 종류 모두`를 선택합니다. (버튼에 몇 개가 미리보기로 표시되는지, 잠깐 점선 outline이 나타나는지도 확인합니다.) 다른 영상으로 이동해, 그 영상의 제목도 자동으로 가려지는지 확인합니다.
22. 범위 선택 창이 뜬 상태에서 `취소`를 눌러(또는 ESC를 눌러) 아무것도 가려지거나 저장되지 않는지 확인합니다.
23. 설정 페이지에서 방금 저장한 규칙에 적용 범위(`사이트 전체` 등)가 표시되는지 확인합니다.
24. 확장 프로그램을 처음 설치한 상태(또는 `chrome://extensions`에서 데이터를 지우고 다시 로드한 상태)에서 팝업을 열어, 첫 사용 안내(4단계 설명 + `시작하기`)가 뜨는지 확인합니다. `시작하기`를 누르면 평소 화면으로 바뀌고, 팝업을 다시 열어도 안내가 다시 뜨지 않는지 확인합니다.
25. 팝업 하단의 `사용 방법 다시 보기`를 눌러 같은 안내 화면이 다시 보이는지 확인합니다.
26. 아무 사이트에서 `현재 사이트 가림 일시중지`를 누릅니다. 상태가 "이 사이트에서 일시중지됨"으로 바뀌고 화면의 가림이 사라지는지, 새로고침해도 계속 일시중지 상태인지 확인합니다.
27. 같은 자리의 `현재 사이트 가림 다시 시작`을 눌러 가림이 즉시 다시 적용되는지, 다른 사이트의 가림은 영향받지 않았는지 확인합니다.
28. 웹페이지에 포커스를 둔 상태에서 `Ctrl+Shift+H`(Mac: `Command+Shift+H`)를 눌러 선택 모드가 시작되는지 확인합니다. `Ctrl+Shift+U`(Mac: `Command+Shift+U`)로 현재 화면 가림이 잠시 해제되는지도 확인합니다.
29. `chrome://extensions/shortcuts`에서 두 단축키가 표시되는지, 원하는 키로 바꿀 수 있는지 확인합니다.
30. 설정 페이지 검색창에 저장된 사이트의 hostname 일부를 입력해 해당 사이트만 남는지, 관련 없는 검색어를 입력하면 "검색 결과가 없습니다"가 표시되는지 확인합니다.
31. `chrome://extensions`나 새 탭 페이지에서 Cloakli 팝업을 열어, "이 페이지에서는 Cloakli를 사용할 수 없습니다." 안내만 뜨고 팝업이 멈추거나 콘솔에 빨간 오류가 남지 않는지 확인합니다.
32. **(7단계)** 새 사이트에서 서로 다른 요소 3개를 `이 요소만`으로 저장한 뒤, 팝업에 `Free · 규칙 3/3 · 사이트 1/1`처럼 배지가 표시되는지 확인합니다.
33. **(7단계)** 같은 사이트에서 4번째 요소를 선택해 `이 요소만`을 눌러, 저장되지 않고 "무료판에서는 가림 규칙을 최대 3개까지 저장할 수 있습니다." 안내가 뜨는지 확인합니다.
34. **(7단계)** 규칙이 있는 사이트와 다른 사이트에 접속해 새 요소를 선택해 보고, "무료판에서는 1개 사이트에서만 저장 기능을 사용할 수 있습니다." 안내가 뜨며 저장되지 않는지 확인합니다.
35. **(7단계)** 요소를 클릭해 범위 선택 창에서 `현재 페이지의 같은 종류 모두` 또는 `이 사이트의 같은 종류 모두`에 `PRO` 배지가 보이는지, 눌러도 저장되지 않고 Pro 안내만 뜨며 창이 닫히지 않는지 확인합니다.
36. **(7단계)** 팝업과 설정 페이지의 `Pro 알아보기`를 눌러 기능 목록과 "Pro 결제 기능은 출시 준비 중입니다." 문구만 보이고, 결제 화면으로 이동하거나 결제가 진행되지 않는지 확인합니다.
37. **(개발자 전용, 7단계)** [build-config.js](build-config.js)의 `developerPro`를 잠시 `true`로 바꾸고 `npm run build:dev`로 다시 빌드한 뒤 `dist/development`를 새로고침하면, 팝업에 `Developer Pro · 테스트용 Pro 모드`가 표시되고 `page`/`site` 범위 저장과 여러 사이트 사용이 제한 없이 되는지 확인합니다. **확인 후 반드시 다시 `false`로 되돌려야 합니다.**
38. **(8단계)** `npm run build:dev`를 실행해 `dist/development` 폴더가 생성되는지, 그 폴더를 Chrome에 로드하면 지금까지와 동일하게 동작하는지 확인합니다.
39. **(8단계)** `npm run package:prod`를 실행해 테스트 → 빌드 → 검증 → ZIP 생성까지 오류 없이 끝나는지, 마지막에 ZIP 경로/버전/크기/SHA-256 해시가 출력되는지 확인합니다.
40. **(8단계)** 생성된 `releases/cloakli-v<version>.zip`을 아무 압축 프로그램으로 열어(또는 압축 해제해), 최상단에 `manifest.json`이 바로 보이고 `tests`/`node_modules`/`package.json` 같은 폴더나 파일이 없는지 눈으로도 확인합니다.
41. **(8단계)** `dist/production/build-config.js`를 열어 `developerPro: false`, `debug: false`, `mode: "production"`으로 되어 있는지 확인합니다(소스의 `build-config.js`가 아니라 `dist/production` 안의 사본이어야 합니다).
42. **(9단계)** `chrome://extensions`에서 기존에 로드했던 Cloakli(개발본/일반본 모두)를 제거한 뒤, `npm run build:dev`로 새로 만든 `dist/development`를 로드해 확장 이름이 `Cloakli DEV`로 표시되는지 확인합니다.
43. **(9단계)** 일반 웹사이트(예: 뉴스 사이트)에서 팝업을 열어 `가릴 영역 선택`을 누르고, 웹페이지에서 요소를 하나 클릭해 범위 선택 창이 정상적으로 뜨는지 확인합니다(이번 단계에서 고친 버그가 재발하지 않았는지 확인하는 핵심 단계입니다).
44. **(9단계)** 팝업 상단에 `Free`/`Pro` 배지와 별도로 `DEV BUILD` 배지가 표시되는지, 설정 페이지 상단에 `개발 빌드 / 실제 출시용 데이터와 혼동하지 마세요.` 배너가 표시되는지 확인합니다.
45. **(9단계)** `dist/production`을 별도로 로드해(선택 사항) 확장 이름이 `Cloakli`로만 표시되고 `DEV BUILD` 배지나 개발 빌드 배너가 전혀 보이지 않는지 확인합니다.

## 알려진 제한사항

- `chrome://`, Chrome 웹스토어, 새 탭 페이지, Chrome 설정 페이지, 일부 PDF 뷰어 등 Chrome 내부/제한 페이지에서는 동작하지 않습니다 (팝업에 안내 문구만 표시).
- 웹페이지 안의 `iframe`은 Cloakli의 `content_scripts`가 `all_frames`를 지정하지 않아 기본적으로 최상위 문서에만 실행됩니다. 즉 cross-origin은 물론 same-origin `iframe` 내부 콘텐츠까지도 이번 단계에서는 자동으로 관찰/가림 대상이 되지 않습니다. (iframe 요소 자체, 즉 iframe 태그가 차지하는 영역은 최상위 문서 요소로서 가릴 수 있습니다.) iframe이 있어도 확장 프로그램 자체가 중단되지는 않습니다.
- 사이트 구조(HTML)가 바뀌면 저장했던 선택자가 더 이상 그 요소를 찾지 못할 수 있습니다. 이 경우 자동 재적용이 조용히 스킵됩니다(오류는 발생하지 않음).
- 동적으로 생성되는 class(CSS 모듈, emotion, styled-components 등)를 주로 쓰는 사이트에서는, 선택자 생성 단계의 휴리스틱이 이를 걸러내더라도 최종적으로 `nth-of-type` 기반 경로에 의존하게 되어, 사이트 구조가 조금만 바뀌어도 규칙이 깨질 수 있습니다.
- YouTube/Gmail/Notion 같은 대형 SPA는 내부 렌더링 방식이 각기 다르고 자주 바뀌기 때문에, 모든 화면 전환에서 100% 재적용을 보장하지 않습니다. (예: 가상 스크롤로 요소가 재사용/재활용되는 리스트, 매우 짧게 나타났다 사라지는 팝오버 등)
- `history.pushState`/`replaceState`를 감싸는 방식은 대부분의 사이트와 호환되지만, 아주 드물게 `toString()`으로 원본 네이티브 함수인지 확인하는 사이트(예: 일부 안티봇/분석 스크립트)와 충돌할 가능성이 있습니다.
- 같은 페이지 로딩 중 여러 규칙이 연달아 적용될 때, 앞선 규칙이 `img`/`input`처럼 자식을 가질 수 없는 요소를 `span`으로 감싸면서 형제 요소들의 구조가 바뀌면, `nth-of-type` 기반의 다른 규칙이 어긋날 가능성이 있습니다(드문 경우이며, 오류 없이 그냥 매칭되지 않고 넘어갑니다).
- 규칙 이름 변경, 편집, selector 직접 수정, JSON 내보내기/가져오기는 아직 없습니다.
- URL 패턴별 규칙은 pathname(query/hash 제외) 단위로만 구분합니다. 같은 pathname 안에서 특정 쿼리 값에 따라서만 다르게 적용하는 세밀한 규칙은 아직 지원하지 않습니다.
- 삭제에는 되돌리기(휴지통) 기능이 없습니다. `chrome.storage.local`에서 즉시 영구적으로 제거되므로, 삭제 전 확인창의 문구를 꼭 확인해야 합니다.
- 설정 페이지를 여러 개 열어 둔 상태에서 거의 동시에 서로 다른 규칙을 삭제하면(매우 드문 타이밍), 나중에 저장되는 쪽이 먼저 저장된 삭제를 덮어써 그 삭제가 반영되지 않을 수 있습니다. 각 삭제 동작은 실행 직전에 최신 storage 값을 다시 읽어 이 가능성을 최대한 줄였지만, 완전히 배제하지는 않습니다.
- 화면의 거의 전체를 덮는 요소는 실수 방지를 위해 가림(및 저장) 대상에서 제외되며, 더 작은 요소를 다시 선택하라는 안내가 표시됩니다.
- **(5단계)** 일반화 selector 생성은 "태그+class/속성" 수준의 휴리스틱입니다. 사이트가 반복 카드에 안정적인 class나 `data-*`/`role` 속성을 전혀 쓰지 않고 매번 다른 무작위 class만 사용한다면, 일반화에 실패해 `이 요소만`만 사용할 수 있습니다.
- **(5단계)** "같은 페이지 유형" 판정은 pathname만 비교합니다. YouTube의 `/watch`처럼 콘텐츠 ID가 query에 있는 사이트에는 잘 맞지만, 콘텐츠 ID가 pathname 안에 포함되는 사이트(예: `/videos/abc123`)에서는 서로 다른 콘텐츠가 다른 "페이지 유형"으로 인식될 수 있습니다.
- **(5단계)** 페이지/사이트 범위로 규칙을 저장한 직후에는, 저장이 `chrome.storage.onChanged`를 다시 발화시켜 화면의 가림을 아주 짧게(대부분 한 프레임 이내) 지웠다가 다시 적용하는 내부 과정을 거칩니다. 최종 상태는 항상 올바르게 수렴하며 중복 레이어도 생기지 않지만, 이론적으로 아주 짧은 깜빡임이 있을 수 있습니다.
- **(6단계)** 키보드 단축키는 Chrome이 다른 확장 프로그램이나 브라우저 자체 단축키와 겹치면 자동으로 등록에 실패하거나 무시할 수 있습니다. Cloakli 쪽에서는 오류로 확장 프로그램이 중단되지 않도록 처리했지만, 실제로 단축키가 눌리는지는 `chrome://extensions/shortcuts`에서 직접 확인해야 합니다.
- **(6단계)** `popup.js`의 UI 렌더링과 실제 키보드 단축키 입력은 이 환경에서 자동 테스트로 실행하지 못했습니다(팝업은 별도 실행 컨텍스트이고, 실제 키 입력은 브라우저가 필요합니다). `tab-actions.js`의 공유 로직만 단위 테스트로 검증했으며, 나머지는 위 "직접 테스트할 순서"로 사람이 확인해야 합니다.
- **(6단계)** 설정 페이지 검색은 저장된 hostname과 selector 문자열만 대상으로 하며, 실제 웹페이지 텍스트나 개인정보는 애초에 저장하지 않으므로 검색 대상이 될 수 없습니다.
- **(7단계)** 실제 결제, 로그인, 라이선스 서버가 아직 없습니다. 지금의 Pro/Developer Pro는 오직 `build-config.js`의 소스 코드 상수(`developerPro`)로만 켜지며, 일반 사용자가 결제 없이 Pro가 될 수 있는 화면상의 방법은 없습니다.
- **(7단계)** 무료 한도(`maxHostnames`, `maxRules`, `allowedScopes`)는 확장 프로그램 코드(`entitlement.js`) 안의 상수로만 존재합니다. 나중에 실제 사용자가 확장 프로그램 파일 자체를 수정하면(예: 압축해제된 확장을 직접 편집) 이 한도를 우회할 수 있습니다 — 이는 서버 측 검증이 없는 로컬 전용 확장 프로그램의 근본적인 한계이며, 실제 라이선스 서버가 생기기 전까지는 완전히 막을 수 없습니다.
- **(7단계, 9단계에서 개선)** popup의 요금제 배지·"Pro 알아보기" 패널·DEV BUILD 배지의 핵심 로직(버튼 클릭, 메시지 전송, 배지 렌더링)은 `tests/popup.test.js`로 vm 기반 검증을 하지만, 실제 HTML 렌더링/CSS 표시/온보딩 화면 전환은 여전히 사람이 직접 확인해야 합니다.
- **(8단계)** ZIP 생성은 압축 없이 저장(STORE) 방식만 사용합니다. Chrome Web Store는 압축 여부와 무관하게 표준 ZIP이면 받아들이므로 제출 자체에는 문제가 없지만, 파일을 압축하는 다른 도구보다 ZIP 파일 크기가 다소 클 수 있습니다.
- **(8단계)** 실제로 Chrome Web Store 개발자 대시보드에 업로드해 심사를 통과하는지까지는 이 환경에서 확인하지 못했습니다. ZIP 구조(최상단 `manifest.json`, 표준 ZIP 형식)와 `manifest.json` 필드 유효성만 자동으로 검증했으며, Windows의 `Expand-Archive`로 실제로 정상 해제되는 것은 확인했습니다.
- **(8단계)** `validate-release.js`의 외부 통신/디버그 코드 검사는 미리 정의한 키워드·정규식 패턴 목록에 기반합니다. 목록에 없는 새로운 형태의 외부 통신 코드가 추가되면 자동으로 잡아내지 못할 수 있습니다.
- **(8단계)** manifest의 `version`은 자동으로 올리지 않습니다. 새 버전을 출시하려면 `manifest.json`의 `version`을 직접 수정한 뒤 `npm run package:prod`를 실행해야 하며, 같은 버전으로 다시 실행하면 기존 ZIP을 덮어씁니다.
- **(9단계)** `tests/popup.test.js`는 popup.html을 실제 HTML 파서로 파싱하지 않고 필요한 id를 프로그램적으로 재구성합니다. popup.html 자체에 오타나 id 불일치가 생기면(예: 새 버튼을 추가하면서 id를 잘못 붙이는 경우) 이 테스트만으로는 잡아내지 못할 수 있습니다(다만 `regression.test.js`가 필수 id 존재는 별도로 확인합니다).
- **(9단계)** 실제 Chrome에서 `dist/development`/`dist/production`을 동시에 로드해 확장 이름과 popup 배지가 다르게 보이는지는 이번 환경(자동 테스트 + `Expand-Archive` 구조 검증)에서 직접 실행해 확인하지 못했습니다. 사람이 직접 확인해야 합니다.

## 오류 확인 방법

- **팝업 개발자도구**: Cloakli 아이콘을 클릭해 팝업을 연 상태에서 팝업 위에 마우스 오른쪽 버튼 → `검사(Inspect)`를 클릭하면 팝업 전용 개발자도구가 열립니다. Console 탭에서 오류를 확인합니다.
- **웹페이지 개발자도구**: 가리려는 웹페이지에서 `F12` 또는 우클릭 → `검사`로 개발자도구를 열고 Console 탭을 확인합니다. content script 관련 오류는 여기에 표시됩니다. `Application`(또는 `저장공간`) 탭 → `Storage` → `Extension Storage`에서 실제 저장된 `cloakliRules` 값을 직접 확인할 수도 있습니다.
- **확장 프로그램 오류**: `chrome://extensions` 페이지에서 Cloakli 카드를 확인합니다. 오류가 있으면 카드에 `오류` 버튼이 표시되며, 클릭하면 상세 내용을 볼 수 있습니다.
- **디버그 로그**: `build-config.js`의 `debug` 값을 `true`로 바꾸면, `content.js`의 `CLOAKLI_DEBUG`가 이 값을 그대로 읽어 재적용/URL 변경 시점에 최소한의 로그(개인정보 없음)가 Console에 출력됩니다. 기본값은 `false`이며, `npm run build:prod`로 만든 출시 빌드에서는 항상 강제로 `false`가 됩니다.

## 자체 코드 검토 결과

1~3단계 검토에 이어 4단계 변경 사항을 아래와 같이 점검했습니다.

1. 기존 선택·가림·저장·자동 재적용·observer/SPA 대응 코드는 그대로 두고, 삭제/관리 기능은 새 파일(`options.html/css/js`)과 `content.js`의 `chrome.storage.onChanged` 리스너 하나로만 확장했습니다.
2. 기존 2단계 규칙(=`id` 필드 없음)이 `options.js`를 열 때 `loadAllRulesMigrated`로 정상적으로 표시되는지, 그리고 이미 id가 있는 규칙에는 다시 storage를 쓰지 않는지(=여러 번 열어도 중복 저장이 없는지) 확인했습니다.
3. `handleDeleteRule`이 `rule.id`(있으면)로 정확히 하나만 걸러내고, 없는 경우에만 `selector`+`createdAt` 조합으로 대체 매칭하는지, 그리고 실제로 지워진 것이 없으면("규칙을 찾지 못해...") 조용히 넘어가지 않고 안내와 함께 목록을 새로고침하는지 확인했습니다.
4. `handleDeleteSite`가 `delete all[hostname]`으로 해당 hostname의 배열만 제거하고, 다른 hostname 키는 전혀 건드리지 않는지 확인했습니다.
5. `handleResetAll`이 `chrome.storage.local.remove([STORAGE_KEY])`로 **Cloakli의 `cloakliRules` key만** 제거하는지 확인했습니다. (다른 key 전체를 지우는 `chrome.storage.local.clear()`는 사용하지 않았습니다.)
6. 세 삭제 함수(`handleDeleteRule`/`handleDeleteSite`/`handleResetAll`) 모두 `window.confirm()` 확인 후에만 실제 storage 쓰기를 수행하며, 취소하면 어떤 storage 호출도 일어나지 않는지 확인했습니다.
7. 각 삭제 함수가 실행 직전에 `chrome.storage.local.get`으로 최신 값을 다시 읽은 뒤 수정·저장해, 설정 페이지를 여러 개 열어도(또는 그 사이 content script가 규칙을 새로 저장해도) 오래된 캐시를 덮어쓰지 않는지 확인했습니다.
8. `options.js`가 `chrome.storage.onChanged`를 구독해 다른 탭에서의 변경 시 자동으로 다시 렌더링하므로, 설정 페이지를 여러 개 열어도 규칙 개수·목록이 서로 어긋나지 않는지 확인했습니다.
9. `content.js`의 `handleStorageChanged`가 (a) `areaName !== "local"`, (b) `changes[STORAGE_KEY]` 없음, (c) 현재 hostname의 규칙 배열이 실제로 동일함 세 가지 경우 모두 조기 반환해, Cloakli와 무관하거나 다른 사이트만 바뀐 변경에는 반응하지 않는지 확인했습니다.
10. 삭제 후 동기화가 `removeAllCloakliMasks()`(전체 제거) + `applyStoredRules()`(남은 규칙 재적용) 순서로 동작해, 삭제된 규칙의 가림만 사라지고 나머지는 다시 나타나며 새로고침이 일어나지 않는지, `maskElement`의 기존 중복 방지 로직 덕분에 중복 레이어가 생기지 않는지 확인했습니다.
11. `renderSites`/`buildRuleItem`이 `rule.selector`만 화면에 표시하고(그 selector도 길면 잘라서 표시), 실제 텍스트·이름·이메일·이미지 내용은 애초에 storage에 없으므로 화면에도 나타나지 않는지 확인했습니다.
12. `isValidRule`로 `selector`가 없거나 형식이 잘못된 항목은 렌더링에서 조용히 제외해, 손상된 데이터 하나 때문에 설정 페이지 전체가 멈추지 않는지 확인했습니다.
13. `manifest.json`에 `options_ui`만 추가했고, `tabs`를 비롯해 새로 필요하지 않은 권한은 추가하지 않았는지 확인했습니다.
14. 코드 전체(옵션 페이지 포함)에서 `fetch`, `XMLHttpRequest`, 외부 URL 요청이 없는지 다시 확인했습니다.

---

3단계까지의 검토 내용은 아래에 이어집니다.

1. 기존 1~2단계 기능(선택 모드, 파란 테두리, 완전 가림, 링크/버튼 차단, ESC 취소, 안내 바, 전체 해제, 선택자 생성, 저장, 자동 재적용, 저장 개수 표시, 중복 방지)의 코드를 그대로 두고, observer/URL 감지/일시 해제 로직만 새 함수로 추가하는 방식으로 최소 확장했습니다.
2. `startDomObserver()`는 스크립트당 한 번만 호출되며, 스크립트 전체가 `window.__cloakliContentLoaded` 플래그로 중복 실행을 막고 있어 observer도 함께 한 번만 등록됩니다.
3. `patchHistoryForSpaDetection()`도 같은 이유로 한 번만 호출되며, `popstate`/`hashchange` 리스너도 중복 등록되지 않습니다.
4. `history.pushState`/`replaceState`를 감싼 함수는 `original.apply(this, args)`의 반환값을 그대로 `return`하고 인자도 그대로 전달해, 원래 사이트 동작을 바꾸지 않는지 확인했습니다.
5. `handleMutations`가 Cloakli 자신이 만든 요소(오버레이/래퍼/배너/토스트)로만 이루어진 변경은 무시하도록 해, "가림 → 변경 감지 → 재적용 → 변경 감지 → …"로 이어지는 무한 반복 가능성을 제거했습니다.
6. `scheduleRuleApplication`이 `setTimeout` + `clearTimeout` 조합으로 300ms debounce를 실제로 구현하는지 확인했습니다(연속 호출 시 타이머가 계속 갱신되어 마지막 호출 후 한 번만 실행).
7. `ruleCountCache`가 0일 때 `handleMutations`가 즉시 반환해, 규칙이 없는 사이트에서는 DOM 변경이 많아도 추가 작업(스케줄링조차)이 발생하지 않는지 확인했습니다.
8. `maskElement`는 3단계에서도 변경하지 않아, 이미 `MASKED_CLASS`가 있거나 오버레이 자식이 있는 요소는 즉시 `false`를 반환하고 아무 것도 추가하지 않습니다. observer/URL 변경으로 여러 번 재적용이 일어나도 중복 레이어가 생기지 않는지 확인했습니다.
9. `현재 페이지 가림 모두 해제` 직후 `isTemporarilyDisabled`를 `true`로 설정해, `applyStoredRules`가 (observer/URL 변경 어느 경로로 호출되든) 최상단에서 즉시 반환하는지 확인했습니다. URL이 바뀌면 `handleUrlChange`가 이 플래그를 다시 `false`로 되돌려, 새 페이지에서는 정상적으로 재적용되는지 확인했습니다.
10. `location.href`가 바뀐 새 URL에서 `applyStoredRules`가 다시 호출되어 저장 규칙이 재적용되는지, 그리고 기존에 이미 가려져 있던 요소는 다시 건드리지 않는지 확인했습니다.
11. `runScheduledApplication`이 `selectionModeActive`일 때는 DOM을 건드리지 않고 반환하도록 해, 선택 모드 중 hover 테두리나 클릭 처리와 observer 재적용이 서로 간섭하지 않는지 확인했습니다. hover 테두리는 class 토글만 사용하고 `attributes`는 관찰 대상이 아니므로 애초에 observer가 반응하지 않습니다.
12. 코드 전체에서 `fetch`, `XMLHttpRequest`, 외부 URL 요청이 없는지 다시 확인했습니다 (`chrome.storage.local`만 사용).
13. `CLOAKLI_DEBUG`가 `false`일 때는 `debugLog`가 아무 것도 출력하지 않으며, 켜져 있어도 규칙 개수/URL 변경 여부 같은 구조적 정보만 로그로 남기고 텍스트·이메일 등 실제 콘텐츠는 출력하지 않는지 확인했습니다.
14. `content_scripts`가 `all_frames`를 지정하지 않아(기본값 false) 애초에 iframe 내부에서 스크립트가 실행되지 않으므로, cross-origin iframe 접근 시도 자체가 발생하지 않아 관련 오류가 날 수 없는지 확인했습니다. (README의 "알려진 제한사항"에 iframe 내부는 다루지 않음을 명시했습니다.)
15. YouTube/Gmail 같은 사이트에서 성능 저하 가능성을 줄이기 위해 (a) 300ms debounce, (b) 규칙 0개일 때 조기 반환, (c) Cloakli 자신의 변경 무시, (d) 이미 가려진 요소 즉시 스킵을 모두 적용했는지 다시 확인했습니다. 실제 각 사이트에서의 체감 성능은 사용자가 "직접 테스트할 순서"에 따라 확인해야 합니다(이 환경에서는 실제 브라우저로 YouTube/Gmail/Notion을 직접 열어 확인하지 못했습니다).

발견한 문제는 설계 단계에서 반영했으며, 구조적으로 남아있는 한계는 위 "알려진 제한사항"에 정리했습니다.

### 자동 테스트 도입 단계 추가 검토

위 15개 항목 중 다수(observer 1회 등록, debounce, 중복 가림 방지, 잘못된 selector 허용, URL 감지 4종, 일시 해제 전환, storage 동기화, 선택 모드 비간섭)는 이번 단계부터 `npm test`로 반복 검증할 수 있게 되었습니다. 추가로 다음을 점검했습니다.

1. `content-core.js` 추출이 기존 동작을 바꾸지 않았는지: `saveRuleForHost`/`applyStoredRules`/`isCloakliOwnNode`/`scheduleRuleApplication`/`handleUrlChange`/`clearAllMasks`를 `content-core.js`의 함수를 호출하도록만 바꾸고, 함수 밖으로 드러나는 동작(반환값, DOM 결과)은 그대로 유지했는지 `npm test`의 통합 테스트로 확인했습니다.
2. `manifest.json`의 `content_scripts.js` 배열에서 `content-core.js`가 `content.js`보다 먼저 오는지, `options.html`에서도 같은 순서로 `<script>`가 로드되는지 확인했습니다(둘 다 어긋나면 `CloakliCore is not defined` 오류가 납니다). `popup.js`의 `chrome.scripting.executeScript` 호출도 같은 순서로 파일을 주입하도록 함께 수정했습니다.
3. `content-core.js`는 브라우저 전역(`window.CloakliCore`)과 Node의 `module.exports`를 모두 지원하는 최소 UMD 패턴을 쓰며, 실제 확장 프로그램 동작에 필요한 코드 외에 테스트 전용 코드는 섞여 있지 않은지 확인했습니다.
4. 테스트 전용 코드(`tests/helpers/*.js`, `tests/fixtures/*.html`)가 `manifest.json`이나 다른 제품 파일에서 전혀 참조되지 않는지 확인했습니다.
5. `tests/content-integration.test.js`는 `content.js` 소스를 Node의 `vm` 모듈로 그대로 실행하므로, 제품 코드를 테스트를 위해 바꾸지 않고도(테스트를 위한 훅이나 `if (typeof window === "undefined")` 같은 분기 없이) 실제 동작을 검증하는지 확인했습니다.
6. `npm test`를 실제로 실행해 당시 전체 테스트가 모두 통과하는지 확인했습니다.

### 5단계(가림 적용 범위 선택) 추가 검토

1. 기존 선택·가림·저장·자동 재적용·규칙 관리·동적 사이트 대응 기능이 그대로 유지되는지: `onClick`은 여전히 링크/버튼 기본 동작을 막고 선택 모드를 정리하지만, 이제 즉시 마스킹/저장하는 대신 `openScopePicker`를 호출하도록만 바뀌었는지 확인했습니다. 기존 자동/회귀 테스트(범위 선택 관련 4개를 제외한 전부)가 코드 수정 없이 계속 통과하는지 확인했습니다.
2. 기존 규칙에 `scope`가 안전하게 추가되는지: `ensureRuleIds`가 `scope`/`pagePattern`이 없는 규칙에만 `"element"`/`null`을 채우고, `selector`/`createdAt`/`hostname` 등 기존 필드는 그대로 유지하는지, 여러 번 실행해도(idempotent) 같은 결과인지 단위 테스트로 확인했습니다.
3. 요소 클릭 후 범위 선택 UI가 뜨고, 취소·ESC 시 아무것도 저장/마스킹되지 않는지 통합 테스트로 확인했습니다.
4. `generateGeneralizedSelector`가 `id`, `nth-of-type`, `nth-child`, 실제 텍스트를 절대 만들지 않는지, 무작위 해시 class가 결과에서 제외되는지 확인했습니다.
5. 일반화 selector가 너무 넓으면(흔한 단독 태그, 50개 초과, 화면의 절반 이상 등) 해당 범위 버튼이 비활성화되고 저장이 차단되는지, 원래 클릭한 요소가 결과에 포함되지 않는 경우도 차단되는지 확인했습니다.
6. `page` 규칙은 정규화된 page pattern이 일치할 때만 적용되고, `site` 규칙은 hostname 안 모든 URL에 적용되며, 다른 hostname에는 어떤 scope도 적용되지 않는지 확인했습니다. 이 판별은 `doesRuleApplyToCurrentPage` 한 곳에서만 이뤄지며 MutationObserver/URL 변경/storage 동기화가 모두 이를 재사용하는지 코드를 다시 확인했습니다.
7. SPA 이동 후 `page` 규칙이 새 URL 기준으로 재평가되고(다른 pathname에서는 적용되지 않음), `site` 규칙은 계속 적용되는지 통합 테스트로 확인했습니다.
8. 같은 요소에 중복 가림 레이어가 생기지 않는지: 페이지/사이트 범위 저장이 `maskElement`의 기존 중복 방지 로직을 그대로 통과하는지, storage 저장 후 재동기화(`removeAllCloakliMasks`+`applyStoredRules`)가 한 번 더 일어나도 중복 레이어가 생기지 않는지 확인했습니다(이 재동기화 라운드트립 자체는 알려진 제한사항에 기록했습니다).
9. 범위 선택 UI가 Cloakli 자체 UI로 확실히 분류되는지: `SCOPE_PICKER_CLASS`/`SCOPE_PICKER_ID`를 `isCloakliOwnElement`(선택 대상 제외)와 `OWN_UI_CLASS_NAMES`/`OWN_UI_IDS`(MutationObserver 제외) 양쪽에 모두 추가했는지 확인했습니다.
10. options 화면에 규칙마다 적용 범위(및 있다면 page pattern)가 표시되는지, 삭제/사이트 전체 삭제/전체 초기화 기능이 그대로 동작하는지 확인했습니다.
11. `npm test`를 반복 실행(10회 연속)해 143개 테스트가 매번 통과하는지 확인했습니다. 처음에는 storage 저장 후 재동기화 라운드트립과 고정 `wait()` 시간이 겹치며 드물게 실패하는 테스트가 있었는데, 원인을 찾아 실제 조건이 참이 될 때까지 폴링하는 `waitUntil` 방식으로 테스트를 고쳐 해결했습니다(아래 "자동 테스트 결과" 참고).
12. 코드 전체에서 새로운 외부 네트워크 요청이나 `eval`이 없는지, `manifest.json`에 새 권한이 추가되지 않았는지 다시 확인했습니다.
13. 저장되는 값(`scope`, `pagePattern`)이 구조적 정보일 뿐 실제 텍스트나 URL의 콘텐츠 ID를 포함하지 않는지 확인했습니다(`normalizePagePattern`이 query/hash를 제거하므로 YouTube 영상 ID 등은 저장되지 않습니다).

### 6단계(사용성 개선 및 제품 UI 정리) 추가 검토

1. popup이 처음 사용자도 이해할 수 있는지: CSS selector, scope, pagePattern 같은 개발 용어를 popup의 어떤 문구에도 넣지 않았는지 popup.html/popup.js를 다시 읽으며 확인했습니다. 삭제(되돌릴 수 없는 기능)는 여전히 options 페이지에만 있고 popup에는 없는지 확인했습니다.
2. `현재 사이트 가림 일시중지`와 `현재 화면 가림만 잠시 해제`가 서로 다른 상태(`isHostPaused` vs `isTemporarilyDisabled`)로 완전히 분리되어 있는지, 한쪽을 눌러도 다른 쪽 상태가 바뀌지 않는지 코드와 통합 테스트로 확인했습니다.
3. 사이트 일시중지가 새로고침(스크립트 재시작)에 해당하는 상황에서도 유지되는지: `applyStoredRules`가 매번 `chrome.storage.local`에서 `cloakliPausedHostnames`를 다시 읽으므로, 메모리 캐시가 아니라 항상 storage가 진실의 원천인지 확인했습니다.
4. 다시 시작(`resume`)하면 저장 규칙이 즉시 다시 적용되는지, 이 과정에서 저장 규칙 자체(`cloakliRules`)는 전혀 건드리지 않는지 확인했습니다.
5. onboarding이 한 번만 자동으로 표시되는지: `cloakliOnboardingCompleted`가 `true`일 때만 메인 화면을 바로 보여주고, 저장값이 없거나 손상되어 있어도(예: 문자열/객체 등 예상과 다른 타입) 항상 "아직 안 봄"으로 안전하게 처리해 팝업이 멈추지 않는지 확인했습니다.
6. `사용 방법 다시 보기`를 누르면 저장값을 건드리지 않고도 같은 안내 화면을 다시 보여주는지 확인했습니다.
7. `manifest.json`의 `commands` 이름(`start-selection`, `temporarily-clear-page`)과 `background.js`가 처리하는 이름이 정확히 일치하는지, 단축키 처리와 popup 버튼이 같은 메시지(`START_SELECTION_MODE`/`CLEAR_ALL_MASKS`)를 사용하는지, 같은 함수(`TabActions.dispatchCloakliMessage`)를 호출해 중복 로직이 없는지 회귀 테스트로 확인했습니다.
8. 지원하지 않는 페이지에서 팝업이 멈추지 않는지: `chrome.runtime.lastError`를 항상 확인하는지, active tab의 `url`이 없거나 읽기 실패해도 예외가 popup 밖으로 새지 않는지, content script가 없는 탭에 메시지를 보내도 안전하게 실패 처리되는지 `tab-actions.test.js`로 확인했습니다.
9. 선택 모드 중복 실행이 없는지: `selectBtn`을 여러 번 빠르게 눌러도 `withButtonGuard`가 처리 중에는 버튼을 비활성화하고, 처리가 끝나면(성공이든 실패든) `finally`에서 항상 다시 활성화하는지 확인했습니다. 사이트 일시중지 버튼도 같은 가드를 사용해 연속 클릭으로 상태가 뒤집히지 않는지 확인했습니다.
10. toast가 과도하게 쌓이지 않는지: `showCloakliToast`가 DOM 요소 하나만 재사용하고 새 호출이 이전 내용을 즉시 대체하는지, Cloakli 자체 UI로 분류되어 선택 대상과 `MutationObserver` 대상에서 제외되는지, 개인정보나 DOM 텍스트를 자동으로 담지 않는지(모든 문구가 코드에 직접 작성된 고정 문자열인지) 확인했습니다.
11. options 페이지 검색이 작동하는지: hostname과 selector 문자열만 대상으로 하고, 검색어가 바뀔 때마다 storage를 다시 읽지 않고 마지막으로 불러온 값으로만 다시 그리는지 확인했습니다. 기존 규칙 관리(개별/사이트/전체 삭제)와 동적 가림 기능(MutationObserver/SPA URL 변경)이 그대로 유지되는지 회귀 테스트로 재확인했습니다.
12. `manifest.json`에 `tabs`/`history`/`webNavigation`/`notifications`/`unlimitedStorage`/넓은 범위의 `host_permissions` 등 불필요한 권한이 추가되지 않았는지, `activeTab`/`scripting`/`storage`만 그대로 남아 있는지 다시 확인했습니다.
13. 코드 전체(popup.js, background.js, tab-actions.js 포함)에서 새로운 외부 네트워크 요청이 없는지, 사이트 일시중지/onboarding 데이터에 hostname/boolean 외의 실제 개인정보가 들어가지 않는지 확인했습니다.
14. `npm test`를 실제로 반복 실행해(연속 5회 이상) 177개 테스트가 매번 통과하는지 확인했습니다.

### 7단계(무료/Pro 요금제 분리 및 개발자 테스트 모드) 추가 검토

사용자가 요청한 18개 자체 검토 체크리스트를 그대로 확인했습니다.

1. 무료 사용자는 규칙 3개까지만 저장할 수 있는지: `entitlement.test.js`(`canCreateRule: 무료 규칙 수 제한`)와 `content-integration.test.js`(실제 `content.js` 저장 경로)로 각각 확인했습니다.
2. 무료 사용자는 hostname 1개만 사용할 수 있는지: 같은 두 테스트 파일에서 "다른 hostname 저장 차단"/"첫 hostname 삭제 후 다른 hostname 허용" 시나리오로 확인했습니다.
3. 무료 사용자는 새로 `element` 범위만 저장할 수 있는지: `canCreateRule`이 free 상태에서 `page`/`site`를 항상 `scope-not-allowed`로 차단하는지, `content.js`의 `confirmScope`가 이 판단 이전에 아예 저장/가림을 진행하지 않는지 확인했습니다.
4. Pro 사용자는 모든 범위를 쓸 수 있는지: `canCreateRule`이 `isProUser`가 true면 usage 계산 없이 즉시 허용하는지, 통합 테스트에서 Pro 오버라이드로 hostname/규칙 한도를 넘겨도 저장되는지 확인했습니다.
5. 개발자 Pro에서는 결제 없이 모든 기능을 테스트할 수 있는지: `resolveEntitlementState(true)`가 `{ plan: "pro", source: "developer", isPro: true }`를 돌려주고, `canCreateRule`이 `source`와 무관하게 `isPro`만으로 판단하는지(`단일 권한 판정 구조 확인` 테스트) 확인했습니다.
6. 기존 page/site 규칙이 삭제되지 않는지: `content.js`의 어떤 코드도 `canCreateRule`이나 `getEntitlementState`를 규칙 삭제/필터링 경로(`applyStoredRules`, `handleRulesStorageChanged`, `options.js`의 렌더링)에서 호출하지 않는지 코드를 직접 확인했고, 통합 테스트로 기존 page/site 규칙이 무료 상태에서도 그대로 마스킹되는지 확인했습니다.
7. 기존 규칙이 무료 상태에서도 계속 적용되는지: 위 6번과 같은 테스트(`무료 상태에서도 이미 저장되어 있던 page/site 규칙은 계속 적용된다`)로 확인했습니다.
8. 규칙 삭제 후 한도가 정확히 복구되는지: `entitlement.test.js`의 `computeUsage`/`canCreateRule` 순수 테스트와, `content-integration.test.js`의 "규칙을 삭제해 한도 아래로 내려가면 다시 저장할 수 있다"/"첫 hostname의 규칙을 전부 삭제하면 다른 hostname에 새로 저장할 수 있다"로 확인했습니다.
9. popup과 options 사용량이 일치하는지: 두 화면 모두 `entitlement.js`의 같은 `computeUsage`/`describePopupPlanBadge`·`describeOptionsPlanSummary`만 호출하도록 구현했고(각자 사용량을 계산하는 별도 코드 없음), `regression.test.js`로 두 파일이 `CloakliEntitlement`를 사용하는지 확인했습니다.
10. Pro 판정 로직이 한곳에 모여 있는지: `content.js`/`popup.js`/`options.js` 어디에도 `isPro`를 직접 계산하는 코드가 없고 `entitlement.js`의 함수만 호출하는지 코드를 다시 읽으며 확인했고, `regression.test.js`로도 확인했습니다.
11. 일반 사용자가 storage 값만 바꿔 Pro가 되는 구조가 아닌지: 코드 전체에 `chrome.storage.local.set({ isPro`와 같은 패턴이 없는지, `getEntitlementState()`가 storage를 전혀 읽지 않고 소스 코드 상수만 사용하는지 확인했고, `regression.test.js`의 "Pro 여부를 storage 값만으로 직접 저장/판단하는 코드가 없다" 테스트로도 확인했습니다.
12. 실제 결제가 구현된 것처럼 표시하지 않는지: "Pro 알아보기" 패널에 가격이나 결제 버튼이 없고 "Pro 결제 기능은 출시 준비 중입니다." 문구만 있는지, Stripe/PayPal/Lemon Squeezy/Paddle/Gumroad 등 결제 관련 키워드가 코드 어디에도 없는지 `regression.test.js`로 확인했습니다.
13. 모든 자동 테스트가 통과하는지: 아래 "자동 테스트 결과"에 실행 결과를 기록했습니다.
14. 외부 네트워크 요청이 없는지: `entitlement.js`를 포함한 전체 제품 파일에서 `fetch`/`XMLHttpRequest` 사용이 없는지 기존 회귀 테스트에 `entitlement.js`를 추가해 확인했습니다.
15. 불필요한 권한이 추가되지 않았는지: `manifest.json`의 `permissions`가 여전히 `activeTab`/`scripting`/`storage` 세 개뿐인지 확인했습니다(변경 없음).
16. 개인정보가 저장되거나 로그로 출력되지 않는지: 요금제 계산에 쓰이는 데이터는 이미 저장 중이던 `cloakliRules`(hostname+selector 구조 정보)뿐이고, 요금제 상태 자체는 어디에도 저장하지 않으며, `CLOAKLI_DEBUG`가 꺼져 있는 한 관련 로그도 남기지 않는지 확인했습니다.
17. 개발자 플래그(`CLOAKLI_DEVELOPER_MODE`)의 위치와 출시 전 변경 안내가 명확한지: `entitlement.js` 파일 상단 주석과 이 README의 "개발자 전용 Pro 테스트 모드" 섹션에 파일 경로와 상수 이름을 명시했고, `regression.test.js`로 기본값이 `false`인지 자동으로 확인했습니다.
18. `npm test`를 실제로 반복 실행해(연속 3회 이상) 248개 테스트가 매번 통과하는지 확인했습니다.

### 8단계(개발/출시 빌드 분리 및 Chrome Web Store 패키징) 추가 검토

사용자가 요청한 17개 자체 검토 체크리스트를 그대로 확인했습니다.

1. 개발 빌드와 출시 빌드가 분리되는지: `scripts/build.js`가 `dist/development`/`dist/production`을 각각 만들고, 매번 이전 결과를 지운 뒤 새로 복사하는지 `build.test.js`와 실제 `npm run build:dev`/`build:prod` 실행으로 확인했습니다.
2. 출시 빌드에서 Developer Pro가 반드시 꺼지는지: `scripts/build.js`가 production 모드에서 `build-config.js` 사본을 항상 `developerPro: false`로 덮어쓰는지, 소스에서 일부러 `developerPro: true`로 설정해도 결과가 항상 false인지 `build.test.js`로 확인했고, 실제 `dist/production/build-config.js`를 열어 재확인했습니다.
3. 출시 빌드 기본 사용자가 Free인지: `dist/production`의 `entitlement.js`를 직접 불러와 `getEntitlementState()`가 `{ plan: "free", ... }`를 돌려주는지 테스트와 실제 빌드 양쪽으로 확인했습니다.
4. production 폴더에 테스트 파일이 없는지: `RELEASE_FILES` 목록에 `tests/*`가 포함되지 않고, `validate-release.js`가 `tests/` 경로를 발견하면 실패하는지 확인했습니다. 실제 `dist/production`을 나열해 `tests`/`node_modules`/`package.json`/`README.md`가 없는지 확인했습니다.
5. ZIP 안에 `manifest.json`이 최상단에 있는지: `package-release.js`가 항상 `manifest.json`을 첫 번째 항목으로 압축하고, 생성 직후 `readZipEntries`로 다시 읽어 첫 항목이 `manifest.json`인지 스스로 검증하는지 확인했습니다. Windows의 `Expand-Archive`(별도 프로그램)로 실제 ZIP을 열어 최상단에 `manifest.json`이 보이는지도 확인했습니다.
6. ZIP에 `node_modules`/`tests`가 없는지: 실제 생성된 `releases/cloakli-v0.1.0.zip`을 `readZipEntries`로 나열해 14개 파일만 있는지 확인했습니다.
7. manifest 참조 파일이 모두 존재하는지: `validate-release.js`가 `content_scripts`/`action.default_popup`/`background.service_worker`/`options_ui.page`가 가리키는 모든 파일 존재를 확인하고, `commands`와 `background.js` 처리 이름이 일치하는지도 확인했습니다.
8. 불필요한 권한이 없는지: `validate-release.js`가 `permissions`를 정확히 `activeTab`/`scripting`/`storage`와 비교하고 `host_permissions`/`<all_urls>` 존재 여부를 확인하는지, 실제 `dist/production/manifest.json`도 다시 읽어 확인했습니다.
9. 외부 통신 코드가 없는지: `fetch`/`XMLHttpRequest`/`WebSocket`/analytics·telemetry 키워드/원격 `<script>`를 스캔하는지, 일부러 이런 코드를 주입한 fixture에서 검사기가 실제로 실패시키는지 `build.test.js`로 확인했습니다.
10. debug 코드가 없는지: `debugger` 문과 하드코딩된 `CLOAKLI_DEBUG = true`는 실패로, `console.log`는 경고로만 처리되는지 확인했습니다(예: `background.js`의 설치 로그가 불필요하게 삭제 대상이 되지 않도록).
11. 전체 자동 테스트가 통과하는지: 아래 "자동 테스트 결과"에 실행 결과를 기록했습니다.
12. `build:dev`가 성공하는지: 실제로 `npm run build:dev`를 실행해 `dist/development`가 만들어지고 소스의 `build-config.js`(기본값 `developerPro: false`)가 그대로 복사되는지 확인했습니다.
13. `build:prod`가 성공하는지: 실제로 `npm run build:prod`를 실행해 `dist/production`이 만들어지고 `build-config.js`가 강제로 안전한 값으로 바뀌는지 확인했습니다.
14. `validate:prod`가 성공하는지: 실제로 `npm run validate:prod`를 실행해 통과 메시지와 `console.log` 경고(있다면)가 출력되는지 확인했습니다.
15. `package:prod`가 성공하는지: 실제로 `npm run package:prod`(테스트 → 빌드 → 검증 → ZIP)를 전체 실행해 끝까지 오류 없이 완료되고 ZIP 경로/버전/크기/SHA-256이 출력되는지 확인했습니다.
16. ZIP 파일명에 version이 포함되는지: 실제 생성된 파일명이 `cloakli-v0.1.0.zip`인지(현재 `manifest.json`의 `version`은 `0.1.0`) 확인했습니다.
17. README 명령이 실제 명령과 일치하는지: README에 적은 `npm run build:dev`/`npm run package:prod`/출력 경로(`dist/development`, `releases/cloakli-v<version>.zip`)가 `package.json`의 실제 스크립트/스크립트 동작과 같은지 다시 확인했습니다.

### 9단계(개발/출시 빌드 실행 검증 및 확장 프로그램 이름 구분) 추가 검토

1. 실제 버그를 추측이 아니라 코드로 확인했는지: `tab-actions.js`의 `ensureContentInjected()`가 주입하던 파일 목록(`["content-core.js", "content.js"]`)과 `manifest.json`의 `content_scripts.js`(4개 파일)를 나란히 읽어 실제로 다르다는 것을 확인한 뒤 수정했습니다.
2. 수정한 목록이 이제 항상 manifest와 같은지: `tab-actions.js`에 `CONTENT_SCRIPT_FILES` 상수를 두고, `tests/tab-actions.test.js`가 이 상수와 `manifest.json`의 `content_scripts.js`를 직접 비교해 어긋나면 테스트가 실패하도록 만들었습니다(같은 버그의 재발 방지).
3. popup 버튼 클릭부터 메시지 전송까지 실제로 동작하는지: `tests/popup.test.js`가 popup.js를 vm으로 그대로 실행해 클릭 → `chrome.tabs.query` → `chrome.scripting.executeScript`(4개 파일) → `chrome.tabs.sendMessage`(`START_SELECTION_MODE`) 순서를 확인했습니다.
4. 실패 시 사용자에게 구체적인 안내가 표시되는지: "지원하지 않는 페이지"와 "실제 실패"를 `describeDispatchFailure()`로 구분해 서로 다른 문구가 표시되는지, development에서만 `CONTENT_SCRIPT_UNAVAILABLE` 코드가 추가되고 production에서는 내부 오류 내용이 전혀 노출되지 않는지 `popup.test.js`로 확인했습니다.
5. 버튼이 실패 후에도 다시 눌릴 수 있는지: `withButtonGuard`의 `finally`가 그대로 유지되어 있는지 코드로 확인했고, 실패 시나리오 테스트에서 `selectBtn.disabled === false`인지 다시 확인했습니다.
6. 개발 빌드와 출시 빌드가 이름으로 구분되는지: `scripts/build.js`가 만든 실제 `dist/development/manifest.json`(`name: "Cloakli DEV"`)과 `dist/production/manifest.json`(`name: "Cloakli"`)을 직접 읽어 확인했습니다.
7. DEV BUILD 배지/배너가 storage가 아니라 build-config.js로만 판정되는지: `popup.js`/`options.js`의 `renderDevBadge`/`renderDevBanner`가 `CloakliBuildConfig.mode`만 참조하는지 코드를 다시 읽었고, `popup.test.js`에 저장소 값을 채워 넣어도 배지가 켜지지 않는 테스트를 추가해 확인했습니다.
8. production에 개발 전용 표시가 전혀 남지 않는지: 실제 `dist/production`의 `popup.html`/`options.html`/`manifest.json`을 `grep`으로 검색해 `cloakli-dev-badge`/`cloakli-dev-banner`/`Cloakli DEV`/`[개발 빌드]` 문자열이 하나도 없는지 확인했고, `validate-release.js`에 같은 검사를 자동화해 추가했습니다.
9. 스크립트 로드 순서가 산출물에서도 유지되는지: `validate-release.js`의 새 `validateScriptOrder()`가 `dist/production`의 manifest/popup.html/options.html을 실제로 다시 읽어 순서를 확인하며, 순서를 일부러 뒤바꾼 fixture에서 검사기가 실패하는지 `build.test.js`로 확인했습니다.
10. 기존 기능(저장/가림/삭제/일시중지/요금제 등)이 그대로 유지되는지: 이번 단계에서 `content.js`/`content-core.js`/`options.js`의 핵심 로직은 건드리지 않았고, 전체 기존 테스트(273개)가 그대로 통과하는지 확인했습니다.
11. `npm test`/`npm run build:dev`/`npm run build:prod`/`npm run validate:prod`/`npm run package:prod`를 실제로 순서대로 재실행해 307개 테스트와 빌드/검증/ZIP 생성이 모두 성공하는지 확인했습니다.
