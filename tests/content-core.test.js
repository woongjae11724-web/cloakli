// content-core.js의 순수 함수 단위 테스트. DOM, chrome.* API가 전혀 필요 없다.
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const CloakliCore = require("../content-core.js");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------
// debounce
// -----------------------------------------------------------------------
describe("debounce", () => {
  test("여러 번 빠르게 호출해도 마지막 호출 이후 한 번만 실행된다", async () => {
    let callCount = 0;
    const debounced = CloakliCore.debounce(() => callCount++, 30);

    debounced();
    debounced();
    debounced();
    assert.equal(callCount, 0, "대기 시간 전에는 실행되지 않아야 한다");

    await wait(60);
    assert.equal(callCount, 1, "짧은 시간 내 여러 호출은 한 번만 실행되어야 한다");
  });

  test("대기 시간이 지난 뒤 다시 호출하면 또 한 번 실행된다", async () => {
    let callCount = 0;
    const debounced = CloakliCore.debounce(() => callCount++, 20);

    debounced();
    await wait(40);
    debounced();
    await wait(40);

    assert.equal(callCount, 2);
  });

  test("cancel()을 호출하면 예약된 실행이 취소된다", async () => {
    let callCount = 0;
    const debounced = CloakliCore.debounce(() => callCount++, 20);
    debounced();
    debounced.cancel();
    await wait(40);
    assert.equal(callCount, 0);
  });
});

// -----------------------------------------------------------------------
// URL 변경 판별
// -----------------------------------------------------------------------
describe("hasUrlChanged", () => {
  test("실제로 URL이 다르면 true", () => {
    assert.equal(CloakliCore.hasUrlChanged("https://a.com/1", "https://a.com/2"), true);
  });
  test("같은 URL이면 false", () => {
    assert.equal(CloakliCore.hasUrlChanged("https://a.com/1", "https://a.com/1"), false);
  });
  test("문자열이 아니면 false (방어적으로 처리)", () => {
    assert.equal(CloakliCore.hasUrlChanged(undefined, "https://a.com/1"), false);
  });
});

// -----------------------------------------------------------------------
// 저장 규칙 필터링/유효성
// -----------------------------------------------------------------------
describe("isValidRule / filterValidRules", () => {
  test("selector가 있는 정상 규칙은 유효하다", () => {
    assert.equal(CloakliCore.isValidRule({ selector: "#a" }), true);
  });
  test("selector가 없거나 빈 문자열이면 무효하다", () => {
    assert.equal(CloakliCore.isValidRule({ selector: "" }), false);
    assert.equal(CloakliCore.isValidRule({}), false);
    assert.equal(CloakliCore.isValidRule(null), false);
    assert.equal(CloakliCore.isValidRule("just a string"), false);
  });
  test("filterValidRules는 무효한 항목을 제외한다", () => {
    const rules = [{ selector: "#a" }, { selector: "" }, null, { selector: "#b" }];
    const result = CloakliCore.filterValidRules(rules);
    assert.deepEqual(
      result.map((r) => r.selector),
      ["#a", "#b"]
    );
  });
  test("배열이 아니면 빈 배열을 돌려준다", () => {
    assert.deepEqual(CloakliCore.filterValidRules(null), []);
  });
});

