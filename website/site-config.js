// Cloakli 홈페이지 중앙 설정. 비밀값은 절대 넣지 않는다(공개 정적 사이트).
// placeholder(YOUR_*, null)는 production 배포 전 반드시 실제 값으로 교체해야 하며,
// tests/website.test.js와 scripts/check-website.js --strict 가 이를 검사한다.
window.CLOAKLI_SITE = {
  // 출시 후 실제 Chrome Web Store 상세 페이지 URL로 교체. 빈 값이면 설치 버튼은
  // "Coming soon"으로 비활성화된다(빈/가짜 URL로 이동하지 않음).
  chromeStoreUrl: "",

  // Lemon Squeezy 결제 페이지 (비밀 아님 — 공개 checkout 주소)
  checkoutUrl: "https://mycloakli.lemonsqueezy.com/checkout/buy/cfc2a207-b317-443f-addc-6a85a91d533e",

  // 지원/개인정보 문의 이메일
  supportEmail: "cloakli.support@gmail.com",

  // 운영자(판매자) 표기명
  businessName: "Cloakli",

  // 약관 준거법 표기 (약관 본문에는 언어별로 하드코딩되어 있음 — 값 변경 시 terms도 함께 수정)
  governingLaw: "대한민국 법률 / Laws of the Republic of Korea",

  // 환불 가능 기간(일). 현지 강행 소비자보호법이 우선한다(환불 정책 문서에 명시).
  refundWindowDays: 14,

  // 정책 문서 시행일/최종 수정일
  effectiveDate: "2026-07-15",
  lastUpdated: "2026-07-15",

  // 라이선스 검증 서버(참고 표기용, 비밀 아님)
  licenseServerHost: "cloakli-license.mycloakli.workers.dev",
};
