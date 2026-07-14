# Cloakli 라이선스 서버 설정 가이드

이 문서는 Cloakli Pro 결제(Lemon Squeezy)와 라이선스 검증 서버(Cloudflare Workers + D1)를
처음부터 실제로 연결하는 방법을 순서대로 설명합니다. 이 문서에 나온 절차를 실행하기
전까지는 **실제 결제가 동작하지 않습니다** — 확장 프로그램은 `server/wrangler.toml.example`,
`server/.dev.vars.example`에 있는 placeholder 값만 갖고 있고, 실제 계정/키는 아무 곳에도
없습니다.

이 문서는 Windows 기준 명령어를 우선 표기하고, macOS/Linux 명령이 다르면 함께 적습니다.

## 0. 준비물

- Node.js 18 이상 (이미 설치되어 있다고 가정합니다)
- Lemon Squeezy 계정 (결제/라이선스 키 발급)
- Cloudflare 계정 (Workers + D1로 검증 서버 배포)

### PowerShell에서 npm/npx가 막히는 경우

PowerShell 실행 정책 때문에 `npm ...`, `npx ...` 명령이
"이 시스템에서 스크립트를 실행할 수 없으므로..." 오류로 막히는 경우가 있습니다. 이때는:

- `npm.cmd ...`, `npx.cmd ...`처럼 `.cmd` 확장자를 직접 붙이거나
- PowerShell 대신 `cmd.exe`를 사용하거나
- (선택) 관리자 권한 없이 현재 사용자 범위에서만 정책을 완화:
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

아래 모든 명령은 `npm`/`npx`로 적었지만, 위 문제가 있으면 `npm.cmd`/`npx.cmd`로 바꿔 실행하세요.

---

## 1. Lemon Squeezy 설정

### 1.1 계정 생성

1. https://www.lemonsqueezy.com 에서 "Sign up" 으로 계정을 만듭니다.
2. 이메일 인증을 완료합니다.

### 1.2 스토어(Store) 생성

1. 대시보드 왼쪽 메뉴에서 **Stores**로 이동합니다.
2. 스토어가 없다면 안내에 따라 새 스토어를 만듭니다(스토어 이름, 국가 등 기본 정보 입력).
3. **판매자(Seller) 승인 / 결제 정보(payout information)**: Settings → Payouts(또는
   Settings → Store) 메뉴에서 실제로 대금을 받을 계좌/결제 정보를 입력하고 승인을
   기다려야 합니다. 이 승인이 끝나기 전에는 실제 결제가 완료되지 않을 수 있습니다.

### 1.3 Cloakli Pro 상품(Product) 생성

1. **Products** → **New Product**로 이동합니다.
2. 이름을 예: `Cloakli Pro`로 입력합니다.
3. **가격 방식**: 구독(Subscription, 월/연 정기결제)으로 할지, 1회성(One-time payment,
   평생 라이선스)으로 할지 결정합니다. 어느 쪽이든 이 서버 구현(`server/`)은 그대로
   동작하며(웹훅으로 상태를 갱신), 가격 방식은 순전히 비즈니스 결정입니다.
4. **라이선스 키 발급(License Key) 활성화**: 상품 설정에서 "License keys"(또는
   "Licensing") 옵션을 켭니다. 이 옵션이 켜져야 결제 후 사용자에게 라이선스 키가
   발급되고, `server/src/services/licenseProviders/LemonSqueezyLicenseProvider.js`가
   호출하는 `/v1/licenses/activate` 등의 License API를 쓸 수 있습니다.
5. **활성화 기기 수 제한(Activation Limit)**: 상품/변형(Variant) 설정에서 라이선스 키
   하나당 활성화 가능한 기기 수를 정합니다(예: 3대). 이 값은 Lemon Squeezy가 관리하며,
   `server/src/routes/activate.js`가 활성화 요청 시 이 값을 그대로 확인합니다.
6. 저장 후 **Checkout URL**을 복사해 둡니다(상품 상세 페이지 또는 Share 버튼에서 확인
   가능). 이 URL을 아래 3단계에서 확장 프로그램의 `build-config.js`(`checkoutUrl`)에
   넣습니다.

### 1.4 Store ID / Product ID / Variant ID 확인

- **Store ID**: Settings → General(또는 API 문서의 스토어 목록)에서 숫자 ID를 확인합니다.
- **Product ID / Variant ID**: 상품 상세 페이지 URL이나 Lemon Squeezy API(`GET
  /v1/products`, `GET /v1/variants`)로 조회할 수 있습니다. 각각 이 서버의
  `LEMONSQUEEZY_PRODUCT_ID`, `LEMONSQUEEZY_VARIANT_ID` 값으로 사용됩니다.

### 1.5 웹훅(Webhook) 생성