// -----------------------------------------------------------------------
// 규칙 중복 방지 / 추가 / 삭제 (storage 관리 화면 회귀 테스트 포함)
// -----------------------------------------------------------------------
describe("ruleExists / addRuleIfNotDuplicate", () => {
  test("hostname/scope/selector/pagePattern이 모두 같으면 중복으로 판단한다", () => {
    const list = [{ hostname: "a.com", scope: "element", selector: "#a", pagePattern: null }];
    assert.equal(
      CloakliCore.ruleExists(list, { hostname: "a.com", scope: "element", selector: "#a", pagePattern: null }),
      true
    );
    assert.equal(
      CloakliCore.ruleExists(list, { hostname: "a.com", scope: "element", selector: "#b", pagePattern: null }),
      false
    );
  });

  test("selector가 같아도 scope가 다르면 중복이 아니다", () => {
    const list = [{ hostname: "a.com", scope: "site", selector: ".card", pagePattern: null }];
    const outcome = CloakliCore.addRuleIfNotDuplicate(list, {
      hostname: "a.com",
      scope: "page",
      selector: ".card",
      pagePattern: "/watch",
    });
    assert.equal(outcome.added, true, "scope가 다르면 별도 규칙으로 허용해야 한다");
  });

  test("selector가 같아도 pagePattern이 다르면 중복이 아니다", () => {
    const list = [{ hostname: "a.com", scope: "page", selector: ".x", pagePattern: "/watch" }];
    const outcome = CloakliCore.addRuleIfNotDuplicate(list, {
      hostname: "a.com",
      scope: "page",
      selector: ".x",
      pagePattern: "/results",
    });
    assert.equal(outcome.added, true);
  });

  test("selector가 같아도 hostname이 다르면 중복이 아니다", () => {
    const list = [{ hostname: "a.com", scope: "site", selector: ".x", pagePattern: null }];
    const outcome = CloakliCore.addRuleIfNotDuplicate(list, {
      hostname: "b.com",
      scope: "site",
      selector: ".x",
      pagePattern: null,
    });
    assert.equal(outcome.added, true);
  });

  test("중복이 아니면 새 규칙이 추가된다", () => {
    const list = [{ hostname: "a.com", scope: "element", selector: "#a", pagePattern: null }];
    const outcome = CloakliCore.addRuleIfNotDuplicate(list, {
      hostname: "a.com",
      scope: "element",
      selector: "#b",
      pagePattern: null,
    });
    assert.equal(outcome.added, true);
    assert.equal(outcome.list.length, 2);
  });

  test("완전히 같은 규칙이면 추가되지 않고 원래 목록 길이가 유지된다", () => {
    const list = [{ hostname: "a.com", scope: "element", selector: "#a", pagePattern: null }];
    const outcome = CloakliCore.addRuleIfNotDuplicate(list, {
      hostname: "a.com",
      scope: "element",
      selector: "#a",
      pagePattern: null,
    });
    assert.equal(outcome.added, false);
    assert.equal(outcome.duplicate, true);
    assert.equal(outcome.list.length, 1);
  });

  test("원본 배열은 변경하지 않는다 (불변)", () => {
    const list = [{ hostname: "a.com", scope: "element", selector: "#a", pagePattern: null }];
    CloakliCore.addRuleIfNotDuplicate(list, { hostname: "a.com", scope: "element", selector: "#b", pagePattern: null });
    assert.equal(list.length, 1);
  });
});

describe("removeRuleById / removeRuleBySelectorAndCreatedAt", () => {
  test("id로 규칙 하나만 정확히 제거한다 (다른 규칙은 유지)", () => {
    const list = [
      { id: "1", selector: "#a" },
      { id: "2", selector: "#b" },
      { id: "3", selector: "#c" },
    ];
    const outcome = CloakliCore.removeRuleById(list, "2");
    assert.equal(outcome.removed, true);
    assert.deepEqual(
      outcome.list.map((r) => r.id),
      ["1", "3"]
    );
  });

  test("존재하지 않는 id면 removed:false, 목록은 그대로", () => {
    const list = [{ id: "1", selector: "#a" }];
    const outcome = CloakliCore.removeRuleById(list, "no-such-id");
    assert.equal(outcome.removed, false);
    assert.equal(outcome.list.length, 1);
  });

  test("id가 없는(예전) 규칙은 selector+생성시각으로 대체 매칭해 제거한다", () => {
    const list = [
      { selector: "#legacy", createdAt: 111 },
      { selector: "#other", createdAt: 222 },
    ];
    const outcome = CloakliCore.removeRuleBySelectorAndCreatedAt(list, "#legacy", 111);
    assert.equal(outcome.removed, true);
    assert.equal(outcome.list.length, 1);
    assert.equal(outcome.list[0].selector, "#other");
  });
});

describe("countRules", () => {
  test("유효한 규칙만 개수에 포함한다", () => {
    assert.equal(CloakliCore.countRules([{ selector: "#a" }, { selector: "" }, { selector: "#b" }]), 2);
  });
  test("배열이 아니면 0", () => {
    assert.equal(CloakliCore.countRules(undefined), 0);
  });
});

