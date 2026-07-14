# Chrome Web Store 개인정보 공개(Privacy practices) 작성 답안

개발자 대시보드 → Privacy practices 탭에 그대로 옮겨 적는다. 코드의 실제 동작과 일치한다.

## Single purpose (단일 목적)

> Cloakli lets users visually mask selected parts of web pages before sharing or recording their screen, and re-applies those masks when they revisit the site.

## 권한별 정당화 (Permission justification)

- **activeTab**: Used only when the user clicks "Select an area to hide" in the popup, to start selection mode on the current tab.
- **scripting**: Used to inject the content script into tabs that were already open before the extension was installed, so saved masks can apply without a page reload.
- **storage**: Stores the user's saved mask rules, per-site pause state, an anonymous installation ID, and (for Pro users) a license session token and cached plan status locally in chrome.storage.local.
- **alarms**: Schedules periodic background re-validation of an activated Pro license.
- **Host access (http/https all sites)**: The core feature is automatically re-applying the user's saved masks when they revisit a site. The content script only draws overlays for URLs that match the user's own saved rules; it does not read, collect, or transmit page content.

## Data usage 질문 답안

Chrome 스토어의 "Does your extension collect or use..." 체크리스트:

| 항목 | 답 | 비고 |
|---|---|---|
| Personally identifiable information | No | 이름/이메일/주소 수집 안 함 |
| Health information | No | |
| Financial and payment information | No | 결제는 Lemon Squeezy 웹사이트에서 진행, 확장은 카드 정보를 다루지 않음 |
| Authentication information | **Yes** | 사용자가 직접 입력한 라이선스 키 — 키는 SHA-256 해시로만 서버 전송, 원문은 저장하지 않음. 이후 통신은 세션 토큰 사용 |
| Personal communications | No | |
| Location | No | |
| Web history | No | 방문 기록을 수집·전송하지 않음. 가림 규칙의 hostname은 로컬에만 저장 |
| User activity | No | 클릭/스크롤 추적 없음, 분석 도구 없음 |
| Website content | No | 페이지 내용을 수집·전송하지 않음. 가림 대상 식별자(선택자/해시된 링크 식별자)는 로컬에만 저장 |

체크 후 하단 certification 3개 항목(제3자 판매 안 함, 단일 목적 외 사용·전송 안 함, 신용도 판단 목적 사용 안 함) 모두 체크 가능 — 실제로 해당 사항 없음.

## Remote code

> **No, I am not using remote code.** All JavaScript is packaged in the extension. No CDN scripts, no eval, no dynamically fetched code.

## 외부 통신 (참고)

라이선스 서버 `https://cloakli-license.mycloakli.workers.dev` 한 곳. 사용자가 라이선스 키를 입력해 Pro를 활성화한 경우에만:
- 라이선스 키의 SHA-256 해시(원문 아님), 설치 ID, 확장 버전 전송
- 이후 재검증은 세션 토큰으로 수행
- Free 사용자는 어떤 외부 요청도 발생하지 않음

## Privacy policy URL

Pages 배포 후: `https://cloakli.pages.dev/privacy/` (커스텀 도메인 연결 시 그 주소로 교체)