1. Settings → **Webhooks** → **Add webhook**으로 이동합니다.
2. **Callback URL**: 아직 Cloudflare Worker를 배포하지 않았다면 이 단계는 2단계를
   끝낸 뒤 다시 와서 입력합니다(Worker 배포 후 나오는 실제 URL + `/v1/webhooks/lemonsqueezy`).
3. **이벤트 선택(Events)**: 최소한 다음 이벤트를 체크합니다.
   - `order_created`
   - `subscription_created`
   - `subscription_updated`
   - `subscription_cancelled`
   - `subscription_expired`
   - `subscription_payment_failed`
   - `subscription_resumed`
   - `license_key_created`
   - `license_key_updated`
4. 저장하면 **Signing secret**이 발급됩니다. 이 값을 복사해 두었다가
   `LEMONSQUEEZY_WEBHOOK_SECRET`으로 Cloudflare에 등록합니다(2.6 참고). 이 값은
   절대 확장 프로그램 코드나 Git 저장소에 넣지 않습니다.

---

## 2. Cloudflare Workers 설정

### 2.1 계정 생성 및 Wrangler 로그인

1. https://dash.cloudflare.com 에서 계정을 만듭니다(무료 플랜으로 충분합니다).
2. 저장소 루트가 아니라 `server/` 폴더에서 의존성을 설치하고 로그인합니다.

   ```powershell
   cd server
   npm.cmd install --save-dev wrangler
   npx.cmd wrangler login
   ```

   브라우저가 열리면 Cloudflare 계정으로 로그인해 CLI에 권한을 허용합니다.

### 2.2 wrangler.toml 만들기

```powershell
# server/ 폴더 안에서
copy wrangler.toml.example wrangler.toml
```

(macOS/Linux: `cp wrangler.toml.example wrangler.toml`)

`wrangler.toml`은 `.gitignore`에 등록되어 있어 커밋되지 않습니다. 이후 이 파일 안의
`database_id`, `ALLOWED_EXTENSION_IDS` 등을 아래 단계에서 채웁니다.

### 2.3 D1 데이터베이스 생성

```powershell
npx.cmd wrangler d1 create cloakli-license-db
```

출력되는 `database_id`를 `wrangler.toml`의 `[[d1_databases]]` 블록 `database_id = "..."`에
붙여 넣습니다.

### 2.4 마이그레이션 적용

```powershell
# 로컬(개발용) DB에 적용
npx.cmd wrangler d1 migrations apply cloakli-license-db --local

# 실제 배포된 원격 DB에 적용(운영 준비가 되었을 때)
npx.cmd wrangler d1 migrations apply cloakli-license-db --remote
```

`server/migrations/0001_init.sql`이 `licenses`/`license_instances`/`webhook_events`/
`rate_limit_events` 테이블을 만듭니다.

### 2.5 로컬 개발용 비밀값(.dev.vars) 만들기

```powershell
copy .dev.vars.example .dev.vars
```

`.dev.vars`를 열어 1단계에서 얻은 실제 값을 채웁니다. 이 파일도 `.gitignore`에
등록되어 있어 커밋되지 않습니다.

```
LEMONSQUEEZY_WEBHOOK_SECRET=<1.5에서 복사한 Signing secret>
LEMONSQUEEZY_STORE_ID=<1.4에서 확인한 Store ID>
LEMONSQUEEZY_PRODUCT_ID=<1.4에서 확인한 Product ID>
LEMONSQUEEZY_VARIANT_ID=<1.4에서 확인한 Variant ID>
LEMONSQUEEZY_CHECKOUT_URL=<1.3에서 복사한 Checkout URL>
CLOAKLI_ADMIN_SECRET=<직접 무작위로 만든 긴 문자열(추측 불가능해야 함)>
ENVIRONMENT=development
```

`CLOAKLI_ADMIN_SECRET`은 아무 계정에도 속하지 않는, 이 서버만을 위해 새로 만드는
값입니다(예: `openssl rand -hex 32` 또는 비밀번호 관리자의 "무작위 생성" 기능 사용).
Lemon Squeezy나 Cloudflare 계정 비밀번호를 재사용하지 마세요.

### 2.6 로컬 실행

```powershell
npx.cmd wrangler dev
```

`http://127.0.0.1:8787` (기본값)에서 서버가 뜹니다. 이 주소는 확장 프로그램의
`build-config.js`(`licenseServerUrl`, 개발 빌드 기본값)와 일치해야 로컬 테스트가 됩니다.

```powershell
curl http://127.0.0.1:8787/health
```

`{"ok":true}` 형태 응답이 오면 정상입니다.

### 2.7 운영(production) 비밀값 등록

로컬 `.dev.vars`와 별개로, 실제 배포본에는 `wrangler secret put`으로 비밀값을 등록합니다
(이 값은 Cloudflare에만 저장되고, 로컬 파일이나 Git 저장소에는 남지 않습니다).