describe("ensureRuleIds (id + scope/pagePattern 마이그레이션)", () => {
  test("id가 없는 규칙에만 새 id를 채운다", () => {
    const list = [{ selector: "#a", id: "keep-me", scope: "element", pagePattern: null }, { selector: "#b" }];
    let counter = 0;
    const outcome = CloakliCore.ensureRuleIds(list, () => "generated-" + counter++);
    assert.equal(outcome.changed, true);
    assert.equal(outcome.list[0].id, "keep-me");
    assert.equal(outcome.list[1].id, "generated-0");
  });

  test("scope가 없는(2단계) 규칙은 element로, pagePattern은 null로 채운다", () => {
    const list = [{ selector: "#legacy", id: "1", createdAt: 999, hostname: "a.com" }];
    const outcome = CloakliCore.ensureRuleIds(list, CloakliCore.generateRuleId);
    assert.equal(outcome.changed, true);
    assert.equal(outcome.list[0].scope, "element");
    assert.equal(outcome.list[0].pagePattern, null);
    // 기존 필드는 그대로 유지되어야 한다.
    assert.equal(outcome.list[0].selector, "#legacy");
    assert.equal(outcome.list[0].createdAt, 999);
    assert.equal(outcome.list[0].hostname, "a.com");
  });

  test("이미 id/scope/pagePattern이 모두 있으면 changed:false이고 내용이 그대로다 (반복 실행해도 안전)", () => {
    const list = [
      { selector: "#a", id: "1", scope: "element", pagePattern: null },
      { selector: "#b", id: "2", scope: "site", pagePattern: null },
    ];
    const first = CloakliCore.ensureRuleIds(list, CloakliCore.generateRuleId);
    assert.equal(first.changed, false);
    const second = CloakliCore.ensureRuleIds(first.list, CloakliCore.generateRuleId);
    assert.equal(second.changed, false);
    assert.deepEqual(
      second.list.map((r) => r.id),
      ["1", "2"]
    );
  });

  test("여러 번 실행해도 마이그레이션 결과가 같다 (idempotent, 중복 생성 없음)", () => {
    const list = [{ selector: "#legacy", createdAt: 1 }];
    const once = CloakliCore.ensureRuleIds(list, CloakliCore.generateRuleId);
    const twice = CloakliCore.ensureRuleIds(once.list, CloakliCore.generateRuleId);
    assert.equal(once.list.length, 1);
    assert.equal(twice.list.length, 1);
    assert.equal(twice.list[0].id, once.list[0].id, "이미 부여된 id를 다시 바꾸면 안 된다");
  });

  test("잘못된(selector 없는) 규칙이 섞여 있어도 나머지는 정상 마이그레이션된다", () => {
    const list = [null, { notARule: true }, { selector: "" }, { selector: "#ok" }];
    const outcome = CloakliCore.ensureRuleIds(list, CloakliCore.generateRuleId);
    const ok = outcome.list.find((r) => r && r.selector === "#ok");
    assert.ok(ok);
    assert.equal(ok.scope, "element");
  });

  test("generateRuleId는 호출할 때마다 다른 값을 돌려준다", () => {
    const a = CloakliCore.generateRuleId();
    const b = CloakliCore.generateRuleId();
    assert.notEqual(a, b);
  });
});

// -----------------------------------------------------------------------
// Cloakli 자체 UI 요소 판별 (observer가 자기 자신의 변경을 무시하기 위한 근거)
// -----------------------------------------------------------------------
describe("isCloakliOwnNodeDescriptor", () => {
  const OWN_CLASSES = ["cloakli-mask-overlay", "cloakli-mask-wrapper", "cloakli-selection-banner", "cloakli-toast"];
  const OWN_IDS = ["cloakli-selection-banner-root", "cloakli-toast-root"];

  test("Cloakli 전용 class를 가진 요소는 자체 UI로 판별한다", () => {
    const node = { nodeType: 1, id: "", classList: ["cloakli-mask-overlay"] };
    assert.equal(CloakliCore.isCloakliOwnNodeDescriptor(node, OWN_CLASSES, OWN_IDS), true);
  });

  test("Cloakli 전용 id를 가진 요소도 자체 UI로 판별한다", () => {
    const node = { nodeType: 1, id: "cloakli-toast-root", classList: [] };
    assert.equal(CloakliCore.isCloakliOwnNodeDescriptor(node, OWN_CLASSES, OWN_IDS), true);
  });

  test("웹사이트 자체 요소는 false", () => {
    const node = { nodeType: 1, id: "site-header", classList: ["nav", "sticky"] };
    assert.equal(CloakliCore.isCloakliOwnNodeDescriptor(node, OWN_CLASSES, OWN_IDS), false);
  });

  test("텍스트 노드(nodeType !== 1)는 false", () => {
    assert.equal(CloakliCore.isCloakliOwnNodeDescriptor({ nodeType: 3 }, OWN_CLASSES, OWN_IDS), false);
  });
});

