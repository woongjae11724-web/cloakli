// 회귀/정적 점검 테스트: manifest 유효성, 파일 존재 여부, 메시지 이름 일치,
// 외부 네트워크 호출/외부 CDN/eval 미사용 등을 파일 내용을 직접 읽어 확인한다.
// 브라우저나 chrome.* API 없이 파일 시스템만으로 검증 가능한 것들을 모아 둔다.
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}
function exists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

describe("manifest.json", () => {
  let manifest;
  test("유효한 JSON이며 파싱된다", () => {
    manifest = JSON.parse(read("manifest.json"));
    assert.ok(manifest);
  });

  test("Manifest V3 문법을 따른다", () => {
    assert.equal(manifest.manifest_version, 3);
    assert.ok(manifest.action && manifest.action.default_popup, "action.default_popup이 있어야 한다");
    assert.ok(manifest.background && manifest.background.service_worker, "background.service_worker가 있어야 한다");
  });

  test("설정(options) 페이지가 등록되어 있다", () => {
    assert.ok(manifest.options_ui && manifest.options_ui.page === "options.html");
  });

  test("필요한 권한만 선언되어 있다 (activeTab, alarms, scripting, storage)", () => {
    const perms = manifest.permissions.slice().sort();
    // alarms는 8단계(라이선스 검증)에서 background.js가 chrome.alarms로 주기적
    // 재검증을 예약하기 위해 추가했다. 그 외 불필요한 권한은 여전히 없어야 한다.
    assert.deepEqual(perms, ["activeTab", "alarms", "scripting", "storage"]);
  });

  test("host_permissions나 <all_urls>를 사용하지 않는다", () => {
    assert.equal(manifest.host_permissions, undefined);
    const json = JSON.stringify(manifest);
    assert.ok(!json.includes("<all_urls>"));
  });

  test("content_scripts가 content-core.js를 content.js보다 먼저 로드한다", () => {
    const entry = manifest.content_scripts[0];
    const coreIdx = entry.js.indexOf("content-core.js");
    const contentIdx = entry.js.indexOf("content.js");
    assert.ok(coreIdx !== -1 && contentIdx !== -1 && coreIdx < contentIdx);
  });

  test("content_scripts가 all_frames를 강제로 켜지 않는다 (iframe 내부 미지원 원칙 유지)", () => {
    const entry = manifest.content_scripts[0];
    assert.equal(entry.all_frames, undefined);
  });

  test("키보드 단축키(commands)가 정확히 두 개 등록되어 있다", () => {
    assert.ok(manifest.commands, "commands가 있어야 한다");
    const names = Object.keys(manifest.commands).sort();
    assert.deepEqual(names, ["start-selection", "temporarily-clear-page"]);
  });

  test("각 command에 기본 단축키(default)와 Mac 단축키(mac)가 지정되어 있다", () => {
    Object.values(manifest.commands).forEach((command) => {
      assert.ok(command.suggested_key && command.suggested_key.default, "default 단축키가 있어야 한다");
      assert.ok(command.suggested_key.mac, "mac 단축키가 있어야 한다");
      assert.ok(command.description, "description이 있어야 한다");
    });
  });

  test("manifest.json이 가리키는 모든 파일이 실제로 존재한다", () => {
    assert.ok(exists(manifest.action.default_popup));
    assert.ok(exists(manifest.background.service_worker));
    assert.ok(exists(manifest.options_ui.page));
    manifest.content_scripts.forEach((entry) => {
      (entry.js || []).forEach((f) => assert.ok(exists(f), `${f} 파일이 있어야 한다`));
      (entry.css || []).forEach((f) => assert.ok(exists(f), `${f} 파일이 있어야 한다`));
    });
  });
});

describe("필요한 파일이 모두 존재한다", () => {
  const requiredFiles = [
    "manifest.json",
    "popup.html",
    "popup.css",
    "popup.js",
    "content.js",
    "content-core.js",
    "content.css",
    "background.js",
    "tab-actions.js",
    "entitlement.js",
    "build-config.js",
    "options.html",
    "options.css",
    "options.js",
    "README.md",
    "icons",
  ];

  requiredFiles.forEach((file) => {
    test(`${file} 이(가) 존재한다`, () => {
      assert.ok(exists(file), `${file} 이(가) 없다`);
    });
  });
});

describe("메시지 이름 일치 (popup.js <-> content.js)", () => {
  test("START_SELECTION_MODE, CLEAR_ALL_MASKS 문자열이 양쪽에 정확히 존재한다", () => {
    const popupSrc = read("popup.js");
    const contentSrc = read("content.js");
    ["START_SELECTION_MODE", "CLEAR_ALL_MASKS"].forEach((name) => {
      assert.ok(popupSrc.includes(`"${name}"`), `popup.js에 "${name}"이 있어야 한다`);
      assert.ok(contentSrc.includes(`"${name}"`), `content.js에 "${name}"이 있어야 한다`);
    });
  });
});

