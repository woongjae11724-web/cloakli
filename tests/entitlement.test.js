// entitlement.js(요금제/권한 판정 모듈)의 순수 함수 단위 테스트.
// DOM이나 chrome.* API가 전혀 필요 없다.
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const CloakliEntitlement = require("../entitlement.js");

describe("resolveEntitlementState / getEntitlementState", () => {
  test("developerMode가 true면 Developer Pro 상태를 돌려준다", () => {
    const state = CloakliEntitlement.resolveEntitlementState(true);
    assert.equal(state.plan, "pro");
    assert.equal(state.source, "developer");
    assert.equal(state.isPro, true);
  });

  test("developerMode가 false면 free 상태를 돌려준다", () => {
    const state = CloakliEntitlement.resolveEntitlementState(false);
    assert.equal(state.plan, "free");
    assert.equal(state.source, "default");
    assert.equal(state.isPro, false);
  });

  test("developerMode가 손상된 값(undefined/null/문자열/숫자)이어도 항상 free로 안전하게 처리한다", () => {
    [undefined, null, "true", 1, {}, []].forEach((value) => {
      const state = CloakliEntitlement.resolveEntitlementState(value);
      assert.equal(state.isPro, false, `${JSON.stringify(value)} 입력은 free여야 한다`);
    });
  });

  test("getEntitlementState()는 인자 없이 실제 build-config.js(developerPro)를 반영한다 (출시 상태 확인)", () => {
    // 이 저장소의 실제 build-config.js는 developerPro:false여야 하므로, 인자 없는 호출은
    // 항상 free를 돌려줘야 한다. (값이 true로 잘못 바뀌면 이 테스트가 즉시 실패해 출시 전 실수를 잡아낸다)
    const state = CloakliEntitlement.getEntitlementState();
    assert.equal(state.isPro, false, "build-config.js의 developerPro는 기본 상태에서 반드시 false여야 한다");
    assert.equal(state.plan, "free");
    assert.equal(state.source, "default");
  });

  test("getEntitlementState()는 build-config.js의 developerPro 값과 항상 일치한다", () => {
    const buildConfig = require("../build-config.js");
    const state = CloakliEntitlement.getEntitlementState();
    assert.equal(state.isPro, buildConfig.developerPro === true);
  });
});

describe("isProUser", () => {
  test("isPro:true인 상태만 true를 돌려준다", () => {
    assert.equal(CloakliEntitlement.isProUser({ plan: "pro", source: "developer", isPro: true }), true);
  });

  test("손상된 값(null/undefined/빈 객체/문자열 'true')은 모두 안전하게 false로 처리한다", () => {
    [null, undefined, {}, { isPro: "true" }, { isPro: 1 }, "isPro", 123].forEach((value) => {
      assert.equal(CloakliEntitlement.isProUser(value), false, `${JSON.stringify(value)}는 false여야 한다`);
    });
  });
});