describe("hasNonCloakliChange", () => {
  const isOwn = (node) => node && node.own === true;

  test("추가/삭제된 노드가 모두 Cloakli 소유면 false (무시해야 함)", () => {
    const mutations = [{ addedNodes: [{ own: true }], removedNodes: [{ own: true }] }];
    assert.equal(CloakliCore.hasNonCloakliChange(mutations, isOwn), false);
  });

  test("Cloakli 소유가 아닌 노드가 하나라도 있으면 true", () => {
    const mutations = [{ addedNodes: [{ own: true }, { own: false }], removedNodes: [] }];
    assert.equal(CloakliCore.hasNonCloakliChange(mutations, isOwn), true);
  });

  test("mutation이 없으면 false", () => {
    assert.equal(CloakliCore.hasNonCloakliChange([], isOwn), false);
  });
});

// -----------------------------------------------------------------------
// 규칙 적용 오케스트레이션 (applyRuleSet) - "규칙 적용 테스트" 항목 전부
// -----------------------------------------------------------------------
describe("applyRuleSet", () => {
  test("selector와 일치하는 새 요소가 있으면 가림이 적용된다", () => {
    const rules = [{ selector: "#target" }];
    const maskedEls = [];
    const result = CloakliCore.applyRuleSet(rules, {
      queryElements: (sel) => (sel === "#target" ? ["el-1"] : []),
      isSelectable: () => true,
      maskElement: (el) => {
        maskedEls.push(el);
        return true;
      },
    });
    assert.deepEqual(maskedEls, ["el-1"]);
    assert.equal(result.appliedCount, 1);
  });

  test("selector와 일치하지 않는 요소는 가려지지 않는다", () => {
    const rules = [{ selector: "#nope" }];
    let maskCalls = 0;
    CloakliCore.applyRuleSet(rules, {
      queryElements: () => [],
      isSelectable: () => true,
      maskElement: () => {
        maskCalls++;
        return true;
      },
    });
    assert.equal(maskCalls, 0);
  });

  test("isSelectable이 false인 요소(=Cloakli 자체 UI 등)는 건너뛴다", () => {
    let maskCalls = 0;
    CloakliCore.applyRuleSet([{ selector: ".x" }], {
      queryElements: () => ["banner-el"],
      isSelectable: () => false,
      maskElement: () => {
        maskCalls++;
        return true;
      },
    });
    assert.equal(maskCalls, 0);
  });

  test("같은 요소에 두 번 적용해도 가림막은 하나만 생긴다 (maskElement의 중복 방지에 위임)", () => {
    const maskedOnce = new Set();
    const maskElement = (el) => {
      if (maskedOnce.has(el)) return false; // 이미 가려짐 -> 새로 만들지 않음
      maskedOnce.add(el);
      return true;
    };
    const adapters = { queryElements: () => ["el-1"], isSelectable: () => true, maskElement };

    const first = CloakliCore.applyRuleSet([{ selector: "#a" }], adapters);
    const second = CloakliCore.applyRuleSet([{ selector: "#a" }], adapters);

    assert.equal(first.appliedCount, 1);
    assert.equal(second.appliedCount, 0, "두 번째 적용에서는 이미 가려진 요소이므로 카운트되지 않아야 한다");
    assert.equal(maskedOnce.size, 1);
  });

  test("여러 규칙이 같은 요소를 찾아도 가림막은 하나만 생긴다", () => {
    const maskedOnce = new Set();
    const maskElement = (el) => {
      if (maskedOnce.has(el)) return false;
      maskedOnce.add(el);
      return true;
    };
    const rules = [{ selector: ".a" }, { selector: ".b" }]; // 두 selector가 같은 요소를 가리킨다고 가정
    const result = CloakliCore.applyRuleSet(rules, {
      queryElements: () => ["shared-el"],
      isSelectable: () => true,
      maskElement,
    });
    assert.equal(result.appliedCount, 1);
    assert.equal(maskedOnce.size, 1);
  });

  test("잘못된 selector 하나가 예외를 던져도 다른 규칙은 계속 적용된다", () => {
    const maskedEls = [];
    const rules = [{ selector: "###broken[[[" }, { selector: "#good" }];
    const result = CloakliCore.applyRuleSet(rules, {
      queryElements: (sel) => {
        if (sel === "###broken[[[") throw new Error("문법 오류가 있는 선택자");
        return ["good-el"];
      },
      isSelectable: () => true,
      maskElement: (el) => {
        maskedEls.push(el);
        return true;
      },
    });
    assert.deepEqual(maskedEls, ["good-el"]);
    assert.equal(result.erroredRules, 1);
    assert.equal(result.appliedCount, 1);
  });

  test("selector가 없는(잘못된) 규칙은 조용히 건너뛰고 통계에 기록한다", () => {
    const result = CloakliCore.applyRuleSet([{ selector: "" }, null, { selector: "#ok" }], {
      queryElements: () => ["el"],
      isSelectable: () => true,
      maskElement: () => true,
    });
    assert.equal(result.skippedInvalidRules, 2);
    assert.equal(result.processedRules, 1);
  });

  test("규칙이 0개면 queryElements를 한 번도 호출하지 않는다 (불필요한 작업 없음)", () => {
    let calls = 0;
    CloakliCore.applyRuleSet([], {
      queryElements: () => {
        calls++;
        return [];
      },
      isSelectable: () => true,
      maskElement: () => true,
    });
    assert.equal(calls, 0);
  });

  // 10단계: YouTube 썸네일 버그 수정 - "이 요소만"(element) 범위는 지금 이 문서에서
  // selector가 정확히 하나만 찾을 때만 적용해야 한다. 저장 시점엔 유일했더라도(무한 스크롤
  // 등으로) 나중에 같은 selector에 걸리는 요소가 더 생기면, 그 순간부터는 아무 것도 가리지
  // 않아야 한다 - 다른 카드까지 함께 가려지는 것보다 항상 더 안전하다.
  test("element 범위 규칙은 selector가 2개 이상 찾으면 아무 것도 가리지 않는다", () => {
    const maskedEls = [];
    const rules = [{ scope: "element", selector: "#thumbnail" }];
    const result = CloakliCore.applyRuleSet(rules, {
      queryElements: () => ["card-1-thumb", "card-2-thumb", "card-3-thumb"],
      isSelectable: () => true,
      maskElement: (el) => {
        maskedEls.push(el);
        return true;
      },
    });
    assert.deepEqual(maskedEls, [], "다른 카드까지 함께 가려지면 안 된다");
    assert.equal(result.appliedCount, 0);
  });

  test("element 범위 규칙은 selector가 0개 찾아도(요소가 사라짐) 아무 것도 가리지 않는다", () => {
    let maskCalls = 0;
    const result = CloakliCore.applyRuleSet([{ scope: "element", selector: "#gone" }], {
      queryElements: () => [],
      isSelectable: () => true,
      maskElement: () => {
        maskCalls++;
        return true;
      },
    });
    assert.equal(maskCalls, 0);
    assert.equal(result.appliedCount, 0);
  });

  test("element 범위 규칙은 정확히 1개를 찾을 때만 그 하나를 가린다", () => {
    const maskedEls = [];
    const result = CloakliCore.applyRuleSet([{ scope: "element", selector: "#only-one" }], {
      queryElements: () => ["single-el"],
      isSelectable: () => true,
      maskElement: (el) => {
        maskedEls.push(el);
        return true;
      },
    });
    assert.deepEqual(maskedEls, ["single-el"]);
    assert.equal(result.appliedCount, 1);
  });

  test("page/site 범위 규칙은 여러 개를 찾으면 전부 가린다 (element 범위와 달리 의도된 동작)", () => {
    const maskedEls = [];
    ["page", "site"].forEach((scope) => {
      maskedEls.length = 0;
      CloakliCore.applyRuleSet([{ scope, selector: ".thumb" }], {
        queryElements: () => ["thumb-1", "thumb-2", "thumb-3"],
        isSelectable: () => true,
        maskElement: (el) => {
          maskedEls.push(el);
          return true;
        },
      });
      assert.deepEqual(maskedEls, ["thumb-1", "thumb-2", "thumb-3"], `scope:${scope}는 여러 요소를 모두 가려야 한다`);
    });
  });

  test("scope 필드가 없는 예전 규칙은 element로 취급되어 다중 매칭 시 가리지 않는다", () => {
    const maskedEls = [];
    CloakliCore.applyRuleSet([{ selector: ".legacy" }], {
      queryElements: () => ["a", "b"],
      isSelectable: () => true,
      maskElement: (el) => {
        maskedEls.push(el);
        return true;
      },
    });
    assert.deepEqual(maskedEls, []);
  });
});