describe("저장소 key 일치 (content.js / popup.js / options.js)", () => {
  test('세 파일 모두 STORAGE_KEY로 "cloakliRules"를 사용한다', () => {
    ["content.js", "popup.js", "options.js"].forEach((file) => {
      const src = read(file);
      assert.match(src, /STORAGE_KEY\s*=\s*"cloakliRules"/, `${file}의 STORAGE_KEY가 일치해야 한다`);
    });
  });

  test('content.js와 popup.js, options.js 모두 PAUSED_STORAGE_KEY로 "cloakliPausedHostnames"를 사용한다', () => {
    ["content.js", "popup.js", "options.js"].forEach((file) => {
      const src = read(file);
      assert.match(
        src,
        /PAUSED_STORAGE_KEY\s*=\s*"cloakliPausedHostnames"/,
        `${file}의 PAUSED_STORAGE_KEY가 일치해야 한다`
      );
    });
  });
});

// License Pro의 단일 source of truth 배선을 잠근다: background(license-service)만 storage
// 레코드를 쓰고, popup/options는 GET_ENTITLEMENT 메시지로만 묻고, content/background는
// storage에서 prime + 통합 레코드 변경을 구독한다. 이 배선이 무너지면 화면마다 서로 다른
// Pro 상태가 표시되는 회귀(출시 전 안정화에서 고침)가 재발한다.
describe("License entitlement 배선 (단일 source of truth)", () => {
  test("popup.js와 options.js는 GET_ENTITLEMENT 메시지로만 Pro 상태를 얻고, license-client를 직접 호출하지 않는다", () => {
    ["popup.js", "options.js"].forEach((file) => {
      const src = read(file);
      assert.match(src, /GET_ENTITLEMENT/, `${file}은 background에 GET_ENTITLEMENT를 보내야 한다`);
      assert.ok(!/CloakliLicenseClient\./.test(src), `${file}이 license-client를 직접 호출하면 안 된다`);
      assert.ok(!/getEntitlementState\s*\(/.test(src), `${file}이 로컬 캐시로 Pro를 판정하면 안 된다`);
    });
  });

  test("popup.js는 활성화/재확인/비활성화를 background 메시지로만 수행한다", () => {
    const src = read("popup.js");
    ["ACTIVATE_LICENSE", "RECHECK_LICENSE", "DEACTIVATE_LICENSE"].forEach((type) => {
      assert.match(src, new RegExp(type), `popup.js는 ${type} 메시지를 사용해야 한다`);
    });
  });

  test("content.js와 background.js는 시작 시 prime하고, 통합 레코드(ENTITLEMENT_STORAGE_KEY) 변경을 구독한다", () => {
    ["content.js", "background.js"].forEach((file) => {
      const src = read(file);
      assert.match(src, /primeLicenseEntitlementCache\s*\(\)/, `${file}은 시작 시 라이선스 캐시를 prime해야 한다`);
      assert.match(src, /ENTITLEMENT_STORAGE_KEY/, `${file}은 storage.onChanged에서 통합 레코드 변경을 처리해야 한다`);
      assert.match(src, /setLicenseEntitlement/, `${file}은 변경된 레코드를 setLicenseEntitlement로 반영해야 한다`);
    });
  });

  test("content.js는 Pro 범위 기능 직전에 background(GET_ENTITLEMENT)에 묻는다", () => {
    const src = read("content.js");
    assert.match(src, /GET_ENTITLEMENT/, "content.js는 저장/범위 표시 직전에 background에 물어야 한다");
  });

  test("options.js가 참조하는 통합 레코드 키 문자열이 license-client.js의 상수와 일치한다", () => {
    const clientSrc = read("license-client.js");
    const optionsSrc = read("options.js");
    const m = /ENTITLEMENT_STORAGE_KEY\s*=\s*"([^"]+)"/.exec(clientSrc);
    assert.ok(m, "license-client.js에 ENTITLEMENT_STORAGE_KEY 정의가 있어야 한다");
    assert.ok(optionsSrc.includes('"' + m[1] + '"'), "options.js의 키 문자열이 license-client.js와 같아야 한다");
  });

  test("어느 컨텍스트도 entitlement.js 밖에서 스스로 Pro 여부를 판단하지 않는다 (plan/tier 문자열 하드코딩 금지)", () => {
    ["popup.js", "options.js", "content.js", "background.js"].forEach((file) => {
      const src = read(file);
      assert.ok(!/plan\s*===?\s*["']pro["']/.test(src), `${file}이 plan 문자열을 직접 비교하면 안 된다`);
      assert.ok(!/isPro\s*[:=]\s*true/.test(src), `${file}이 isPro를 직접 만들어내면 안 된다`);
    });
    // 예외: popup.js는 background 응답(공개 형식)의 tier를 "표시 분기"에만 사용한다.
    // 저장/기능 제한 판단에 쓰는 canCreateRule은 content.js에서 background 응답을 그대로
    // entitlement.js로 넘긴다(위 테스트에서 확인).
  });
});

describe("키보드 단축키(commands)와 background.js 처리 일치", () => {
  test("manifest의 명령 이름과 background.js가 처리하는 이름이 정확히 같다", () => {
    const manifest = JSON.parse(read("manifest.json"));
    const backgroundSrc = read("background.js");
    Object.keys(manifest.commands).forEach((name) => {
      assert.ok(backgroundSrc.includes(`"${name}"`), `background.js가 "${name}" 명령을 처리해야 한다`);
    });
  });

  test("background.js가 popup.js와 동일한 메시지 이름(START_SELECTION_MODE/CLEAR_ALL_MASKS)을 보낸다", () => {
    const backgroundSrc = read("background.js");
    ["START_SELECTION_MODE", "CLEAR_ALL_MASKS"].forEach((name) => {
      assert.ok(backgroundSrc.includes(`"${name}"`), `background.js에 "${name}"이 있어야 한다`);
    });
  });

  test("background.js가 tab-actions.js를 importScripts로 불러온다", () => {
    const backgroundSrc = read("background.js");
    const importScriptsMatch = /importScripts\(([^)]*)\)/.exec(backgroundSrc);
    assert.ok(importScriptsMatch, "background.js에 importScripts(...) 호출이 있어야 한다");
    assert.ok(importScriptsMatch[1].includes('"tab-actions.js"'), "importScripts가 tab-actions.js를 포함해야 한다");
  });

  test("background.js가 라이선스 재검증에 필요한 파일(build-config/entitlement/license-client)도 함께 불러온다", () => {
    const backgroundSrc = read("background.js");
    const importScriptsMatch = /importScripts\(([^)]*)\)/.exec(backgroundSrc);
    assert.ok(importScriptsMatch);
    ["content-core.js", "build-config.js", "entitlement.js", "license-client.js"].forEach((file) => {
      assert.ok(importScriptsMatch[1].includes(`"${file}"`), `importScripts가 ${file}을 포함해야 한다`);
    });
  });

  test("popup.html이 popup.js보다 먼저 tab-actions.js를 불러온다 (같은 로직 재사용)", () => {
    const html = read("popup.html");
    const tabActionsIdx = html.indexOf('src="tab-actions.js"');
    const popupJsIdx = html.indexOf('src="popup.js"');
    assert.ok(tabActionsIdx !== -1 && popupJsIdx !== -1 && tabActionsIdx < popupJsIdx);
  });

  test("popup.js와 background.js 둘 다 dispatchCloakliMessage를 호출한다 (중복 로직 없음)", () => {
    const popupSrc = read("popup.js");
    const backgroundSrc = read("background.js");
    assert.ok(popupSrc.includes("dispatchCloakliMessage"));
    assert.ok(backgroundSrc.includes("dispatchCloakliMessage"));
  });
});

