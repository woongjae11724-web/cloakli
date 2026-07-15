# 프로모션 이미지 — 제작 완료

> `store-assets/promo/`에 대시보드 요구 규격으로 생성돼 있다 (24비트 PNG, 알파 없음):
> - `promo-small-440x280.png` — 작은 프로모션 타일 (로고 + 카피 + HIDDEN 칩)
> - `promo-marquee-1400x560.png` — 마키 타일 (로고+카피 좌측, 실제 HIDDEN 오버레이가
>   적용된 허구 픽스처 제품 화면 우측)
> 재생성: `node scripts\generate-promo.js` (headless Chrome 캡처 후 알파 제거 재인코딩)
>
> 아래는 원래의 제작 지침(수정 시 참고).

## 필요한 규격 (대시보드 업로드 화면 기준으로 확인)

| 이미지 | 규격 | 용도 |
|---|---|---|
| Small promo tile | 440×280 PNG/JPG | 스토어 검색·카테고리 목록 카드 (사실상 필수) |
| Marquee promo tile | 1400×560 PNG/JPG | 에디터 추천/피처링 배너 (선택) |
| 스크린샷 | 1280×800 (또는 640×400) ×최대 5 | SCREENSHOTS.md에서 별도 관리 |

## 디자인 지침

- **문구 (EN 우선)**: 메인 카피 `Hide it before you share it.` 또는 짧은 설명 그대로
  `Hide sensitive information on webpages before sharing your screen.`
  — 과장·절대적 보안 주장 문구 금지 (listing.md 하단의 금지 표현 목록과 동일 기준).
- **로고 배치**: 좌측 상단 또는 중앙. `icons/icon128.png`(어두운 남색 #1f2937 라운드 사각형 +
  파란/초록 가림 바)를 원본으로 확대 제작하거나 `website/assets/favicon.svg` 벡터 사용.
- **배경**: 홈페이지와 동일한 다크 톤(#0f1420 계열) + 포인트 컬러 #4da3ff.
  실제 웹페이지 스크린샷을 배경으로 쓸 경우 반드시 demo 픽스처(허구 데이터)만 사용.
- **안전 영역**: 각 변에서 8% 안쪽에 텍스트·로고 배치 (스토어가 모서리를 잘라내는 경우 대비).
  Marquee는 좌측 1/3에 텍스트, 우측 2/3에 제품 화면 배치가 안정적.
- **금지**: 실제 개인정보, 실존 브랜드 로고(YouTube/Gmail 등)를 광고의 핵심 요소로 사용,
  Chrome/Google 로고로 승인·제휴처럼 보이게 하는 연출, 가짜 리뷰·별점·설치 수.

## 제작 방법 제안

1. `store-assets/demo/index.html`(1280×800 픽스처)에서 가림 적용 화면을 캡처
2. 440×280 캔버스에 좌: 로고+카피, 우: 캡처 축소본 배치
3. 텍스트는 시스템 산세리프(Segoe UI/Inter) 볼드, 대비 4.5:1 이상