```powershell
npx.cmd wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET
npx.cmd wrangler secret put LEMONSQUEEZY_STORE_ID
npx.cmd wrangler secret put LEMONSQUEEZY_PRODUCT_ID
npx.cmd wrangler secret put LEMONSQUEEZY_VARIANT_ID
npx.cmd wrangler secret put LEMONSQUEEZY_CHECKOUT_URL
npx.cmd wrangler secret put CLOAKLI_ADMIN_SECRET
```

각 명령을 실행하면 값을 입력하라는 프롬프트가 뜹니다. `wrangler.toml`의
`[env.production.vars]`에는 비밀이 아닌 값(`ENVIRONMENT`, `ALLOWED_EXTENSION_IDS`,
`LICENSE_PROVIDER`)만 넣습니다.

`LICENSE_PROVIDER`는 운영 환경에서 반드시 `lemonsqueezy`여야 합니다. `mock`으로 두면
서버가 요청을 처리하는 시점에 즉시 에러를 던지도록 코드에서 강제되어 있습니다
(`server/src/services/licenseProviders/index.js`).

### 2.8 배포

```powershell
npx.cmd wrangler deploy
```

배포가 끝나면 `https://cloakli-license.<your-subdomain>.workers.dev` 같은 실제 URL이
출력됩니다. 이 URL을:

1. **1.5단계**로 돌아가 Lemon Squeezy 웹훅의 Callback URL에
   `<Worker URL>/v1/webhooks/lemonsqueezy`로 입력합니다.
2. 확장 프로그램의 **production** `build-config.js`(`licenseServerUrl`)에 넣습니다
   (아래 3단계 참고). `scripts/validate-release.js`가 이 값이 `https://`이고
   `localhost`/`127.0.0.1`이 아닌지 자동으로 확인하며, 통과하지 못하면 출시용 ZIP
   생성 자체가 실패합니다 — 즉 이 값을 실제로 채우기 전에는 배포 ZIP을 만들 수 없습니다.

### 2.9 확장 프로그램 ID 등록 (CORS)

Chrome 확장 프로그램을 한 번이라도 로드하면 `chrome://extensions`에서 32자리 ID를
확인할 수 있습니다. 이 ID(개발용/배포용 각각)를 `ALLOWED_EXTENSION_IDS`(콤마로 구분,
`wrangler.toml`의 `[vars]`/`[env.production.vars]`)에 추가해야 팝업/옵션 페이지에서
보내는 요청이 CORS를 통과합니다. `*`(전체 허용)는 운영 환경에서 절대 쓰지 않습니다.

---

## 3. 확장 프로그램 쪽 설정

루트의 `build-config.js`에서 다음 두 값을 채웁니다(둘 다 비밀값이 아니라, 그냥 서버
주소/체크아웃 링크입니다 — 확장 프로그램 코드에는 API 키나 웹훅 시크릿을 절대 넣지
않습니다).

```js
licenseServerUrl: "https://cloakli-license.<your-subdomain>.workers.dev", // 2.8에서 배포된 실제 URL
checkoutUrl: "https://<your-store>.lemonsqueezy.com/checkout/...",        // 1.3에서 복사한 Checkout URL
```

`npm run build:prod`(`scripts/build.js`)가 출시용 폴더에도 이 값을 그대로 반영합니다.
`npm run validate:prod`가 `licenseServerUrl`이 비어있거나, `http://`이거나,
localhost/127.0.0.1이면 실패합니다 — 즉 실제 배포 URL을 넣기 전에는 출시 ZIP을
만들 수 없습니다(의도된 안전장치입니다).

---

## 4. 전체 흐름 확인 체크리스트

1. `server`: `npm test` — 서버 자동 테스트 통과 확인(Mock 라이선스 제공자로 activate/
   validate/deactivate 흐름을 검증합니다. 실제 Lemon Squeezy API 호출은 이 테스트에
   포함되지 않습니다).
2. `server`: `npx wrangler dev`로 로컬 서버 기동 후 `curl http://127.0.0.1:8787/health`.
3. 확장 프로그램을 개발 모드로 로드하고 팝업에서 "라이선스 키 입력"으로 실제 Lemon
   Squeezy 테스트 결제 후 발급된 키를 입력해 활성화되는지 확인(실제 결제 필요).
4. Lemon Squeezy 대시보드에서 구독을 취소해 보고, 웹훅이 도착해 D1의 라이선스 상태가
   바뀌는지, 다음 "라이선스 다시 확인"에서 Free로 전환되는지 확인.
5. `npm run validate:prod`, `npm run package:prod`(루트) — production 설정이 채워진
   뒤에만 통과합니다.

---

## 아직 이 문서만으로는 되지 않는 것

- 이 문서의 값들을 채우기 전까지 확장 프로그램은 계속 Free로만 동작합니다(정상입니다).
- 실제 결제 테스트에는 Lemon Squeezy의 테스트 모드(있다면) 또는 실제 소액 결제가
  필요합니다 — 이 저장소의 자동화는 여기까지 대신해 줄 수 없습니다.