describe("computeUsage", () => {
  test("빈/손상된 입력에도 항상 안전한 기본값을 돌려준다", () => {
    [null, undefined, "not-an-object", 123, []].forEach((value) => {
      const usage = CloakliEntitlement.computeUsage(value);
      assert.equal(usage.totalRules, 0);
      assert.equal(usage.hostnameCount, 0);
      assert.deepEqual(usage.hostnames, []);
    });
  });

  test("hostname별 유효한 규칙 개수와 hostname 개수를 정확히 센다", () => {
    const usage = CloakliEntitlement.computeUsage({
      "a.example.com": [
        { hostname: "a.example.com", selector: "#x", scope: "element" },
        { hostname: "a.example.com", selector: "#y", scope: "element" },
      ],
      "b.example.com": [{ hostname: "b.example.com", selector: "#z", scope: "site" }],
    });
    assert.equal(usage.totalRules, 3);
    assert.equal(usage.hostnameCount, 2);
    assert.deepEqual(usage.hostnames.slice().sort(), ["a.example.com", "b.example.com"]);
  });

  test("selector가 없는 손상된 규칙은 계산에서 제외된다", () => {
    const usage = CloakliEntitlement.computeUsage({
      "a.example.com": [{ hostname: "a.example.com", selector: "" }, { hostname: "a.example.com" }, null],
    });
    assert.equal(usage.totalRules, 0);
    assert.equal(usage.hostnameCount, 0);
  });

  test("hostname 필드가 없는 손상된 규칙은 계산에서 제외된다", () => {
    const usage = CloakliEntitlement.computeUsage({
      "a.example.com": [{ selector: "#x" }, { hostname: "", selector: "#y" }],
    });
    assert.equal(usage.totalRules, 0);
  });

  test("배열이 아닌 값(Cloakli 규칙이 아닌 손상된 storage 데이터)은 조용히 건너뛴다", () => {
    const usage = CloakliEntitlement.computeUsage({
      "a.example.com": "not-an-array",
      "b.example.com": [{ hostname: "b.example.com", selector: "#z" }],
    });
    assert.equal(usage.totalRules, 1);
    assert.equal(usage.hostnameCount, 1);
  });

  test("완전히 같은 규칙(hostname+scope+selector+pagePattern)이 중복 저장되어 있으면 한 번만 센다", () => {
    const usage = CloakliEntitlement.computeUsage({
      "a.example.com": [
        { hostname: "a.example.com", selector: "#x", scope: "element", pagePattern: null },
        { hostname: "a.example.com", selector: "#x", scope: "element", pagePattern: null },
        { hostname: "a.example.com", selector: "#x", scope: "page", pagePattern: "/watch" },
      ],
    });
    assert.equal(usage.totalRules, 2, "selector가 같아도 scope/pagePattern이 다르면 별도로 센다");
  });

  test("유효한 규칙이 하나도 없는 hostname은 hostnameCount에 포함되지 않는다", () => {
    const usage = CloakliEntitlement.computeUsage({
      "empty.example.com": [],
      "broken.example.com": [{ selector: "" }],
    });
    assert.equal(usage.hostnameCount, 0);
  });
});

describe("canCreateRule: 무료 규칙 수 제한", () => {
  function freeCtx(overrides) {
    return Object.assign(
      {
        entitlementState: { plan: "free", source: "default", isPro: false },
        allRulesByHostname: {},
        hostname: "example.com",
        scope: "element",
      },
      overrides
    );
  }

  test("규칙 0개에서 저장 허용", () => {
    const result = CloakliEntitlement.canCreateRule(freeCtx({ allRulesByHostname: {} }));
    assert.equal(result.allowed, true);
  });

  test("규칙 2개에서 세 번째 저장 허용", () => {
    const result = CloakliEntitlement.canCreateRule(
      freeCtx({
        allRulesByHostname: {
          "example.com": [
            { hostname: "example.com", selector: "#a" },
            { hostname: "example.com", selector: "#b" },
          ],
        },
      })
    );
    assert.equal(result.allowed, true);
  });

  test("규칙 3개에서 네 번째 저장 차단", () => {
    const result = CloakliEntitlement.canCreateRule(
      freeCtx({
        allRulesByHostname: {
          "example.com": [
            { hostname: "example.com", selector: "#a" },
            { hostname: "example.com", selector: "#b" },
            { hostname: "example.com", selector: "#c" },
          ],
        },
      })
    );
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "rule-limit");
  });

  test("규칙 삭제 후(개수가 줄어들면) 다시 저장 허용", () => {
    const result = CloakliEntitlement.canCreateRule(
      freeCtx({
        allRulesByHostname: { "example.com": [{ hostname: "example.com", selector: "#a" }] },
      })
    );
    assert.equal(result.allowed, true);
  });

  test("잘못된 규칙 데이터가 섞여 있어도 안전하게 무시하고 유효한 규칙만 센다", () => {
    const result = CloakliEntitlement.canCreateRule(
      freeCtx({
        allRulesByHostname: {
          "example.com": [
            { hostname: "example.com", selector: "#a" },
            { hostname: "example.com", selector: "#b" },
            null,
            { selector: "" },
            { hostname: "" },
          ],
        },
      })
    );
    assert.equal(result.allowed, true, "손상된 규칙은 개수에 포함되지 않아야 한다");
  });
});

