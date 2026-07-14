// Cloakli 홈페이지 한국어 문구. HTML에는 영어 원문이 들어 있고(SEO/무-JS 기본),
// assets/i18n.js가 한국어 선택 시 data-i18n="키" 요소의 내용을 이 값으로 교체한다.
// 긴 정책 문서(privacy/terms/refund)는 이 파일 대신 페이지 안의 data-lang 블록으로 관리한다.
window.CLOAKLI_KO = {
  // 페이지별 <title> / meta description (body[data-page] 기준)
  "__title__": {
    home: "Cloakli — 화면 공유 전에 민감한 정보를 가리세요",
    privacy: "개인정보처리방침 — Cloakli",
    terms: "이용약관 — Cloakli",
    refund: "환불·구독 정책 — Cloakli",
    support: "지원·문의 — Cloakli",
    download: "다운로드 — Cloakli"
  },
  "__description__": {
    home: "Cloakli는 화면 공유 전에 웹페이지의 이름, 메시지, 이미지, 계정 정보 등 민감한 부분을 직접 가릴 수 있는 Chrome 확장 프로그램입니다.",
    privacy: "Cloakli가 어떤 정보를 브라우저에 저장하고, 라이선스 검증을 위해 무엇을 전송하는지 설명합니다.",
    terms: "Cloakli 사용 조건, 라이선스, 책임 제한을 설명합니다.",
    refund: "Cloakli Pro 구독의 갱신, 취소, 환불 절차를 설명합니다.",
    support: "Cloakli 사용 방법과 문의 방법을 안내합니다.",
    download: "Chrome용 Cloakli를 설치하세요."
  },

  // 공통 (헤더/푸터/버튼)
  navFeatures: "기능",
  navPricing: "요금제",
  navFaq: "자주 묻는 질문",
  navSupport: "지원",
  navDownload: "다운로드",
  footerPrivacy: "개인정보처리방침",
  footerTerms: "이용약관",
  footerRefund: "환불 정책",
  footerSupport: "지원·문의",
  storeButtonComingSoon: "Chrome 웹 스토어 출시 준비 중",
  storeButtonReady: "Chrome에 추가",
  viewProButton: "Pro 알아보기",
  comingSoonNote: "Chrome 웹 스토어 심사가 끝나면 설치 버튼이 활성화됩니다.",

  // 홈 Hero
  heroTitle: "화면을 공유하기 전에 민감한 정보를 가리세요.",
  heroLead: "Cloakli는 이름, 메시지, 이미지, 계정 정보 등\n공개하고 싶지 않은 부분을 웹페이지 위에서 직접 가릴 수 있습니다.",

  // 핵심 기능
  featuresTitle: "핵심 기능",
  feature1Title: "가릴 곳을 직접 선택",
  feature1Desc: "웹페이지에서 가리고 싶은 요소를 클릭 한 번으로 선택합니다.",
  feature2Title: "저장하면 계속 가려짐",
  feature2Desc: "저장한 가림은 같은 사이트를 다시 방문할 때 자동으로 다시 적용됩니다.",
  feature3Title: "동적 웹사이트 대응",
  feature3Desc: "YouTube, Gmail, Notion처럼 화면 내용이 계속 바뀌는 사이트를 위해 설계했습니다.\n모든 사이트·모든 구조와의 완벽한 호환을 보장하지는 않습니다.",
  feature4Title: "로컬 우선 개인정보 보호",
  feature4Desc: "가림 규칙과 설정은 기본적으로 브라우저 로컬 저장소에만 보관됩니다.\n웹페이지 본문, 이메일 내용, 화면 캡처는 서버로 전송하지 않습니다.",

  // 사용 예시
  useCasesTitle: "이런 상황에서 사용하세요",
  useCase1: "온라인 회의",
  useCase2: "고객 데모",
  useCase3: "온라인 강의",
  useCase4: "영상 녹화",
  useCase5: "라이브 스트리밍",
  useCase6: "기술 지원",
  useCase7: "화면 캡처",

  // 작동 방식
  howTitle: "작동 방식",
  how1Title: "Cloakli 열기",
  how1Desc: "툴바에서 Cloakli 아이콘을 클릭합니다.",
  how2Title: "영역 선택",
  how2Desc: "웹페이지에서 가릴 부분을 클릭합니다.",
  how3Title: "적용 범위 선택",
  how3Desc: "이 요소만 가릴지, 같은 종류를 모두 가릴지 고릅니다.",
  how4Title: "화면 공유 시작",
  how4Desc: "가려진 상태를 직접 확인한 뒤 공유를 시작하세요.",

  // 요금제
  pricingTitle: "Free와 Pro",
  planFreeTitle: "Free",
  planFreeItem1: "1개 사이트에서 사용",
  planFreeItem2: "저장 가림 3개",
  planFreeItem3: "개별 요소 범위",
  planFreeItem4: "저장 가림 관리·삭제",
  planFreeItem5: "사이트 일시중지",
  planProTitle: "Pro",
  planProItem1: "사이트 무제한",
  planProItem2: "저장 가림 무제한",
  planProItem3: "페이지 유형 범위",
  planProItem4: "사이트 전체 범위",
  planProButton: "Pro 구매하기",
  planProNote: "결제는 Lemon Squeezy에서 안전하게 처리됩니다.",

  // 한계 안내
  limitsTitle: "Cloakli가 하는 일과 하지 않는 일",
  limitsIntro: "Cloakli는 웹페이지 위에 시각적인 가림을 표시하는 도구입니다. 정확한 이해를 위해 다음을 확인해 주세요.",
  limit1: "Cloakli는 웹페이지의 원본 데이터를 삭제하거나 수정하지 않습니다. 화면에 보이는 내용을 시각적으로 덮을 뿐입니다.",
  limit2: "웹사이트 구조가 바뀌면 일부 저장 가림이 다시 적용되지 않을 수 있습니다.",
  limit3: "화면 공유나 녹화를 시작하기 전에, 가림이 의도대로 표시되는지 직접 확인해 주세요.",
  limit4: "브라우저 개발자 도구, 다른 확장 프로그램, 웹사이트 내부 데이터 접근 자체를 차단하는 보안 도구가 아닙니다.",
  limit5: "비밀번호 관리자나 데이터 유출 방지(DLP) 시스템을 대체하지 않습니다.",

  // FAQ
  faqTitle: "자주 묻는 질문",
  faq1Q: "Cloakli가 웹페이지 내용을 서버로 보내나요?",
  faq1A: "아니요. 웹페이지 본문, 이메일 내용, 제목, 이미지, 화면 캡처는 서버로 전송하지 않습니다. Pro 라이선스를 활성화한 경우에만 라이선스 확인에 필요한 정보(무작위 설치 ID, 라이선스 활성화 요청, 세션 토큰, 확장 프로그램 버전)가 라이선스 서버로 전송됩니다.",
  faq2Q: "가림은 다른 사람에게 실제로 보이지 않나요?",
  faq2A: "화면 공유·녹화에는 여러분의 화면에 그려진 그대로가 나갑니다. Cloakli의 가림은 화면 위에 그려지므로 공유 화면에서도 가려져 보입니다. 다만 공유를 시작하기 전에 가림 상태를 직접 확인하는 것은 사용자의 몫입니다.",
  faq3Q: "가림 상태에서도 링크를 클릭할 수 있나요?",
  faq3A: "네. 가려진 썸네일이나 링크도 클릭하면 원래대로 이동합니다. 가림은 시각적으로만 덮고 클릭은 원래 요소로 전달됩니다.",
  faq4Q: "새로고침 후에도 유지되나요?",
  faq4A: "네. 저장한 가림은 브라우저에 보관되어 새로고침하거나 같은 사이트를 다시 방문할 때 자동으로 다시 적용됩니다.",
  faq5Q: "어떤 사이트에서 작동하나요?",
  faq5A: "일반적인 http/https 웹사이트에서 작동합니다. 동적으로 화면이 바뀌는 사이트(YouTube, Gmail 등)도 지원하도록 설계했지만, 모든 사이트 구조와의 호환을 보장하지는 않습니다.",
  faq6Q: "Chrome 내부 페이지에서도 작동하나요?",
  faq6A: "아니요. chrome:// 설정 페이지, Chrome 웹 스토어, 새 탭 페이지 같은 브라우저 내부 화면에서는 Chrome 정책상 확장 프로그램이 동작할 수 없습니다.",
  faq7Q: "Free와 Pro의 차이는 무엇인가요?",
  faq7A: "Free는 1개 사이트에서 최대 3개의 가림을 '이 요소만' 범위로 저장할 수 있습니다. Pro는 사이트·가림 개수 제한이 없고, 같은 종류의 요소를 페이지 유형 또는 사이트 전체 범위로 한 번에 가릴 수 있습니다.",
  faq8Q: "라이선스 키는 몇 대에서 사용할 수 있나요?",
  faq8A: "라이선스 키 1개로 최대 3대의 기기에서 활성화할 수 있습니다. 사용하지 않는 기기는 팝업의 '이 기기에서 비활성화'로 슬롯을 반납할 수 있습니다.",
  faq9Q: "구독을 취소하면 어떻게 되나요?",
  faq9A: "결제 기간이 끝날 때까지 Pro를 계속 사용할 수 있고, 이후 Free로 전환됩니다. 자세한 내용은 환불·구독 정책을 확인하세요.",
  faq10Q: "Pro가 끝나면 기존 가림은 삭제되나요?",
  faq10A: "아니요. 저장해 둔 가림은 삭제되지 않고 계속 적용됩니다. Free 한도를 넘는 새 가림을 추가하는 것만 제한됩니다.",

  // 다운로드 페이지
  downloadTitle: "Cloakli 다운로드",
  downloadComingSoon: "Cloakli는 Chrome 웹 스토어 출시를 준비하고 있습니다.",
  downloadComingSoonDesc: "심사가 완료되면 이 페이지에서 바로 설치할 수 있습니다.",
  downloadChromeOnly: "Cloakli는 Chrome(및 Chromium 계열 브라우저)용 확장 프로그램입니다.",

  // 지원 페이지 (짧은 문구; 본문은 data-lang 블록)
  supportTitle: "지원·문의"
};