// -----------------------------------------------------------------------
// isRiskySelector: 옵션 화면의 "위험한 규칙" 경고 판별
// -----------------------------------------------------------------------
describe("isRiskySelector", () => {
  test("조상 경로 없는 흔한 id(#thumbnail 등)는 위험으로 판별한다", () => {
    assert.equal(CloakliCore.isRiskySelector("#thumbnail"), true);
    assert.equal(CloakliCore.isRiskySelector("a#thumbnail"), true);
  });

  test("bare 태그(img, div, a, ytd-thumbnail, yt-image 등)는 위험으로 판별한다", () => {
    ["img", "div", "a", "ytd-thumbnail", "yt-image"].forEach((tag) => {
      assert.equal(CloakliCore.isRiskySelector(tag), true, `${tag}는 위험으로 판별해야 한다`);
    });
  });

  test("조상 경로가 있는 selector는 위험으로 판별하지 않는다", () => {
    assert.equal(CloakliCore.isRiskySelector("div.video-grid > div.video-card:nth-of-type(3) > img"), false);
  });

  test("흔하지 않은 고유 id는 위험으로 판별하지 않는다", () => {
    assert.equal(CloakliCore.isRiskySelector("#main-header-logo"), false);
  });

  test("class로 한정된 selector는 위험으로 판별하지 않는다", () => {
    assert.equal(CloakliCore.isRiskySelector("img.thumb-img"), false);
  });

  test("빈 값/손상된 값은 안전하게 false를 돌려준다", () => {
    assert.equal(CloakliCore.isRiskySelector(""), false);
    assert.equal(CloakliCore.isRiskySelector(null), false);
    assert.equal(CloakliCore.isRiskySelector(undefined), false);
  });
});