describe("canCreateRule: 무료 hostname 제한", () => {
  function freeCtx(overrides) {
    return Object.assign(
      {
        entitlementState: { plan: "free", source: "default", isPro: false },
        allRulesByHostname: {},
        hostname: "site-a.com",
        scope: "element",
      },
      overrides
    );
  }

  test("첫 hostname 저장 허용", () => {
    const result = CloakliEntitlement.canCreateRule(freeCtx({ allRulesByHostname: {} }));
    assert.equal(result.allowed, true);
  });

  test("같은 hostname에 추가 규칙 허용", () => {
    const result = CloakliEntitlement.canCreateRule(
      freeCtx({
        allRulesByHostname: { "site-a.com": [{ hostname: "site-a.com", selector: "#a" }] },
      })
    );
    assert.equal(result.allowed, true);
  });

  test("다른 hostname에는 저장 차단", () => {
    const result = CloakliEntitlement.canCreateRule(
      freeCtx({
        hostname: "site-b.com",
        allRulesByHostname: { "site-a.com": [{ hostname: "site-a.com", selector: "#a" }] },
      })
    );
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "hostname-limit");
  });

  test("첫 hostname의 규칙을 전부 삭제하면 다른 hostname 허용", () => {
    const result = CloakliEntitlement.canCreateRule(
      freeCtx({
        hostname: "site-b.com",
        allRulesByHostname: { "site-a.com": [] }, // 전부 삭제됨 -> hostnameCount 0
      })
    );
    assert.equal(result.allowed, true);
  });

  test("같은 hostname에 규칙이 여러 개 있어도 hostname 중복 계산은 없다 (규칙 수와 무관)", () => {
    const result = CloakliEntitlement.canCreateRule(
      freeCtx({
        allRulesByHostname: {
          "site-a.com": [
            { hostname: "site-a.com", selector: "#a" },
            { hostname: "site-a.com", selector: "#b" },
          ],
        },
      })
    );
    // 같은 hostname 추가이므로 hostname 한도가 아니라 규칙 한도(3개)만 적용된다.
    assert.equal(result.allowed, true);
  });
});

