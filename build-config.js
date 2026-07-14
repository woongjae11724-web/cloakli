// Cloakli 빌드 설정 — 단 하나의 파일로 개발 빌드와 출시 빌드의 차이를 결정한다.
//
// entitlement.js(Developer Pro 여부)와 content.js(디버그 로그 여부)가 이 값만 참조하며,
// 다른 파일에서 별도의 빌드 상수를 만들지 않는다. chrome.storage에는 저장하지 않으므로,
// 일반 사용자가 storage 값을 바꿔서 이 설정을 바꿀 방법이 없다.
//
// scripts/build.js가 출시(production) 빌드를 만들 때는 원본 소스의 이 파일을 건드리지
// 않고, 출력 폴더(dist/production) 안의 build-config.js **사본만** developerPro/debug를
// 항상 강제로 끈다({ mode: "production", developerPro: false, debug: false }). 반면
// licenseServerUrl/checkoutUrl은 비밀값이 아니므로 이 소스 파일의 값을 그대로 가져간다 —
// scripts/validate-release.js가 이 값이 실제 배포 URL(https, localhost 아님)인지 확인하고,
// 아니면 출시 ZIP 생성을 막는다.
//
// 개발 빌드(dist/development)는 이 파일을 그대로(수정 없이) 복사하므로, 개발자가 아래
// developerPro 값을 로컬에서 true로 바꿔 두면 그 상태 그대로 개발 빌드에 반영된다.
(function (root) {
  "use strict";

  const CLOAKLI_BUILD_CONFIG = {
    // "development" | "production" — 참고용 메타데이터. 실제 동작을 가르는 것은
    // developerPro/debug 값이며, scripts/validate-release.js가 production 빌드에서
    // 이 값이 정확히 "production"인지도 함께 검사한다.
    mode: "development",
    // 개발자 전용 Pro 테스트 스위치. 출시 빌드에서는 항상 false로 강제된다.
    developerPro: true,
    // 디버그 로그 스위치. 출시 빌드에서는 항상 false로 강제된다.
    debug: false,
    // Cloakli 라이선스 서버(Cloudflare Worker) 주소. 로컬에서 `wrangler dev`를 돌릴 때의
    // 기본 포트를 가리킨다. 비밀이 아니며(공개 API 엔드포인트 주소일 뿐), 서버 안의
    // Lemon Squeezy 키/webhook secret과는 무관하다.
    licenseServerUrl: "http://127.0.0.1:8787",
    // Lemon Squeezy Checkout URL. 아직 실제 상품을 만들지 않았다면 빈 문자열로 두세요 —
    // popup은 빈 값이면 새 탭을 열지 않고 "아직 준비되지 않았다"는 안내만 표시합니다.
    checkoutUrl: "",
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CLOAKLI_BUILD_CONFIG;
  } else {
    root.CloakliBuildConfig = CLOAKLI_BUILD_CONFIG;
  }
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);