// -----------------------------------------------------------------------
// 일시 해제 상태 전환
// -----------------------------------------------------------------------
describe("nextTemporaryDisableState", () => {
  const EV = CloakliCore.TEMP_DISABLE_EVENTS;

  test("CLEAR_CLICKED 이후에는 항상 true(일시 해제 켜짐)", () => {
    assert.equal(CloakliCore.nextTemporaryDisableState(false, EV.CLEAR_CLICKED), true);
    assert.equal(CloakliCore.nextTemporaryDisableState(true, EV.CLEAR_CLICKED), true);
  });

  test("URL_CHANGED 이후에는 항상 false(다시 적용 가능)", () => {
    assert.equal(CloakliCore.nextTemporaryDisableState(true, EV.URL_CHANGED), false);
  });

  test("PAGE_LOAD 이후에는 항상 false", () => {
    assert.equal(CloakliCore.nextTemporaryDisableState(true, EV.PAGE_LOAD), false);
  });

  test("알 수 없는 이벤트는 현재 상태를 그대로 유지한다", () => {
    assert.equal(CloakliCore.nextTemporaryDisableState(true, "UNKNOWN"), true);
    assert.equal(CloakliCore.nextTemporaryDisableState(false, "UNKNOWN"), false);
  });
});

// -----------------------------------------------------------------------
// URL 정규화 (page pattern)
// -----------------------------------------------------------------------
describe("normalizePagePattern", () => {
  test("YouTube: 쿼리의 영상 ID(v=abc)는 제거하고 pathname만 남긴다", () => {
    assert.equal(CloakliCore.normalizePagePattern("https://www.youtube.com/watch?v=abc"), "/watch");
  });

  test("서로 다른 영상 ID라도 같은 pathname이면 같은 패턴이다", () => {
    const a = CloakliCore.normalizePagePattern("https://www.youtube.com/watch?v=AAA");
    const b = CloakliCore.normalizePagePattern("https://www.youtube.com/watch?v=BBB");
    assert.equal(a, b);
    assert.equal(a, "/watch");
  });

  test("hash는 제거된다", () => {
    assert.equal(CloakliCore.normalizePagePattern("https://mail.google.com/mail/u/0/#inbox/xyz"), "/mail/u/0/");
  });

  test("pathname이 다르면 다른 패턴이다", () => {
    const list = CloakliCore.normalizePagePattern("https://www.youtube.com/results?search_query=x");
    const watch = CloakliCore.normalizePagePattern("https://www.youtube.com/watch?v=abc");
    assert.notEqual(list, watch);
  });

  test("query/hash가 없는 URL도 정상 처리한다", () => {
    assert.equal(CloakliCore.normalizePagePattern("https://example.com/about"), "/about");
  });

  test("잘못된 URL은 예외 없이 null을 돌려준다", () => {
    assert.equal(CloakliCore.normalizePagePattern("이건-url이-아님"), null);
    assert.equal(CloakliCore.normalizePagePattern(""), null);
    assert.equal(CloakliCore.normalizePagePattern(undefined), null);
    assert.equal(CloakliCore.normalizePagePattern(null), null);
  });
});

