# Cloakli 실서비스 연결 체크리스트 (9단계: Lemon Squeezy 실계정 + Cloudflare 배포)

이 문서는 [SETUP.md](SETUP.md)(전체 개념 설명)와 달리, **실제 계정 연결 시점에 사용자가
직접 클릭해야 하는 작업**만 순서대로 정리한 실행 체크리스트입니다.

각 항목 앞의 체크박스를 완료할 때마다 표시하세요.

---

## A. Cloudflare (Claude가 명령 실행, 사용자는 로그인 승인만)

- [ ] **A1. Wrangler 로그인 승인** — `npx.cmd wrangler login` 실행 시 브라우저가 열리면:
  1. Cloudflare 계정으로 로그인
  2. "Allow" 버튼 클릭
  - 이후 확인: `npx.cmd wrangler whoami`가 계정 정보를 표시하면 완료.

로그인만 완료되면 아래는 전부 Claude(또는 명령 복사-붙여넣기)로 진행 가능합니다:

```bat
:: D1 생성 (출력된 database_id를 wrangler.toml에 반영)
npx.cmd wrangler d1 create cloakli-license-db

:: 원격 마이그레이션
npx.cmd wrangler d1 migrations apply cloakli-license-db --remote

:: 테이블 확인
npx.cmd wrangler d1 execute cloakli-license-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"

:: 배포
npx.cmd wrangler deploy
```

### Cloudflare secret 등록 (Lemon Squeezy 설정 완료 후)

이 서버 구현이 실제로 사용하는 secret은 **2개뿐**입니다.
(`LEMONSQUEEZY_API_KEY`는 License API가 키를 요구하지 않아 불필요,
`CLOAKLI_SESSION_TOKEN_SECRET`은 세션 토큰이 무작위+해시 방식이라 불필요 — 등록하지 마세요.)

```bat
:: B단계에서 복사한 webhook Signing secret 입력
npx.cmd wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET

:: 관리자 집계 조회용 무작위 긴 문자열 입력 (직접 생성, 재사용 금지)
npx.cmd wrangler secret put CLOAKLI_ADMIN_SECRET
```

값 입력 시 화면에 다시 출력하거나 파일/채팅에 붙여넣지 마세요.

### secret이 아닌 값 (wrangler.toml [vars] — production 환경 블록)

```text
ENVIRONMENT = "production"
LICENSE_PROVIDER = "lemonsqueezy"   ← production에서 "mock" 금지(서버가 즉시 에러)
LEMONSQUEEZY_PRODUCT_ID = "<B단계에서 확인>"
LEMONSQUEEZY_VARIANT_ID = "<B단계에서 확인>"
ALLOWED_EXTENSION_IDS = "<개발용 ID>,<Web Store 출시 후 발급될 ID>"
```

---

## B. Lemon Squeezy (사용자 직접 작업)

### B1. 판매자 계정/스토어
- [ ] https://app.lemonsqueezy.com 가입 후 이메일 인증
- [ ] **Settings → Stores**에서 스토어 생성 (이름/국가)
- [ ] **Settings → Payouts**에서 지급 정보 입력 — 판매자 승인 전에는 실결제가 완료되지 않을 수 있음
- [ ] **Store ID 확인**: Settings → Stores에서 스토어 옆 숫자 ID (참고: 현재 서버 코드는 Store ID를 사용하지 않으므로 기록만 해두면 됨)

### B2. Cloakli Pro 상품
- [ ] **Store → Products → “+ New product”** 클릭
- [ ] 이름: `Cloakli Pro`
- [ ] **가격**: 아래 중 선택 (코드에는 하드코딩하지 않음 — variant ID로만 연결)
  - 권장 초기안: 월간 US$4.99 (+ 선택: 연간 US$39.99 variant 추가)
  - 이번 기술 검증에는 **월간 1개만으로 충분**
- [ ] 가격 유형에서 **Subscription** 선택(월간)
- [ ] 상품 편집 화면의 **License keys 섹션** → “Generate license keys” 활성화
- [ ] **Activation limit: 3** 입력 (한 사용자의 데스크톱/노트북 다중 설치 허용, 무제한 공유 방지.
      실제 한도 판정은 서버가 provider 응답을 그대로 따르므로 여기 값이 기준이 됨)
