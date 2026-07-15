# 스토어 스크린샷 (1280×800, 5장) — 생성 완료

`store-assets/screenshots/`에 5장이 준비되어 있다. 전부 **실제 확장 코드**(content.css,
content.js의 가림 오버레이/선택 모드/범위 선택 UI, 실제 options.html)를 허구 데이터
픽스처 위에서 렌더링해 headless Chrome으로 캡처한 것이다 — 합성/가짜 UI 아님,
실제 개인정보·실존 브랜드 없음.

| # | 파일 | 캡션 | 내용 |
|---|---|---|---|
| 1 | screenshot-1-before-after.png | Hide sensitive information before sharing your screen | Before/After — 잔액·읽지 않은 메일·썸네일에 실제 HIDDEN 오버레이 |
| 2 | screenshot-2-selection.png | Select exactly what you want to hide | 화면 고정 배너 + 선택 대상 파란 하이라이트 |
| 3 | screenshot-3-scope.png | Choose where each mask applies | 범위 선택 UI(이 요소만/페이지 유형/사이트) + 미리보기 outline |
| 4 | screenshot-4-options.png | Manage all your saved masks | 실제 옵션 페이지: 2개 사이트 규칙 관리 + License Pro 요약 |
| 5 | screenshot-5-local-first.png | Your webpage content stays on your device | 로컬 우선 구조 다이어그램 (수집·전송 없음 명시) |

## 재생성 방법

```bat
node scripts\generate-screenshots.js
```

문구/픽스처 수정 후 위 명령 한 번으로 5장이 다시 생성된다 (Chrome 설치 필요).
네트워크 요청 없음 — chrome.* shim이 로컬에서 응답한다.

## 업로드 시 주의

- 대시보드 업로드 규격: 1280×800 (혹은 640×400) — 생성본은 1280×800 PNG.
- 순서: 1 → 5 순서 그대로 업로드 (1장이 대표 이미지).
- 한국어 listing에도 같은 이미지를 재사용해도 되고, Chrome 언어를 한국어로 바꿔
  같은 스크립트를 돌리면 한국어 UI 버전을 만들 수도 있다(선택).
- 프로모 타일(440×280 등)은 아직 없음 — PROMO-ASSETS.md 지침으로 별도 제작.
