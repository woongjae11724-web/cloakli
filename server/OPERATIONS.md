# Cloakli 라이선스 서버 운영 문서 (OPERATIONS.md)

배포 이후 일상 운영·장애 대응·사용자 지원 절차. 모든 명령은 `server/` 폴더에서 실행하며,
PowerShell에서 npm/npx 실행이 차단되면 `npm.cmd`/`npx.cmd`를 사용한다.

---

## 1. Worker 상태 확인

```bat
:: 서비스 생존 확인 (200 + ok:true 기대)
curl https://<worker-도메인>/health

:: 최근 배포 목록/버전
npx.cmd wrangler deployments list

:: 실시간 로그 (요청/오류 스트리밍, Ctrl+C로 종료)
npx.cmd wrangler tail
```

`wrangler tail` 출력에는 절대 secret이 나오면 안 된다 — 서버 코드는 webhook secret,
라이선스 키 원문, 세션 토큰 원문을 로그에 남기지 않도록 작성되어 있다. 만약 로그에서
민감값이 보이면 즉시 해당 코드 경로를 수정하고 secret을 교체한다(아래 3절).

## 2. D1 마이그레이션

새 마이그레이션 파일은 `migrations/NNNN_설명.sql`로 추가한다(기존 파일 수정 금지).

```bat
:: 로컬에서 먼저 검증
npx.cmd wrangler d1 migrations apply cloakli-license-db --local
npm.cmd test

:: 문제 없으면 원격 적용
npx.cmd wrangler d1 migrations apply cloakli-license-db --remote
```

원격 상태 확인:

```bat
npx.cmd wrangler d1 execute cloakli-license-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

## 3. secret 교체 (유출 의심/정기 교체)

### webhook secret
1. Lemon Squeezy → Settings → Webhooks → 해당 웹훅의 Signing secret을 새 무작위 값으로 변경
2. 즉시 `npx.cmd wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET`에 같은 값 입력
3. 두 값이 갈리는 짧은 시간 동안 웹훅이 401로 거부될 수 있음 — Lemon Squeezy는 실패한
   웹훅을 재시도하므로 교체 후 웹훅 목록에서 실패 건 재전송(Resend)으로 복구

### 관리자 secret
```bat
npx.cmd wrangler secret put CLOAKLI_ADMIN_SECRET
```
기존 값을 쓰는 내부 스크립트가 있다면 함께 갱신.

### 세션 토큰 무효화(비상)
세션 토큰은 서버가 서명하지 않고 D1의 해시로만 대조하므로, 전체 무효화가 필요하면:
```bat
npx.cmd wrangler d1 execute cloakli-license-db --remote --command "UPDATE license_instances SET session_token_hash = NULL, deactivated_at = strftime('%s','now')*1000 WHERE deactivated_at IS NULL"
```
→ 모든 사용자는 라이선스 키 재입력으로 재활성화해야 함(오프라인 유예 최대 7일 후 Free 전환).

## 4. 장애 대응

| 상황 | 증상 | 대응 |
|---|---|---|
| Worker 장애 | /health 실패, 5xx | `wrangler tail`로 오류 확인 → 직전 배포로 롤백: `npx.cmd wrangler rollback` (또는 `wrangler deployments list`에서 버전 지정) |
| Lemon Squeezy 장애 | 신규 활성화 실패 | 기존 사용자는 세션 토큰+D1 기반 재검증이라 영향 없음. 오프라인 유예(7일)도 동작. 신규 활성화만 안내 후 대기 |
| webhook 실패 누적 | 취소/만료가 반영 안 됨 | Lemon Squeezy 웹훅 화면에서 실패 건 확인 → 서명/URL 확인 → Resend. D1 `webhook_events`의 processing_status='failed' 집계로 교차 확인 |
| 라이선스 검증 실패 급증 | validate 4xx/5xx 급증 | `wrangler tail` + D1 rate_limit_events 확인. rate limit 오탐이면 상수 조정 후 재배포 |
| 잘못된 production 빌드 배포(확장) | Developer Pro/localhost 등 | 스토어에서 이전 버전 재게시. `npm.cmd run validate:prod`가 애초에 차단하도록 되어 있으므로, 우회 배포 금지 |

웹훅 처리 현황 집계(개인정보 없음):

```bat
npx.cmd wrangler d1 execute cloakli-license-db --remote --command "SELECT provider_event_name, processing_status, count(*) FROM webhook_events GROUP BY 1,2"
```

## 5. 라이선스 사용자 지원

원칙: **사용자에게 라이선스 키 원문을 채팅/이메일로 요구하지 않는다.**
주문 이메일 주소·주문 번호로 Lemon Squeezy 대시보드(Orders/Subscriptions)에서 조회한다.

### activation limit 초과 문의
1. Lemon Squeezy 대시보드 → 해당 주문의 License key 상세에서 활성 인스턴스 확인
2. 사용자가 이전 기기에서 직접 "이 기기에서 비활성화"를 누르도록 안내(권장), 또는
3. 대시보드에서 인스턴스 비활성화(Deactivate instance)
4. D1 쪽 상태는 다음 validate 때 provider/웹훅 기준으로 정합화됨

### 기기 비활성화 요청(기기 분실 등)
- 대시보드에서 해당 키의 인스턴스를 비활성화 → 사용자는 남은 슬롯으로 재활성화

### 구독 상태 확인
- Lemon Squeezy → Subscriptions에서 상태(active/cancelled/expired/past_due) 확인
- 서버 쪽 반영 여부는 webhook_events 집계로 교차 확인

### 관리자 집계 조회(개별 정보 아님)
```bat
curl -H "Authorization: Bearer <CLOAKLI_ADMIN_SECRET>" https://<worker-도메인>/v1/admin/license-summary
```
반환값은 활성/비활성 라이선스 수 등 집계뿐이며 키 원문·이메일·설치 ID는 절대 포함되지 않는다.

## 6. 환경 변수/secret 체크리스트

| 이름 | 종류 | 위치 | 비고 |
|---|---|---|---|
| LEMONSQUEEZY_WEBHOOK_SECRET | secret | wrangler secret | Lemon Squeezy 웹훅 Signing secret과 동일 값 |
| CLOAKLI_ADMIN_SECRET | secret | wrangler secret | 집계 조회 전용, 다른 곳에 재사용 금지 |
| ENVIRONMENT | var | wrangler.toml | production 블록에서 "production" |
| LICENSE_PROVIDER | var | wrangler.toml | production에서 반드시 "lemonsqueezy" (mock이면 서버가 요청 시 즉시 에러) |
| LEMONSQUEEZY_PRODUCT_ID | var | wrangler.toml | 상품 검증용 |
| LEMONSQUEEZY_VARIANT_ID | var | wrangler.toml | variant 검증용 |
| ALLOWED_EXTENSION_IDS | var | wrangler.toml | 개발 ID + (출시 후) Web Store ID, 콤마 구분. "*" 금지 |
| LEMONSQUEEZY_API_KEY | — | 등록 안 함 | 현재 구현이 사용하지 않음 (License API는 키 불요) |
| CLOAKLI_SESSION_TOKEN_SECRET | — | 등록 안 함 | 세션 토큰은 무작위+해시 방식이라 불필요 |