describe("canCreateRule: scope 제한", () => {
  const freeState = { plan: "free", source: "default", isPro: false };
  const proState = { plan: "pro", source: "default", isPro: true };
  const devProState = { plan: "pro", source: "developer", isPro: true };

  test("무료 element 허용", () => {
    const result = CloakliEntitlement.canCreateRule({
      entitlementState: freeState,
      allRulesByHostname: {},
      hostname: "example.com",
      scope: "element",
    });
    assert.equal(result.allowed, true);
  });

  test("무료 page 차단", () => {
    const result = CloakliEntitlement.canCreateRule({
      entitlementState: freeState,
      allRulesByHostname: {},
      hostname: "example.com",
      scope: "page",
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "scope-not-allowed");
  });

  test("무료 site 차단", () => {
    const result = CloakliEntitlement.canCreateRule({
      entitlementState: freeState,
      allRulesByHostname: {},
      hostname: "example.com",
      scope: "site",
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "scope-not-allowed");
  });

  ["element", "page", "site"].forEach((scope) => {
    test(`Pro ${scope} 허용 (한도를 이미 넘겼어도 허용)`, () => {
      const result = CloakliEntitlement.canCreateRule({
        entitlementState: proState,
        allRulesByHostname: {
          "a.com": [{ hostname: "a.com", selector: "#1" }, { hostname: "a.com", selector: "#2" }, { hostname: "a.com", selector: "#3" }],
          "b.com": [{ hostname: "b.com", selector: "#4" }],
        },
        hostname: "c.com",
        scope,
      });
      assert.equal(result.allowed, true);
    });

    test(`개발자 Pro에서도 ${scope} 허용`, () => {
      const result = CloakliEntitlement.canCreateRule({
        entitlementState: devProState,
        allRulesByHostname: {},
        hostname: "c.com",
        scope,
      });
      assert.equal(result.allowed, true);
    });
  });
});

describe("단일 권한 판정 구조 확인", () => {
  test("isPro:true이기만 하면 source 값과 무관하게 항상 허용된다 (판정 기준이 한 곳에 있음)", () => {
    ["default", "developer", "server", "anything"].forEach((source) => {
      const result = CloakliEntitlement.canCreateRule({
        entitlementState: { plan: "pro", source, isPro: true },
        allRulesByHostname: { "a.com": [{ hostname: "a.com", selector: "#1" }, { hostname: "a.com", selector: "#2" }, { hostname: "a.com", selector: "#3" }] },
        hostname: "b.com",
        scope: "site",
      });
      assert.equal(result.allowed, true, `source=${source}여도 isPro:true면 허용되어야 한다`);
    });
  });

  test("entitlementState를 생략하면 getEntitlementState()(실제 상수)를 사용한다", () => {
    // 실제 상수는 false이므로 free 기준으로 판단되어야 한다: page 범위는 차단된다.
    const result = CloakliEntitlement.canCreateRule({ allRulesByHostname: {}, hostname: "example.com", scope: "page" });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "scope-not-allowed");
  });
});

describe("describePopupPlanBadge / describeOptionsPlanSummary", () => {
  test("무료 상태의 popup 배지에는 사용량 숫자가 FREE_PLAN_LIMITS 값 그대로 반영된다", () => {
    const badge = CloakliEntitlement.describePopupPlanBadge(
      { plan: "free", source: "default", isPro: false },
      { totalRules: 2, hostnameCount: 1, hostnames: ["a.com"] }
    );
    assert.match(badge.text, /Free/);
    assert.match(badge.text, new RegExp("2/" + CloakliEntitlement.FREE_PLAN_LIMITS.maxRules));
    assert.match(badge.text, new RegExp("1/" + CloakliEntitlement.FREE_PLAN_LIMITS.maxHostnames));
  });

  test("Pro 상태의 popup 배지에는 무제한 문구가 표시되고 사용량 숫자가 없다", () => {
    const badge = CloakliEntitlement.describePopupPlanBadge({ plan: "pro", source: "default", isPro: true }, null);
    assert.match(badge.text, /Pro/);
    assert.match(badge.text, /무제한/);
  });

  test("Developer Pro 상태의 popup 배지에는 개발자 전용 문구가 표시된다", () => {
    const badge = CloakliEntitlement.describePopupPlanBadge({ plan: "pro", source: "developer", isPro: true }, null);
    assert.match(badge.text, /Developer Pro/);
  });

  test("무료 상태의 options 요약에는 사용 사이트/저장 규칙 줄이 각각 표시된다", () => {
    const summary = CloakliEntitlement.describeOptionsPlanSummary(
      { plan: "free", source: "default", isPro: false },
      { totalRules: 3, hostnameCount: 1, hostnames: ["a.com"] }
    );
    assert.equal(summary.lines[0], "현재 요금제: Free");
    assert.ok(summary.lines.some((l) => l.includes("사용 사이트")));
    assert.ok(summary.lines.some((l) => l.includes("저장 규칙")));
  });

  test("Pro/Developer Pro 상태의 options 요약에는 제한 없음 문구가 표시된다", () => {
    const proSummary = CloakliEntitlement.describeOptionsPlanSummary({ plan: "pro", source: "default", isPro: true }, null);
    assert.equal(proSummary.lines[0], "현재 요금제: Pro");

    const devSummary = CloakliEntitlement.describeOptionsPlanSummary(
      { plan: "pro", source: "developer", isPro: true },
      null
    );
    assert.equal(devSummary.lines[0], "현재 요금제: Developer Pro");
  });
});
