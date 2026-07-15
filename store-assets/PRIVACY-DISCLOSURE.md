# Chrome Web Store — Privacy practices 제출 답안 (최종)

대시보드 → 항목 → **Privacy practices** 탭에 아래 답안을 그대로 입력한다.
모든 답안은 실제 코드 감사 결과와 일치한다(외부 통신은 `license-client.js`의 라이선스
서버 fetch 단 1곳, analytics/tracking 없음 — `tests/website.test.js`와 secret scan이 검증).

---

## 1. Single purpose (단일 목적 — 그대로 붙여넣기)

```
Cloakli allows users to visually hide selected information on webpages before
screen sharing, recording, presenting, or taking screenshots. Saved masks are
re-applied automatically when the user revisits the site.
```

저장된 가림 규칙, 재방문 시 재적용, 페이지 유형·사이트 범위, 사이트 일시중지, 규칙 관리,
라이선스 검증(Free·Pro 제한)은 모두 이 단일 목적을 지원하는 부가 기능으로 설명한다.
라이선스 판매 자체를 목적으로 쓰지 않는다.

## 2. Permission justifications (권한별 사용 이유 — 각 입력란에 붙여넣기)

**activeTab**
```
Used only after the user explicitly starts selection mode from the popup, so
Cloakli can identify and visually cover the content the user selects on the
currently active page.
```

**scripting**
```
Used to inject Cloakli's selection and masking logic into tabs that were
already open before the extension was installed, so the user does not need to
reload every page. No code is executed on a page until the user interacts
with Cloakli.
```

**storage**
```
Used to save the user's masking rules, per-site pause preferences, onboarding
state, a random installation ID, and the verified subscription entitlement
(session token, never the license key itself) locally in the user's browser
via chrome.storage.local. Nothing is synced or sent to any analytics service.
```

**alarms**
```
Used to periodically re-validate an activated Pro license in the background
(once per day). No alarms are used for tracking or data collection.
```

**Host permissions (content script on http://*/* and https://*/*)**
```
Cloakli's core feature is automatically re-applying the masks the user saved
when they revisit a website. This requires the content script to run on
regular webpages so saved masks appear without any extra clicks. The content
script only draws visual overlays for elements matching the user's own saved
rules; it does not read, collect, or transmit page content, and it cannot run
on chrome:// pages or the Chrome Web Store (this limitation is disclosed to
users).
```

## 3. Remote code

**답: No, I am not using remote code.**

```
All JavaScript is packaged inside the extension. Cloakli does not load remote
scripts, does not use eval or WebAssembly, and does not download or execute
any code at runtime. The only network communication is JSON API calls to
Cloakli's own license verification server.
```

## 4. Data usage (수집 데이터 유형 체크리스트 — 코드 감사 결과 기준)

| 대시보드 항목 | 체크 | 근거 (실제 코드) |
|---|---|---|
| Personally identifiable information | **아니오** | 이름/이메일/주소를 수집하지 않음 |
| Health information | 아니오 | — |
| Financial and payment information | 아니오 | 결제는 Lemon Squeezy 웹사이트에서 진행. 확장은 카드 정보를 다루지 않음 |
| **Authentication information** | **예** | 사용자가 직접 입력한 라이선스 키를 활성화 요청 1회에 전송(저장하지 않음). 이후에는 서버가 발급한 세션 토큰만 사용 |
| Personal communications | 아니오 | — |
| Location | 아니오 | IP 기반 위치 수집 없음(요청 자체의 IP는 Cloudflare 인프라 로그에 남을 수 있음 — privacy policy에 공개) |
| Web history | 아니오 | 방문 기록을 수집·전송하지 않음. 가림 규칙의 hostname은 로컬에만 저장 |
| User activity | 아니오 | 클릭/스크롤 추적, 분석 도구 없음 |
| Website content | 아니오 | 페이지 본문/선택 텍스트/이메일/영상 제목/이미지/캡처를 전송하지 않음. 가림 대상 식별자(CSS selector, 해시된 링크 식별자)는 로컬에만 저장 |

**라이선스 검증 시 서버로 전송되는 것 (숨기지 않고 공개):** 라이선스 키(활성화 1회, 서버는
SHA-256 해시만 저장), 무작위 설치 ID, 확장 프로그램 버전, 세션 토큰, 요청 메타데이터
(시각·IP는 Cloudflare 인프라 차원). **전송되지 않는 것:** 웹페이지 본문, 사용자가 가린
실제 내용, 방문 기록, 화면 캡처.

## 5. Certifications (하단 인증 3종 — 감사 결과 모두 진술 가능)

- [x] 사용자 데이터를 제3자에게 판매하지 않음 — 판매 코드/계약 없음
- [x] 단일 목적과 무관한 용도로 사용·전송하지 않음 — 외부 통신이 라이선스 검증 1종뿐
- [x] 신용도 판단·대출 등에 사용하지 않음 — 해당 데이터 자체가 없음

(광고 목적 사용 없음, 사람이 읽기 위한 사용자 콘텐츠 전송 없음 — 위 감사와 동일 근거)

## 6. Privacy policy URL

```
https://cloakli.pages.dev/privacy/
```

## 참고: 코드 감사 요약 (제출 전 재검증 방법)

- 외부 통신 전수 검색: `grep -n "fetch(\|XMLHttpRequest\|WebSocket\|sendBeacon" *.js`
  → `license-client.js`의 라이선스 서버 호출 1곳만 존재해야 한다.
- 외부 도메인: `cloakli-license.mycloakli.workers.dev`(라이선스 API),
  `mycloakli.lemonsqueezy.com`(구매 버튼이 새 탭으로 여는 결제 페이지 — 데이터 전송 아님).
- analytics/tracking/sentry/posthog 문자열: 0건 (`npm test`의 website/store 검사가 강제).
