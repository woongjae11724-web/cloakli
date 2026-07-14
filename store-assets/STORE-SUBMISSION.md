# Chrome Web Store 제출 절차 (수동 체크리스트)

> 이 문서는 절차 안내다. **실제 제출은 사용자가 대시보드에서 직접 수행한다.**

## 0. 사전 준비

- [ ] 개발자 계정: https://chrome.google.com/webstore/devconsole (1회 등록비 $5)
- [ ] 제출용 ZIP 생성: `npm.cmd run package:prod` → `releases/cloakli-v0.1.0.zip`
  - production 빌드에는 dev 배너/Mock provider/Developer Pro가 포함되지 않음 (validate:prod가 검증)
- [ ] 홈페이지 배포 완료 → privacy URL 확보 (`https://cloakli.pages.dev/privacy/`)
- [ ] site-config.js placeholder 확정 여부 확인: `npm.cmd run website:check:strict`

## 1. 항목 생성과 ZIP 업로드

1. 개발자 대시보드 → **+ New item** → `releases/cloakli-v0.1.0.zip` 업로드
2. 업로드 직후 대시보드가 표시하는 **item ID(= 확장 프로그램 ID)를 기록**한다.

## 2. ⚠️ 라이선스 서버에 production 확장 ID 등록 (필수)

스토어에 올라간 확장은 개발용 ID(`plmglihnkpcbgcnffoppchonpjojhkil`)와 **다른 새 ID**를 받는다.
이 ID를 Worker에 추가하지 않으면 **스토어 버전에서 Pro 활성화가 전부 거부된다.**

```bat
cd server
:: wrangler.toml의 ALLOWED_EXTENSION_IDS에 새 ID를 쉼표로 추가한 뒤
npx.cmd wrangler deploy
```

검증: 스토어 버전 설치 후 실제 라이선스 키로 활성화 1회 확인.

## 3. Store listing 탭

- Name / Short description / Detailed description: `en/listing.md`, `ko/listing.md`에서 복사
- 언어: 기본 English, "Add language"로 한국어 추가
- Category: Productivity
- 스크린샷(1280×800) 5장: `SCREENSHOTS.md`의 장면 정의대로 demo 픽스처에서 촬영 후 업로드
- 아이콘 128×128: `icons/icon128.png` (ZIP에 포함되어 자동 인식)
- 홈페이지 URL: `https://cloakli.pages.dev/` · 지원 URL: `https://cloakli.pages.dev/support/`
- 개발자 연락 이메일(Account 탭, 인증 필요): `cloakli.support@gmail.com`

## 4. Privacy practices 탭

`PRIVACY-DISCLOSURE.md`의 답안을 그대로 입력:
- Single purpose 문장
- 권한별 justification (activeTab / scripting / storage / alarms / host access)
- Data usage 체크리스트 (Authentication information만 Yes)
- Remote code: No
- Privacy policy URL: `https://cloakli.pages.dev/privacy/`

## 5. Distribution 탭

- Visibility: Public (또는 초기엔 Unlisted로 검수만 통과시키는 선택지도 있음)
- 국가: All regions (또는 원하는 지역)
- 결제: Free (Pro 결제는 외부 Lemon Squeezy에서 진행 — 스토어 인앱 결제 아님)

## 6. 검수 참고사항 (Notes to reviewer 칸)

영어로 다음 요지 기입 권장:

> The extension masks user-selected page regions before screen sharing. Host access is required to automatically re-apply the user's own saved masks on revisit. No page content is collected or transmitted. The optional Pro license is verified against our license server (cloakli-license.mycloakli.workers.dev) using a hashed key only. To test Pro: (테스트용 라이선스 키를 여기에 — 검수 제출 시점에 발급).

## 7. 제출 후

- [ ] 검수 통과 → 스토어 URL 확보 (`https://chromewebstore.google.com/detail/<id>`)
- [ ] `website/site-config.js`의 `chromeStoreUrl`에 입력 → 사이트의 "Add to Chrome" 버튼 자동 활성화
- [ ] `npm.cmd run website:deploy`로 사이트 재배포
- [ ] Lemon Squeezy 스토어 설정의 Website URL도 확인