describe("popup/options HTML 기본 구조", () => {
  test("popup.html에 온보딩/상태 패널/주요 버튼 요소가 모두 있다", () => {
    const html = read("popup.html");
    [
      "cloakli-onboarding",
      "cloakli-onboarding-start-btn",
      "cloakli-status-hostname",
      "cloakli-status-count",
      "cloakli-status-state",
      "cloakli-select-btn",
      "cloakli-pause-btn",
      "cloakli-clear-btn",
      "cloakli-manage-btn",
      "cloakli-help-btn",
    ].forEach((id) => {
      assert.ok(html.includes(`id="${id}"`), `popup.html에 id="${id}"가 있어야 한다`);
    });
  });

  test("popup.html에 요금제 배지와 Pro 안내 요소가 있다", () => {
    const html = read("popup.html");
    ["cloakli-plan-badge", "cloakli-pro-info-btn", "cloakli-pro-info", "cloakli-pro-info-close-btn"].forEach((id) => {
      assert.ok(html.includes(`id="${id}"`), `popup.html에 id="${id}"가 있어야 한다`);
    });
  });

  test("options.html에 검색 입력창과 요약 표시 요소가 있다", () => {
    const html = read("options.html");
    assert.ok(html.includes('id="cloakli-options-search"'));
    assert.ok(html.includes('id="cloakli-options-summary"'));
  });

  test("options.html에 요금제 요약과 Pro 안내 요소가 있다", () => {
    const html = read("options.html");
    [
      "cloakli-options-plan",
      "cloakli-options-pro-info-btn",
      "cloakli-options-pro-info",
      "cloakli-options-pro-info-close-btn",
    ].forEach((id) => {
      assert.ok(html.includes(`id="${id}"`), `options.html에 id="${id}"가 있어야 한다`);
    });
  });
});

