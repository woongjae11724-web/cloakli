# Chrome Web Store 제출 절차 (최종 체크리스트)

> 이 문서는 절차 안내다. **최종 제출 버튼은 사용자가 직접 누른다.**
> 제출용 파일: `releases/cloakli-v0.2.0.zip` (경로·해시는 최신 완료 보고 참조)

## 0. 사전 준비 — 완료 상태

- [x] 개발자 계정 등록비 결제 완료
- [x] production ZIP 생성·검증 (`npm.cmd run package:prod`)
- [x] 홈페이지·개인정보처리방침 배포: `https://cloakli.pages.dev`
- [x] Developer Pro OFF / Mock provider OFF (validate:prod가 강제)
- [ ] 스크린샷 5장 (SCREENSHOTS.md 절차대로 촬영)

## 1. Package — 항목 생성과 ZIP 업로드

1. https://chrome.google.com/webstore/devconsole 접속
2. **+ New item** 클릭 → `releases/cloakli-v0.2.0.zip` 업로드
3. 업로드 오류가 표시되면 그대로 기록해 Claude에게 전달 (manifest 오류 등)
4. 업로드 직후 대시보드 URL/항목 페이지에 표시되는 **32자 item ID(= 확장 프로그램 ID)를 복사**한다

## 2. ⚠️ 필수 — 확장 ID를 Claude에게 전달

스토어 항목은 unpacked 개발 ID와 **다른 새 ID**를 받는다. 이 ID가 라이선스 서버
(`ALLOWED_EXTENSION_IDS`)에 등록되기 전에는 **스토어 설치본에서 Pro 활성화가 전부
거부된다.** ID를 전달하면 Claude가 다음을 수행한다:

- Worker `ALLOWED_EXTENSION_IDS`에 Web Store ID 추가 (개발용 unpacked ID 3종과 구분 주석)
- `npx wrangler deploy` 재배포 + `/health` 200 확인
- 스토어 설치본 검증용 후속 체크리스트 제공

## 3. Store listing 탭

| 입력란 | 값 |
|---|---|
| 제품명 | `Cloakli` |
| 짧은 설명 (EN) | `Hide sensitive information on webpages before sharing your screen.` |
| 상세 설명 (EN) | [en/listing.md](en/listing.md)의 Detailed description 전체 복사 |
| 언어 추가: 한국어 | 짧은 설명 `화면 공유 전에 웹페이지에서 민감한 정보를 간편하게 가립니다.` + [ko/listing.md](ko/listing.md) 상세 설명 |
| 카테고리 | 대시보드가 보여주는 목록에서 선택 — **Productivity 계열(예: Productivity / Tools 또는 Workflow & Planning)** 중 가장 근접한 것. 화면에 없는 항목을 임의로 찾지 말 것 |
| 아이콘 128×128 | ZIP의 `icons/icon128.png`가 자동 인식됨 |
| 스크린샷 1280×800 ×5 | SCREENSHOTS.md 장면 1~5 |
| 프로모션 이미지 | 대시보드가 요구하는 경우 PROMO-ASSETS.md 규격으로 제작 후 업로드 (아직 미제작) |
| Homepage URL | `https://cloakli.pages.dev/` |
| Support URL | `https://cloakli.pages.dev/support/` |

## 4. Privacy practices 탭

[PRIVACY-DISCLOSURE.md](PRIVACY-DISCLOSURE.md)의 답안을 항목별로 그대로 입력:
단일 목적 → 권한별 justification 5개(activeTab/scripting/storage/alarms/host access) →
Data usage 체크(Authentication information만 예) → Remote code: **No** →
Privacy policy URL `https://cloakli.pages.dev/privacy/` → certification 3종 체크.

## 5. Distribution 탭

- **Visibility: 첫 제출은 Unlisted 권장** — 심사 통과 후 직접 설치·검증을 마친 뒤 Public으로 전환.
  (대시보드에 Unlisted가 보이지 않거나 다른 이름(예: Private/Trusted testers)이면 화면에 있는
  가장 제한적인 공개 옵션을 선택 — 존재하지 않는 옵션을 찾느라 멈추지 말 것)
- Regions: All regions (준비된 지역만 원하면 축소 가능)
- 결제: **Free** — Pro 결제는 확장 밖(Lemon Squeezy 웹)에서 이루어지며 스토어 인앱 결제가 아님

## 6. 심사자 테스트 안내 (Test instructions 입력란에 붙여넣기)

```
How to test (no account or license needed for core features):

1. Open any regular webpage (e.g. https://example.com or any news site).
2. Click the Cloakli extension icon.
3. Click "Select an area to hide". The page freezes for accurate selection.
4. Click a visible text or image element.
5. Choose "This element only". A solid "HIDDEN" overlay covers the element.
6. Reload the page — the mask is re-applied automatically.
7. Open the options page ("Manage saved masks") to view or delete saved masks.

Notes:
- The extension cannot run on chrome:// pages or the Chrome Web Store itself;
  please test on a normal HTTPS webpage.
- The free tier is limited to 3 saved masks on 1 site (single-element scope).
  Hitting the limit shows an inline explanation.
- Pro features (page-type / site-wide masking scopes) require a license key.
  A reviewer test key is provided in the secure test-credentials field of this
  dashboard, if such a field is available; the key activates against our
  license server (cloakli-license.mycloakli.workers.dev) and can be
  deactivated from the popup afterwards.
- No page content is collected or transmitted. The only network requests are
  license activation/validation calls to our own server, and only after a
  user enters a license key.
```

⚠️ **검토용 라이선스 키는 이 문서·코드·설명 어디에도 적지 않는다.** 대시보드에 심사자용
자격증명(테스트 계정/키)을 안전하게 입력하는 별도 입력란이 있으면 그곳에만 입력하고,
그런 입력란이 없으면 위 문단의 마지막 항목을 "Pro review key available on request"로
바꾸고 심사 회신으로만 전달한다. 키는 일반 고객 키가 아닌 검토 전용으로 새로 발급한다
(Lemon Squeezy test mode에서 테스트 결제 1건).

## 7. 제출 후 (Claude가 자동으로 진행할 작업)

- [ ] Worker allowlist에 Web Store ID 추가 + 재배포 + health 검사 (ID 전달 즉시)
- [ ] 심사 통과 후: 스토어 설치본에서 라이선스 활성화 1회 검증 체크리스트 제공
- [ ] `website/site-config.js`의 `chromeStoreUrl`에 스토어 상세 페이지 URL 입력
      (`https://chromewebstore.google.com/detail/<id>`) → `npm.cmd run website:deploy`
      → 홈페이지 "Add to Chrome" 버튼 자동 활성화
- [ ] 개발용 unpacked ID 3종은 개발 지속을 위해 allowlist에 유지 (출시 후 제거 여부는 별도 결정)