// -----------------------------------------------------------------------
// scope 적용 판별
// -----------------------------------------------------------------------
describe("doesRuleApplyToCurrentPage", () => {
  test("element 규칙은 hostname만 같으면 적용 대상이다", () => {
    const rule = { hostname: "a.com", scope: "element", selector: "#x" };
    assert.equal(CloakliCore.doesRuleApplyToCurrentPage(rule, { hostname: "a.com", href: "https://a.com/anything" }), true);
  });

  test("page 규칙은 정규화된 page pattern이 같을 때만 적용된다", () => {
    const rule = { hostname: "www.youtube.com", scope: "page", selector: ".title", pagePattern: "/watch" };
    assert.equal(
      CloakliCore.doesRuleApplyToCurrentPage(rule, { hostname: "www.youtube.com", href: "https://www.youtube.com/watch?v=zzz" }),
      true,
      "같은 pathname(/watch)이면 영상 ID가 달라도 적용되어야 한다"
    );
    assert.equal(
      CloakliCore.doesRuleApplyToCurrentPage(rule, { hostname: "www.youtube.com", href: "https://www.youtube.com/results?search_query=x" }),
      false,
      "다른 pathname(/results)에는 적용되면 안 된다"
    );
  });

  test("site 규칙은 hostname 내 어떤 URL에도 적용된다", () => {
    const rule = { hostname: "www.youtube.com", scope: "site", selector: ".title" };
    assert.equal(
      CloakliCore.doesRuleApplyToCurrentPage(rule, { hostname: "www.youtube.com", href: "https://www.youtube.com/watch?v=1" }),
      true
    );
    assert.equal(
      CloakliCore.doesRuleApplyToCurrentPage(rule, { hostname: "www.youtube.com", href: "https://www.youtube.com/results" }),
      true
    );
  });

  test("다른 hostname에는 scope와 무관하게 적용되지 않는다", () => {
    const siteRule = { hostname: "a.com", scope: "site", selector: ".x" };
    assert.equal(CloakliCore.doesRuleApplyToCurrentPage(siteRule, { hostname: "b.com", href: "https://b.com/x" }), false);
  });

  test("규칙이나 location이 없으면 안전하게 false", () => {
    assert.equal(CloakliCore.doesRuleApplyToCurrentPage(null, { hostname: "a.com", href: "https://a.com/" }), false);
    assert.equal(CloakliCore.doesRuleApplyToCurrentPage({ hostname: "a.com" }, null), false);
  });
});