describe("외부 네트워크/스크립트 미사용", () => {
  const productFiles = [
    "background.js",
    "content.js",
    "content-core.js",
    "popup.js",
    "options.js",
    "tab-actions.js",
    "entitlement.js",
    "build-config.js",
  ];

  productFiles.forEach((file) => {
    test(`${file}에 fetch/XMLHttpRequest 호출이 없다`, () => {
      const src = read(file);
      assert.ok(!/\bfetch\s*\(/.test(src), "fetch(...) 호출이 없어야 한다");
      assert.ok(!/new\s+XMLHttpRequest/.test(src), "XMLHttpRequest 사용이 없어야 한다");
    });

    test(`${file}에 eval / new Function을 사용하지 않는다`, () => {
      const src = read(file);
      assert.ok(!/\beval\s*\(/.test(src), "eval(...) 사용이 없어야 한다");
      assert.ok(!/new\s+Function\s*\(/.test(src), "new Function(...) 사용이 없어야 한다");
    });
  });

  ["popup.html", "options.html"].forEach((file) => {
    test(`${file}이 외부 CDN이나 원격 스크립트를 불러오지 않는다`, () => {
      const src = read(file);
      const scriptSrcs = [...src.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)].map((m) => m[1]);
      const linkHrefs = [...src.matchAll(/<link[^>]*\shref=["']([^"']+)["']/g)].map((m) => m[1]);
      [...scriptSrcs, ...linkHrefs].forEach((url) => {
        assert.ok(!/^https?:\/\//.test(url), `${file}이 외부 URL(${url})을 참조하면 안 된다`);
      });
    });
  });
});

describe("개발자 디버그 로그는 기본적으로 꺼져 있다", () => {
  test("content.js의 CLOAKLI_DEBUG는 build-config.js(CloakliBuildConfig.debug)에서만 값을 가져온다", () => {
    const src = read("content.js");
    assert.match(src, /const CLOAKLI_DEBUG = typeof CloakliBuildConfig[^;]*CloakliBuildConfig\.debug === true;/);
    assert.ok(!/const CLOAKLI_DEBUG = true;/.test(src), "CLOAKLI_DEBUG를 하드코딩된 true로 두면 안 된다");
  });

  test("build-config.js의 기본 debug 값은 false다", () => {
    const config = require("../build-config.js");
    assert.equal(config.debug, false);
  });
});

describe("요금제/권한 판정(entitlement.js) 연결 상태", () => {
  test("manifest.json의 content_scripts는 content-core.js -> build-config.js -> entitlement.js -> content.js 순서로 로드한다", () => {
    const manifest = JSON.parse(read("manifest.json"));
    const entry = manifest.content_scripts[0];
    const coreIdx = entry.js.indexOf("content-core.js");
    const buildConfigIdx = entry.js.indexOf("build-config.js");
    const entitlementIdx = entry.js.indexOf("entitlement.js");
    const contentIdx = entry.js.indexOf("content.js");
    assert.ok(
      coreIdx !== -1 &&
        buildConfigIdx !== -1 &&
        entitlementIdx !== -1 &&
        contentIdx !== -1 &&
        coreIdx < buildConfigIdx &&
        buildConfigIdx < entitlementIdx &&
        entitlementIdx < contentIdx,
      "content-core.js -> build-config.js -> entitlement.js -> content.js 순서여야 한다"
    );
  });

  test("popup.html은 popup.js보다 먼저 content-core.js/build-config.js/entitlement.js를 불러온다", () => {
    const html = read("popup.html");
    const coreIdx = html.indexOf('src="content-core.js"');
    const buildConfigIdx = html.indexOf('src="build-config.js"');
    const entitlementIdx = html.indexOf('src="entitlement.js"');
    const popupJsIdx = html.indexOf('src="popup.js"');
    assert.ok(
      coreIdx !== -1 &&
        buildConfigIdx !== -1 &&
        entitlementIdx !== -1 &&
        popupJsIdx !== -1 &&
        coreIdx < popupJsIdx &&
        buildConfigIdx < popupJsIdx &&
        entitlementIdx < popupJsIdx
    );
  });

  test("options.html은 options.js보다 먼저 content-core.js/build-config.js/entitlement.js를 불러온다", () => {
    const html = read("options.html");
    const coreIdx = html.indexOf('src="content-core.js"');
    const buildConfigIdx = html.indexOf('src="build-config.js"');
    const entitlementIdx = html.indexOf('src="entitlement.js"');
    const optionsJsIdx = html.indexOf('src="options.js"');
    assert.ok(
      coreIdx !== -1 &&
        buildConfigIdx !== -1 &&
        entitlementIdx !== -1 &&
        optionsJsIdx !== -1 &&
        coreIdx < optionsJsIdx &&
        buildConfigIdx < optionsJsIdx &&
        entitlementIdx < optionsJsIdx
    );
  });

  test("content.js, popup.js, options.js가 모두 CloakliEntitlement를 사용한다 (권한 판정을 각자 따로 구현하지 않음)", () => {
    ["content.js", "popup.js", "options.js"].forEach((file) => {
      const src = read(file);
      assert.ok(src.includes("CloakliEntitlement"), `${file}이 CloakliEntitlement를 사용해야 한다`);
    });
  });

  test("entitlement.js는 Developer Pro 여부를 build-config.js(CloakliBuildConfig.developerPro) 하나에서만 가져온다", () => {
    const src = read("entitlement.js");
    assert.ok(src.includes("CloakliBuildConfig"), "entitlement.js가 CloakliBuildConfig를 사용해야 한다");
    assert.ok(!/const CLOAKLI_DEVELOPER_MODE\s*=/.test(src), "entitlement.js 안에 별도의 developer 상수를 두면 안 된다");
  });

  test("!!! 출시 전 확인 !!!: build-config.js의 기본 developerPro 값은 false다", () => {
    const config = require("../build-config.js");
    assert.equal(
      config.developerPro,
      false,
      "출시 전 반드시 false여야 한다. true인 채로 배포하면 모든 사용자가 결제 없이 Pro로 동작한다."
    );
  });

  test("무료 한도 숫자(maxHostnames/maxRules)는 entitlement.js 한 곳에만 정의되어 있다", () => {
    const otherFiles = ["content.js", "popup.js", "options.js", "content-core.js", "tab-actions.js", "background.js"];
    otherFiles.forEach((file) => {
      const src = read(file);
      assert.ok(!/maxHostnames\s*:/.test(src), `${file}에 maxHostnames를 중복 정의하면 안 된다`);
      assert.ok(!/maxRules\s*:/.test(src), `${file}에 maxRules를 중복 정의하면 안 된다`);
    });
  });

  test("Pro 여부를 storage 값만으로 직접 저장/판단하는 코드가 없다 (storage 우회 방지)", () => {
    ["content.js", "popup.js", "options.js"].forEach((file) => {
      const src = read(file);
      assert.ok(!/isPro\s*:\s*true/.test(src), `${file}에서 isPro를 직접 true로 설정하면 안 된다`);
      assert.ok(
        !/chrome\.storage\.local\.set\(\s*\{\s*isPro/.test(src),
        `${file}이 storage에 isPro를 직접 쓰면 안 된다`
      );
    });
  });
});

// 8단계(빌드 분리)까지는 결제 연동 자체가 없어 "결제 관련 단어가 아예 없어야 한다"가
// 기준이었지만, 이번 단계부터는 Lemon Squeezy + Cloudflare Worker 라이선스 검증이
// 실제 기능이다. 그래서 "Lemon Squeezy를 언급하면 안 된다"가 아니라, "확장 프로그램이
// 비밀값을 갖거나 Lemon Squeezy API를 직접 호출하면 안 된다"(반드시 우리 라이선스
// 서버를 거쳐야 한다)로 기준을 바꿨다.
describe("Lemon Squeezy 연동이 확장 프로그램에 안전하게 분리되어 있다", () => {
  // 사용하지 않는 결제 대행사는 여전히 등장하면 안 된다(Lemon Squeezy만 사용).
  const unusedProcessorKeywords = ["stripe", "paypal", "paddle", "gumroad", "checkout.session"];
  // 서버(server/.dev.vars.example 등) 전용 비밀값 이름은 확장 프로그램 어디에도 없어야 한다.
  const serverOnlySecretNames = ["lemonsqueezy_webhook_secret", "lemonsqueezy_store_id", "cloakli_admin_secret"];

  const extensionFiles = [
    "content.js",
    "popup.js",
    "options.js",
    "background.js",
    "tab-actions.js",
    "entitlement.js",
    "build-config.js",
    "license-client.js",
  ];

  extensionFiles.forEach((file) => {
    test(`${file}에 사용하지 않는 결제 대행사 코드가 없다`, () => {
      const src = read(file).toLowerCase();
      unusedProcessorKeywords.forEach((keyword) => {
        assert.ok(!src.includes(keyword), `${file}에 "${keyword}" 관련 코드가 있으면 안 된다`);
      });
    });

    test(`${file}에 서버 전용 비밀값 이름이 없다`, () => {
      const src = read(file).toLowerCase();
      serverOnlySecretNames.forEach((keyword) => {
        assert.ok(!src.includes(keyword), `${file}에 "${keyword}"가 있으면 안 된다(서버 전용 비밀)`);
      });
    });

    test(`${file}이 Lemon Squeezy API를 직접 호출하지 않는다 (반드시 라이선스 서버를 거쳐야 한다)`, () => {
      const src = read(file);
      assert.ok(!/api\.lemonsqueezy\.com/i.test(src), `${file}이 api.lemonsqueezy.com을 직접 호출하면 안 된다`);
    });
  });

  ["popup.html", "options.html"].forEach((file) => {
    test(`${file}에 가격/할인 표시나 가짜 결제 완료 문구가 없다`, () => {
      const html = read(file);
      // 원화/달러 기호 뒤에 숫자가 오는 형태(가격 표기)가 없는지 확인한다.
      assert.ok(!/[₩$]\s*\d/.test(html), `${file}에 가격으로 보이는 표시가 있으면 안 된다`);
      assert.ok(!/할인|지금\s*구매|결제가?\s*완료되었습니다/.test(html), `${file}에 결제 유도/가짜 완료 문구가 있으면 안 된다`);
    });
  });
});

// 10단계(YouTube 썸네일 가림 버그 수정): 저장된 가림은 hover 등 조건부 상태에 의존하지
// 않고 항상 보여야 하고, 클릭은 절대 가로채면 안 된다. 이 두 성질을 content.css 텍스트를
// 직접 읽어 정적으로 고정해 둔다(실제 브라우저 렌더링 없이도 회귀를 잡을 수 있도록).
describe("가림 레이어는 hover에 의존하지 않고 클릭을 막지 않는다", () => {
  test("content.css에 마스크/오버레이 관련 :hover 셀렉터가 없다", () => {
    // 주석을 먼저 제거해, 설명 문구 안의 ":hover" 같은 단어가 오탐을 일으키지 않게 한다.
    const css = read("content.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const ruleBlocks = css.match(/[^{}]+\{[^{}]*\}/g) || [];
    assert.ok(ruleBlocks.length > 0, "CSS 규칙을 하나도 찾지 못했다");
    ruleBlocks.forEach((block) => {
      const selector = block.slice(0, block.indexOf("{"));
      if (/cloakli-mask/i.test(selector)) {
        assert.ok(!/:hover/i.test(selector), `가림 관련 selector에 :hover가 있으면 안 된다: ${selector.trim()}`);
      }
    });
  });

  test("가려진 컨테이너(.cloakli-masked/.cloakli-mask-wrapper)는 visibility:hidden에 의존하지 않는다", () => {
    const css = read("content.css");
    const containerRuleMatch = css.match(/\.cloakli-mask-wrapper,\s*\n\.cloakli-masked\s*\{[^}]*\}/);
    assert.ok(containerRuleMatch, ".cloakli-mask-wrapper/.cloakli-masked 규칙을 찾지 못했다");
    assert.ok(
      !/visibility\s*:\s*hidden/i.test(containerRuleMatch[0]),
      "원본 요소를 visibility:hidden으로 숨기면 클릭도 함께 막히므로 사용하면 안 된다"
    );
  });

  // 오버레이는 pointer-events:none이 아니라 auto다 - none이면 hover를 포함한 모든 마우스
  // 이벤트가 원본 요소로 그대로 전달되어, 그 사이트 자신의 hover 동작이 오버레이 너머로
  // 드러날 수 있다(이번 단계에서 실제로 확인된 원인). 대신 오버레이가 모든 마우스 이벤트를
  // 흡수하고, content.js가 클릭만 명시적으로 실제 링크에 전달한다(forwardOverlayClick).
  test(".cloakli-mask-overlay는 opacity:1/visibility:visible이며 pointer-events:auto로 모든 마우스 이벤트를 흡수한다", () => {
    const css = read("content.css");
    const overlayRuleMatch = css.match(/\.cloakli-mask-overlay\s*\{[^}]*\}/);
    assert.ok(overlayRuleMatch, ".cloakli-mask-overlay 규칙을 찾지 못했다");
    const rule = overlayRuleMatch[0];
    assert.match(rule, /opacity\s*:\s*1/i, "오버레이는 항상 opacity:1이어야 한다");
    assert.match(rule, /visibility\s*:\s*visible/i, "오버레이는 항상 visibility:visible이어야 한다");
    assert.match(rule, /pointer-events\s*:\s*auto/i, "오버레이는 pointer-events:auto여야 hover가 원본으로 새지 않는다");
    assert.ok(!/pointer-events\s*:\s*none/i.test(rule), "pointer-events:none이면 hover가 원본 요소로 전달되어 새는 원인이 된다");
  });

  test("content.js가 오버레이 클릭을 실제 링크로 전달하는 코드를 갖고 있다", () => {
    const src = read("content.js");
    assert.match(src, /function\s+findNavigableLink/, "실제 링크를 찾는 findNavigableLink가 있어야 한다");
    assert.match(src, /overlay\.addEventListener\(\s*["']click["']/, "오버레이에 click 전달 리스너가 있어야 한다");
    assert.match(src, /overlay\.addEventListener\(\s*["']auxclick["']/, "오버레이에 auxclick(중간 클릭) 전달 리스너가 있어야 한다");
  });

  test("mouseover/mousemove 리스너는 선택 모드에서만 추가되고 종료 시 반드시 제거된다", () => {
    const src = read("content.js");
    // mousemove는 화면 고정 선택 모드의 좌표 추적에만 쓰인다: 추가/제거가 정확히 1쌍이어야
    // 하며(startSelectionMode/endSelectionMode), 그 외의 mousemove 기반 재적용 로직이 없어야 한다.
    const mousemoveAdds = (src.match(/addEventListener\(\s*["']mousemove["']/g) || []).length;
    const mousemoveRemoves = (src.match(/removeEventListener\(\s*["']mousemove["']/g) || []).length;
    assert.equal(mousemoveAdds, 1, "mousemove 리스너는 선택 모드용 하나만 있어야 한다");
    assert.equal(mousemoveRemoves, 1, "선택 모드 종료 시 mousemove 리스너를 제거해야 한다");
    const mouseoverAdds = (src.match(/addEventListener\(\s*["']mouseover["']/g) || []).length;
    const mouseoverRemoves = (src.match(/removeEventListener\(\s*["']mouseover["']/g) || []).length;
    assert.equal(mouseoverAdds, 1, "mouseover 리스너는 선택 모드용 하나만 있어야 한다");
    assert.equal(mouseoverRemoves, 1, "선택 모드 종료 시 mouseover 리스너를 제거해야 한다");
  });

  // element 범위는 항상 "정확히 한 요소"만 가린다. selector가 유일하면 그 하나를 쓰고,
  // 아니면 resolveElementTarget(fingerprint 재탐색)이 하나를 결정하며, 그마저 실패하면
  // 아무 것도 가리지 않는다. 여러 요소를 한꺼번에 가리는 경로가 없어야 한다.
  test("content-core.js의 applyRuleSet은 element 범위에서 요소를 하나만 가린다", () => {
    const src = read("content-core.js");
    const fnMatch = src.match(/function\s+applyRuleSet\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(fnMatch, "applyRuleSet 함수를 찾지 못했다");
    const body = fnMatch[0];
    assert.match(body, /scope\s*===\s*"element"/, "element 범위를 별도로 처리해야 한다");
    assert.match(body, /elements\.length\s*===\s*1/, "selector가 유일할 때만 그 하나를 기본값으로 써야 한다");
    assert.match(body, /resolveElementTarget/, "fingerprint 재탐색 어댑터를 지원해야 한다");
    // element 분기는 반복문 없이 단일 대상만 처리하고 곧바로 return해야 한다.
    const elementBranch = body.slice(body.indexOf('scope === "element"'), body.indexOf("// page/site"));
    assert.ok(!/for\s*\(/.test(elementBranch), "element 분기에서 여러 요소를 순회하면 안 된다");
  });

  // 선택 미리보기(hover outline/범위 미리보기)와 저장된 가림(persistent mask) 정리 함수가
  // 이름부터 분리되어 있는지, 그리고 선택 미리보기 정리 함수 안에 저장된 가림 관련 class
  // 이름(MASKED_CLASS/OVERLAY_CLASS)이 등장하지 않는지 정적으로 확인한다.
  test("clearSelectionPreview()/removePersistentMask()가 이름과 역할로 분리되어 있다", () => {
    const src = read("content.js");
    assert.match(src, /function\s+clearSelectionPreview\s*\(/, "선택 미리보기 정리 함수(clearSelectionPreview)가 있어야 한다");
    assert.match(src, /function\s+removePersistentMask\s*\(/, "저장된 가림 제거 함수(removePersistentMask)가 있어야 한다");
    assert.match(src, /function\s+removeAllPersistentMasks\s*\(/, "저장된 가림 일괄 제거 함수(removeAllPersistentMasks)가 있어야 한다");

    const fnMatch = src.match(/function\s+clearSelectionPreview\s*\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
    assert.ok(fnMatch, "clearSelectionPreview 함수 본문을 찾지 못했다");
    const body = fnMatch[1];
    assert.ok(!/MASKED_CLASS|OVERLAY_CLASS|removePersistentMask|removeAllPersistentMasks/.test(body), "clearSelectionPreview()는 저장된 가림을 절대 건드리면 안 된다");
  });

  test("mouseenter/mouseleave/mouseout 이벤트에 저장된 가림 제거 코드가 연결되어 있지 않다", () => {
    const src = read("content.js");
    ["mouseenter", "mouseleave", "mouseout", "pointerenter", "pointerleave"].forEach((eventName) => {
      const re = new RegExp("addEventListener\\(\\s*[\"']" + eventName + "[\"']");
      assert.ok(!re.test(src), `${eventName} 리스너가 있으면 안 된다(저장된 가림은 hover 이벤트와 무관해야 한다)`);
    });
  });

  test("selector 생성 코드에 역할(role)/종류(family) 분류 로직이 존재하고 일반화 검증에 사용된다", () => {
    const src = read("content.js");
    assert.match(src, /function\s+classifySelectableRole\s*\(/, "classifySelectableRole이 있어야 한다");
    assert.match(src, /function\s+classifyContentFamily\s*\(/, "classifyContentFamily가 있어야 한다");
    assert.match(src, /function\s+findRepeatedRoot\s*\(/, "findRepeatedRoot가 있어야 한다");
    assert.match(src, /function\s+resolveVisualMaskTarget\s*\(/, "resolveVisualMaskTarget가 있어야 한다");
    assert.match(src, /mixed-role/, "일반화 결과에 다른 role이 섞이면 차단하는 검사가 있어야 한다");
    assert.match(src, /isUniqueSelector/, "element selector 유일성 검사가 있어야 한다");
  });

  test("tests/youtube-thumbnail.test.js에 롱폼/Shorts fixture 테스트가 존재한다", () => {
    assert.ok(exists("tests/youtube-thumbnail.test.js"), "YouTube 유사 fixture 테스트 파일이 있어야 한다");
    const src = read("tests/youtube-thumbnail.test.js");
    assert.match(src, /shorts/i, "Shorts 관련 fixture/테스트가 있어야 한다");
    assert.match(src, /longCards|longform-card/i, "롱폼 관련 fixture/테스트가 있어야 한다");
  });

  test("HIDDEN 텍스트는 persistent mask 생성 함수(maskElement)에서만 만들어진다", () => {
    const src = read("content.js");
    const occurrences = src.match(/"HIDDEN"/g) || [];
    assert.equal(occurrences.length, 1, "HIDDEN 문자열은 정확히 한 곳에만 있어야 한다");
    const maskFnMatch = src.match(/function\s+maskElement\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(maskFnMatch, "maskElement 함수를 찾지 못했다");
    assert.ok(maskFnMatch[0].includes('"HIDDEN"'), "HIDDEN 텍스트는 maskElement 안에서만 만들어져야 한다");
    // 선택 미리보기 쪽 함수들에는 HIDDEN이 없어야 한다.
    const previewFnMatch = src.match(/function\s+clearSelectionPreview\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(previewFnMatch && !previewFnMatch[0].includes("HIDDEN"));
  });

  test("선택 스냅샷은 텍스트 내용(textContent/innerHTML/innerText)을 기록하지 않는다", () => {
    const src = read("content.js");
    const fnMatch = src.match(/function\s+captureSelectableSnapshot\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(fnMatch, "captureSelectableSnapshot 함수가 있어야 한다");
    assert.ok(!/textContent|innerHTML|innerText/.test(fnMatch[0]), "스냅샷에 텍스트 내용을 기록하면 안 된다");
  });

  test("화면 고정 선택 모드의 중앙 cleanup(exitFrozenSelectionMode)이 있고 endSelectionMode가 finally로 호출한다", () => {
    const src = read("content.js");
    assert.match(src, /function\s+exitFrozenSelectionMode\s*\(/, "exitFrozenSelectionMode가 있어야 한다");
    assert.match(src, /finally\s*\{[\s\S]{0,120}?exitFrozenSelectionMode\(\)/, "endSelectionMode가 finally에서 cleanup을 호출해야 한다");
  });

  test("'이 요소만' 버튼 활성화는 element selector만으로 판단한다 (일반화 실패와 독립)", () => {
    const src = read("content.js");
    assert.match(src, /enabled:\s*!!state\.specificSelector/, "element 버튼은 specificSelector만으로 활성화를 판단해야 한다");
  });

  // 깊게 중첩된 최신 웹사이트(YouTube/Instagram)에서 element 범위 selector가 만들어지지 않아
  // "이 요소만"이 비활성화되던 문제의 재발 방지: 위치 기반 fallback과 fingerprint 재적용이
  // 실제로 코드에 존재하고 연결되어 있는지 정적으로 고정한다.
  test("element selector 생성에 위치 기반 fallback(buildPositionalSelector)이 연결되어 있다", () => {
    const src = read("content.js");
    assert.match(src, /function\s+buildPositionalSelector\s*\(/, "buildPositionalSelector가 있어야 한다");
    const fnMatch = src.match(/function\s+buildElementScopeSelector\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(fnMatch, "buildElementScopeSelector 함수를 찾지 못했다");
    assert.match(fnMatch[0], /buildPositionalSelector\(/, "element selector 생성이 위치 기반 fallback을 써야 한다");
  });

  test("위치 기반 selector에는 일반 selector보다 넉넉한 길이 상한이 적용된다", () => {
    const src = read("content.js");
    assert.match(src, /POSITIONAL_SELECTOR_MAX_LENGTH/, "위치 기반 selector 전용 길이 상한이 있어야 한다");
    const fnMatch = src.match(/function\s+buildPositionalSelector\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(fnMatch && /POSITIONAL_SELECTOR_MAX_LENGTH/.test(fnMatch[0]), "위치 경로 유일성 검사에 넉넉한 상한을 써야 한다");
  });

  test("element 규칙 재적용에 fingerprint 기반 재탐색이 연결되어 있다", () => {
    const contentSrc = read("content.js");
    const coreSrc = read("content-core.js");
    assert.match(contentSrc, /function\s+buildElementFingerprint\s*\(/, "buildElementFingerprint가 있어야 한다");
    assert.match(contentSrc, /function\s+findBestFingerprintMatch\s*\(/, "findBestFingerprintMatch가 있어야 한다");
    assert.match(contentSrc, /function\s+resolveElementScopeTarget\s*\(/, "resolveElementScopeTarget이 있어야 한다");
    assert.match(contentSrc, /resolveElementTarget:\s*resolveElementScopeTarget/, "재적용 어댑터로 연결되어야 한다");
    assert.match(coreSrc, /resolveElementTarget/, "applyRuleSet이 resolveElementTarget 어댑터를 지원해야 한다");
  });

  test("fingerprint는 텍스트 원문을 저장하지 않고 URL은 해시로만 저장한다", () => {
    const src = read("content.js");
    const fnMatch = src.match(/function\s+buildElementFingerprint\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(fnMatch, "buildElementFingerprint 함수를 찾지 못했다");
    const body = fnMatch[0];
    assert.ok(!/textContent|innerText|innerHTML/.test(body), "fingerprint에 텍스트 내용을 저장하면 안 된다");
    assert.match(body, /hashedUrlKey\(/, "href/src는 해시(hashedUrlKey)로만 저장해야 한다");
    // 원문 href/src를 그대로 담는 필드가 없어야 한다.
    assert.ok(!/\bhref:\s|\bsrc:\s/.test(body), "href/src 원문을 fingerprint에 담으면 안 된다");
  });
});
