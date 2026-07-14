# Cloakli 권한 명세 (manifest.json 기준)

manifest.json의 실제 선언과 1:1로 일치한다. 여기 없는 권한은 사용하지 않는다.

## permissions

| 권한 | 사용 이유 | 코드 근거 |
|---|---|---|
| `activeTab` | 팝업에서 "가릴 영역 선택"을 눌렀을 때 현재 탭에만 선택 모드를 시작하기 위해 | popup.js → chrome.tabs 현재 탭 조회 후 메시지 전송 |
| `scripting` | 콘텐츠 스크립트가 아직 주입되지 않은 탭(설치 직후 이미 열려 있던 탭)에 스크립트를 주입하기 위해 | background.js `chrome.scripting.executeScript` |
| `storage` | 저장된 가림 규칙, 사이트 일시중지 상태, 설치 ID, 라이선스 세션 토큰(원문 키 아님), 요금제 캐시를 `chrome.storage.local`에 저장하기 위해 | rules 저장/로드, entitlement.js, license-client.js |
| `alarms` | 라이선스 상태를 주기적으로 재검증(백그라운드 갱신)하기 위해 | background.js 라이선스 recheck 알람 |

## content_scripts (호스트 접근)

- `matches: ["http://*/*", "https://*/*"]`
- 설치 시 Chrome이 "모든 웹사이트의 데이터를 읽고 변경" 경고를 표시하는 원인이 이것이다.
- 필요한 이유: 사용자가 가림을 저장한 사이트를 **다시 방문했을 때 클릭 없이 자동으로 가림을 재적용**하는 것이 핵심 기능이기 때문. activeTab만으로는 재방문 시 자동 적용이 불가능하다.
- 콘텐츠 스크립트는 저장된 규칙과 URL이 일치할 때만 오버레이를 그리며, 페이지 내용을 수집·전송하지 않는다.

## 사용하지 않는 것

- `tabs`(전체 탭 URL 열람), `history`, `cookies`, `webRequest`, `downloads`, `nativeMessaging` — 선언하지 않음
- 원격 코드 로드 없음 (모든 JS는 패키지에 포함, CDN/eval 없음 — MV3 기본 CSP 준수)
- 외부 통신은 라이선스 서버(`cloakli-license.mycloakli.workers.dev`) 한 곳뿐이며, 그마저 사용자가 라이선스 키를 입력한 경우에만 발생한다.