- [ ] 저장 후 **Share(공유) 버튼 → checkout URL 복사** → `build-config.js`의 `checkoutUrl`에 전달
- [ ] **Product ID / Variant ID 확인**: 상품 페이지 URL의 숫자, 또는 상품 편집 화면의 variant 목록에서 확인
      (API로 확인하려면 Settings → API에서 키 발급 후 `GET https://api.lemonsqueezy.com/v1/products` —
      이 키는 확인 용도로만 쓰고 서버에는 등록하지 않음)

### B3. Webhook
- [ ] **Settings → Webhooks → “+”** 클릭
- [ ] Callback URL: `https://<배포된 Worker 도메인>/v1/webhooks/lemonsqueezy`
- [ ] **Signing secret**: 무작위 긴 문자열 입력(직접 생성) — 복사해 두었다가
      `npx.cmd wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET`에 그대로 입력 (두 곳 값이 동일해야 함)
- [ ] 이벤트 선택(서버 handler와 일치, 현재 구현 기준):
  - `order_created`
  - `subscription_created`
  - `subscription_updated`
  - `subscription_cancelled`
  - `subscription_expired`
  - `subscription_resumed`
  - `subscription_payment_failed`
  - `subscription_payment_success`
  - `license_key_created`
  - `license_key_updated`
- [ ] 저장 후 웹훅 상세 화면의 **테스트 전송(Send test event)** 기능으로 이벤트 1건 발송 →
      Worker가 2xx로 응답하는지, D1 `webhook_events`에 기록되는지 확인

### B4. 테스트 결제 (Test mode)
- [ ] 대시보드 좌측 하단(또는 상단)의 **Test mode 토글**을 켠 상태에서 진행
- [ ] Test mode에서는 실제 청구가 발생하지 않으며, 결제 화면에 Lemon Squeezy가 안내하는
      **공식 테스트 카드 정보**가 표시됩니다(결제 페이지의 안내를 그대로 사용 — 임의 카드번호 사용 금지)
- [ ] Test mode용 상품/웹훅은 live mode와 별개로 관리될 수 있으니, 테스트 시 웹훅도 Test mode에서 생성됐는지 확인
- [ ] 테스트 checkout 완료 → 이메일/주문 화면에서 **라이선스 키 확인**
- [ ] Cloakli DEV 팝업에 키 입력 → `Pro 활성화` → "License Pro" 표시 확인

### B5. Live 전환 시
- [ ] Test mode를 끄고 live 상품/웹훅/checkout URL을 다시 확인
- [ ] live 웹훅의 Signing secret이 Cloudflare secret과 일치하는지 재확인

---

## C. 확장 프로그램 연결

- [ ] `build-config.js`의 `licenseServerUrl`을 배포된 `https://…workers.dev` URL로 변경
- [ ] `build-config.js`의 `checkoutUrl`을 B2에서 복사한 URL로 변경
- [ ] `chrome://extensions`에서 **Cloakli DEV의 32자 ID 복사** → `ALLOWED_EXTENSION_IDS`에 추가 → `npx.cmd wrangler deploy`
- [ ] **Web Store 출시 전 필수**: 스토어 등록 후 발급되는 production 확장 ID를
      `ALLOWED_EXTENSION_IDS`에 추가해야 함 (아직 없음 — 10단계에서 진행).
      CORS는 보조 방어일 뿐이며, 실제 보안은 라이선스/세션 검증이 담당함.
- [ ] `npm.cmd run release:check` → 통과 후 `npm.cmd run package:prod`

---

## 진행 상태 기록 (9단계 실행 시점)

| 항목 | 상태 |
|---|---|
| 로컬 자동 테스트(확장/서버) | ✅ 완료 |
| Mock provider 전체 흐름 | ✅ 완료 |
| D1 로컬 마이그레이션 + 원문 미저장 검증 | ✅ 완료 |
| wrangler dev 로컬 endpoint 13종 검증 | ✅ 완료 |
| Cloudflare 로그인 | 사용자 승인 대기 |
| D1 원격 생성/마이그레이션 | 로그인 후 진행 |
| Worker 배포 | 로그인 후 진행 |
| Lemon Squeezy 상품/웹훅/테스트 결제 | 사용자 작업(B단계) |
