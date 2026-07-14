# Cloakli 공식 홈페이지 (website/)

순수 정적 사이트 — 프레임워크, 외부 폰트, CDN 없음. Cloudflare Pages에 그대로 배포한다.

## 구조

```
website/
  index.html            홈 (Hero/기능/요금제/FAQ/한계 안내)
  privacy/index.html    개인정보처리방침 (영/한)
  terms/index.html      이용약관 (영/한)
  refund/index.html     환불·구독 정책 (영/한)
  support/index.html    지원·문의 (영/한)
  download/index.html   다운로드 (스토어 출시 전 Coming soon)
  site-config.js        중앙 설정 (스토어 URL, checkout URL, 지원 이메일 placeholder 등)
  locales/ko.js         한국어 문구 (짧은 UI 문구용)
  assets/i18n.js        언어 감지/전환 (영어 기본, 브라우저 ko 감지, localStorage 저장)
  assets/site.css       스타일
  robots.txt, sitemap.xml
```

다국어 방식: 짧은 문구는 HTML에 영어 원문 + `data-i18n` 키(한국어는 locales/ko.js에서 교체,
영어 복귀는 로드 시 스냅샷 사용). 긴 정책 문서는 `data-lang="en|ko"` 블록 표시/숨김.

## 로컬 실행

빌드 단계가 없다. 아무 정적 서버로 열면 된다:

```bat
:: 저장소 루트에서
npx.cmd serve website
:: 또는
cd website && python -m http.server 8000
```

(file:// 로 직접 열어도 대부분 동작하지만, 절대 경로(/assets/...)를 쓰므로 정적 서버 권장)

## 검사/배포 명령 (저장소 루트 package.json)

```bat
npm.cmd run website:check          :: placeholder/링크/구조 검사 (경고 모드)
npm.cmd run website:check:strict   :: production 필수값 누락 시 실패
npm.cmd run website:deploy         :: Cloudflare Pages 배포 (wrangler 로그인 필요)
```

## Cloudflare Pages 배포

wrangler(이미 server/에 설치됨)로 직접 업로드 방식 사용:

```bat
cd server
npx.cmd wrangler pages project create cloakli --production-branch=main
npx.cmd wrangler pages deploy ../website --project-name=cloakli
```

- 출력 디렉터리 = `website/` 그 자체 (빌드 없음)
- 배포 URL: `https://cloakli.pages.dev` (프로젝트명이 이미 사용 중이면 다른 이름 선택)
- GitHub 연동 방식을 쓰려면 Cloudflare 대시보드 → Workers & Pages → Pages → "Connect to Git"에서
  이 저장소를 연결하고 Build command는 비움, Output directory는 `website`로 설정
- 환경 변수: 필요 없음 (모든 설정은 site-config.js에 있고 비밀값이 없음)
- Custom domain: Pages 프로젝트 → Custom domains에서 추가 (무료 플랜 지원)

## 배포 후 이 URL을 사용할 곳

- Lemon Squeezy 스토어 설정의 Website URL
- Chrome Web Store 등록의 개인정보처리방침 URL (`/privacy/`)
- Chrome Web Store 지원 URL (`/support/`)

## 확정된 값 (site-config.js)

- `supportEmail` = cloakli.support@gmail.com
- `businessName` = Cloakli
- 준거법 = 대한민국 법률 (terms 본문에 언어별 하드코딩)
- `refundWindowDays` = 14 (현지 강행 소비자보호법 우선 — 환불 정책에 명시)
- `chromeStoreUrl` — **스토어 출시 후 입력** (그 전까지 버튼은 "Coming soon" 비활성)