// -----------------------------------------------------------------------
// 일반화 selector 안전성 검사
// -----------------------------------------------------------------------
describe("evaluateGeneralizedSelectorSafety", () => {
  test("정상 범위(2~50개, class 포함)면 허용한다", () => {
    const result = CloakliCore.evaluateGeneralizedSelectorSafety("div.video-title", 12, {
      originalElementIncluded: true,
      areaRatio: 0.1,
    });
    assert.equal(result.ok, true);
  });

  test("0개 검색이면 저장을 차단한다", () => {
    const result = CloakliCore.evaluateGeneralizedSelectorSafety("div.video-title", 0, { originalElementIncluded: true });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "no-matches");
  });

  test("50개를 초과하면 차단한다", () => {
    const result = CloakliCore.evaluateGeneralizedSelectorSafety("div.card", 51, { originalElementIncluded: true });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "too-many-matches");
  });

  test("class/속성 없는 단독 태그(div, span, a 등)는 차단한다", () => {
    ["div", "span", "a", "  DIV  "].forEach((sel) => {
      const result = CloakliCore.evaluateGeneralizedSelectorSafety(sel, 5, { originalElementIncluded: true });
      assert.equal(result.ok, false, `${sel}는 차단되어야 한다`);
      assert.equal(result.reason, "selector-too-generic");
    });
  });

  test("html/body는 차단한다", () => {
    const result = CloakliCore.evaluateGeneralizedSelectorSafety("body", 5, { originalElementIncluded: true });
    assert.equal(result.ok, false);
  });

  test("selector 길이가 너무 길면 차단한다", () => {
    const longSelector = "div.a" + ".b".repeat(150);
    const result = CloakliCore.evaluateGeneralizedSelectorSafety(longSelector, 5, { originalElementIncluded: true });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "selector-too-long");
  });

  test("원래 선택한 요소가 결과에 포함되지 않으면 차단한다", () => {
    const result = CloakliCore.evaluateGeneralizedSelectorSafety("div.card", 5, { originalElementIncluded: false });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "original-not-included");
  });

  test("일치 요소들의 면적 합이 뷰포트의 50%를 넘으면 차단한다", () => {
    const result = CloakliCore.evaluateGeneralizedSelectorSafety("div.card", 5, {
      originalElementIncluded: true,
      areaRatio: 0.9,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "covers-too-much-area");
  });

  test("selector가 없으면 차단한다", () => {
    const result = CloakliCore.evaluateGeneralizedSelectorSafety(null, 5, {});
    assert.equal(result.ok, false);
    assert.equal(result.reason, "selector-missing");
  });
});

// -----------------------------------------------------------------------
// 사이트 단위 일시중지(pause) 상태 조회
// -----------------------------------------------------------------------
describe("isHostnamePaused", () => {
  test("맵에 hostname이 true로 있으면 일시중지 상태다", () => {
    assert.equal(CloakliCore.isHostnamePaused({ "www.youtube.com": true }, "www.youtube.com"), true);
  });

  test("맵에 없는 hostname은 일시중지 상태가 아니다", () => {
    assert.equal(CloakliCore.isHostnamePaused({ "www.youtube.com": true }, "mail.google.com"), false);
  });

  test("맵이나 hostname이 없으면 안전하게 false를 돌려준다", () => {
    assert.equal(CloakliCore.isHostnamePaused(null, "a.com"), false);
    assert.equal(CloakliCore.isHostnamePaused({ "a.com": true }, null), false);
    assert.equal(CloakliCore.isHostnamePaused(undefined, undefined), false);
  });

  test("다른 사이트의 일시중지 여부는 영향을 주지 않는다", () => {
    const map = { "a.com": true, "b.com": true };
    assert.equal(CloakliCore.isHostnamePaused(map, "c.com"), false);
  });
});

// -----------------------------------------------------------------------
// toast 종류 정규화
// -----------------------------------------------------------------------
describe("normalizeToastType", () => {
  test("정의된 종류는 그대로 돌려준다", () => {
    ["success", "info", "warning", "error"].forEach((type) => {
      assert.equal(CloakliCore.normalizeToastType(type), type);
    });
  });

  test("정의되지 않은 값이나 없는 값은 info로 취급한다", () => {
    assert.equal(CloakliCore.normalizeToastType("something-else"), "info");
    assert.equal(CloakliCore.normalizeToastType(undefined), "info");
    assert.equal(CloakliCore.normalizeToastType(null), "info");
  });
});
