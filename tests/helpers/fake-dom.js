// 테스트 전용 최소 DOM 구현.
//
// jsdom 등 외부 의존성을 추가하지 않기 위해, content.js가 실제로 사용하는
// DOM API의 부분집합만 손으로 구현한다. 지원하는 selector 문법도
// Cloakli가 실제로 만들어 내는 형태(#id, .class, tag.class, [attr="value"],
// "A > B > C" 자식 체인, ":nth-of-type(n)", ":scope > X")로 의도적으로 제한한다.
//
// 실제 제품 코드(content.js 등)에는 포함되지 않는, 테스트 전용 파일이다.
"use strict";

class FakeClassList {
  constructor() {
    this._set = new Set();
  }
  add(name) {
    this._set.add(name);
  }
  remove(name) {
    this._set.delete(name);
  }
  contains(name) {
    return this._set.has(name);
  }
  toString() {
    return Array.from(this._set).join(" ");
  }
  [Symbol.iterator]() {
    return this._set[Symbol.iterator]();
  }
}

function normalizeListenerOptions(options) {
  if (typeof options === "boolean") return { capture: options, once: false };
  return { capture: !!(options && options.capture), once: !!(options && options.once) };
}

// addEventListener/removeEventListener/dispatchEvent를 여러 클래스에서 재사용하기 위한 mixin.
function makeEventTarget() {
  return {
    _listeners: Object.create(null),
    addEventListener(type, fn, options) {
      const { capture, once } = normalizeListenerOptions(options);
      const key = type + "|" + (capture ? "c" : "b");
      this._listeners[key] = this._listeners[key] || [];
      this._listeners[key].push({ fn, once });
    },
    removeEventListener(type, fn, options) {
      const { capture } = normalizeListenerOptions(options);
      const key = type + "|" + (capture ? "c" : "b");
      const arr = this._listeners[key];
      if (!arr) return;
      const idx = arr.findIndex((entry) => entry.fn === fn);
      if (idx !== -1) arr.splice(idx, 1);
    },
  };
}

function fireListeners(node, type, capture, evt) {
  const key = type + "|" + (capture ? "c" : "b");
  const arr = node._listeners && node._listeners[key];
  if (!arr) return;
  // once 리스너는 실행 후 제거하므로, 실행 도중 배열이 바뀌어도 안전하도록 복사본을 순회한다.
  arr.slice().forEach((entry) => {
    if (evt.__stoppedImmediate) return;
    entry.fn(evt);
    if (entry.once) {
      const idx = arr.indexOf(entry);
      if (idx !== -1) arr.splice(idx, 1);
    }
  });
}

function isConnectedToDocument(node, documentElement) {
  let n = node;
  while (n) {
    if (n === documentElement) return true;
    n = n.parentNode;
  }
  return false;
}

class FakeNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.parentNode = null;
    this.childNodes = [];
  }
  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  get previousElementSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    const idx = siblings.indexOf(this);
    return idx > 0 ? siblings[idx - 1] : null;
  }
}

class FakeElement extends FakeNode {
  constructor(tagName, env) {
    super(1);
    this.tagName = String(tagName).toUpperCase();
    this.id = "";
    this.classList = new FakeClassList();
    this.className = "";
    this._attributes = new Map();
    this.style = {};
    this.dataset = {};
    this._env = env;
    Object.assign(this, makeEventTarget());
  }

  set className(value) {
    this.classList = new FakeClassList();
    String(value || "")
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => this.classList.add(c));
  }
  get className() {
    return this.classList ? this.classList.toString() : "";
  }

  get attributes() {
    return Array.from(this._attributes.entries()).map(([name, value]) => ({ name, value }));
  }

  getAttribute(name) {
    if (name === "id") return this.id || null;
    return this._attributes.has(name) ? this._attributes.get(name) : null;
  }

  setAttribute(name, value) {
    if (name === "id") {
      this.id = String(value);
      return;
    }
    this._attributes.set(name, String(value));
  }

  // 실제 <a>.href는 attribute를 문서 기준 절대 URL로 자동 변환해 돌려준다(getAttribute와 다름).
  // content.js가 이 절대 URL 변환에 의존하므로(상대 경로 href도 올바르게 새 탭/이동 처리),
  // 테스트 환경에서도 같은 동작을 재현한다. href attribute가 없으면 undefined(실제 DOM과 동일).
  get href() {
    if (!this._attributes.has("href")) return undefined;
    const raw = this._attributes.get("href");
    try {
      const baseHref = this._env && this._env.sandbox && this._env.sandbox.location && this._env.sandbox.location.href;
      if (baseHref) return new URL(raw, baseHref).href;
    } catch (err) {
      // 상대 경로 해석에 실패해도 원본 문자열은 돌려준다.
    }
    return raw;
  }
  set href(value) {
    this.setAttribute("href", value);
  }

  // 실제 MutationObserver(subtree:true)는 "관찰 대상 트리에 실제로 붙어있는" 노드의
  // 변경에만 반응한다. overlay처럼 아직 문서에 붙기 전인 요소에 자식을 추가하는 것은
  // (예: maskElement가 오버레이를 만들면서 label을 먼저 붙이는 단계) observer에 보이지
  // 않아야 하므로, this가 실제로 documentElement 아래 연결돼 있을 때만 기록한다.
  _notifyIfConnected(record) {
    if (!this._env || !this._env.document) return;
    if (isConnectedToDocument(this, this._env.document.documentElement)) {
      this._env.notifyMutation(record);
    }
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    this._notifyIfConnected({ target: this, addedNodes: [child], removedNodes: [] });
    return child;
  }

  insertBefore(newNode, referenceNode) {
    if (newNode.parentNode) newNode.parentNode.removeChild(newNode);
    newNode.parentNode = this;
    if (referenceNode == null) {
      this.childNodes.push(newNode);
    } else {
      const idx = this.childNodes.indexOf(referenceNode);
      this.childNodes.splice(idx === -1 ? this.childNodes.length : idx, 0, newNode);
    }
    this._notifyIfConnected({ target: this, addedNodes: [newNode], removedNodes: [] });
    return newNode;
  }

  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
      this._notifyIfConnected({ target: this, addedNodes: [], removedNodes: [child] });
    }
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  closest(selectorList) {
    const selectors = selectorList.split(",").map((s) => s.trim());
    let node = this;
    while (node && node.nodeType === 1) {
      if (selectors.some((sel) => matchesSimpleSelector(node, sel))) return node;
      node = node.parentNode;
    }
    return null;
  }

  matches(selector) {
    return matchesSimpleSelector(this, selector);
  }

  querySelector(selector) {
    return queryAll(this, selector)[0] || null;
  }

  querySelectorAll(selector) {
    return queryAll(this, selector);
  }

  // 테스트가 el._rect = { top, left, width, height }로 좌표를 지정할 수 있다.
  // (화면 고정 선택 모드의 좌표 기반 선택을 검증하기 위해 필요)
  getBoundingClientRect() {
    if (this._rect) return Object.assign({}, this._rect);
    return { width: 100, height: 50, top: 0, left: 0 };
  }

  // 실제 DOM의 Node.isConnected와 동일: 문서 트리에 붙어 있는지.
  get isConnected() {
    if (!this._env || !this._env.document) return true;
    return isConnectedToDocument(this, this._env.document.documentElement);
  }
}

class FakeDocument {
  constructor(env) {
    this._env = env;
    this.documentElement = new FakeElement("HTML", env);
    this.body = new FakeElement("BODY", env);
    this.documentElement.appendChild(this.body);
    Object.assign(this, makeEventTarget());
  }

  createElement(tag) {
    return new FakeElement(tag, this._env);
  }

  getElementById(id) {
    const all = [this.documentElement, ...collectDescendants(this.documentElement, [])];
    return all.find((el) => el.id === id) || null;
  }

  querySelector(selector) {
    return queryAll(this.documentElement, selector)[0] || null;
  }

  querySelectorAll(selector) {
    return queryAll(this.documentElement, selector);
  }
}

// ---------------------------------------------------------------------
// 아주 단순한 CSS selector 엔진: Cloakli가 실제로 만드는 형태만 지원한다.
// ---------------------------------------------------------------------

function parseCompoundSelector(rawStr) {
  let rest = rawStr.trim();
  let nth = null;

  const nthMatch = rest.match(/:nth-of-type\((\d+)\)$/);
  if (nthMatch) {
    nth = parseInt(nthMatch[1], 10);
    rest = rest.slice(0, nthMatch.index);
  }

  const attrs = [];
  rest = rest.replace(/\[([A-Za-z0-9_-]+)(?:="((?:[^"\\]|\\.)*)")?\]/g, (m, name, val) => {
    attrs.push({ name, value: val !== undefined ? val.replace(/\\(.)/g, "$1") : undefined });
    return "";
  });

  let id = null;
  rest = rest.replace(/#([A-Za-z0-9_\-\\]+)/, (m, idPart) => {
    id = idPart.replace(/\\(.)/g, "$1");
    return "";
  });

  const classes = [];
  rest = rest.replace(/\.([A-Za-z0-9_\-\\]+)/g, (m, c) => {
    classes.push(c.replace(/\\(.)/g, "$1"));
    return "";
  });

  const tag = rest.trim() || null;
  return { tag, id, classes, attrs, nth };
}

function nthOfTypeIndex(el) {
  let index = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === el.tagName) index++;
    sibling = sibling.previousElementSibling;
  }
  return index;
}

function matchesCompound(el, compound) {
  if (!el || el.nodeType !== 1) return false;
  if (compound.tag && el.tagName.toLowerCase() !== compound.tag.toLowerCase()) return false;
  if (compound.id && el.id !== compound.id) return false;
  for (const c of compound.classes) {
    if (!el.classList.contains(c)) return false;
  }
  for (const a of compound.attrs) {
    const actual = el.getAttribute(a.name);
    if (actual === null) return false;
    if (a.value !== undefined && actual !== a.value) return false;
  }
  if (compound.nth !== null && nthOfTypeIndex(el) !== compound.nth) return false;
  return true;
}

function matchesSimpleSelector(el, selectorStr) {
  return matchesCompound(el, parseCompoundSelector(selectorStr));
}

function collectDescendants(root, acc) {
  for (const child of root.childNodes) {
    if (child.nodeType === 1) {
      acc.push(child);
      collectDescendants(child, acc);
    }
  }
  return acc;
}

// 최상위(대괄호 밖)의 콤마 기준으로 selector 목록("img, picture" 등)을 나눈다.
// 실제 querySelectorAll처럼 여러 selector 중 하나라도 일치하면 포함시키기 위함이다.
function splitSelectorList(selectorStr) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < selectorStr.length; i++) {
    const ch = selectorStr[i];
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "," && depth <= 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((s) => s.trim()).filter(Boolean);
}

function queryAll(contextEl, selectorStr) {
  const trimmed = String(selectorStr).trim();

  const groups = splitSelectorList(trimmed);
  if (groups.length > 1) {
    const seen = new Set();
    const results = [];
    groups.forEach((group) => {
      queryAll(contextEl, group).forEach((el) => {
        if (!seen.has(el)) {
          seen.add(el);
          results.push(el);
        }
      });
    });
    return results;
  }

  if (trimmed.startsWith(":scope > ")) {
    const compound = parseCompoundSelector(trimmed.slice(":scope > ".length));
    return contextEl.children.filter((c) => matchesCompound(c, compound));
  }

  // "A > B C"처럼 자식(">")과 자손(공백) 결합자가 섞인 selector를 단계별로 나눈다.
  // 각 단계는 { compound, combinator }이며, combinator는 "이 compound 앞에 있던 결합자"다
  // (맨 처음 compound는 combinator가 없으므로 의미 없음).
  function tokenizeSelector(selectorStr) {
    const normalized = selectorStr.replace(/\s*>\s*/g, " > ").trim();
    const rawTokens = normalized.split(/\s+/).filter(Boolean);
    const steps = [];
    let pendingCombinator = "descendant";
    rawTokens.forEach((token) => {
      if (token === ">") {
        pendingCombinator = "child";
        return;
      }
      steps.push({ compound: parseCompoundSelector(token), combinator: pendingCombinator });
      pendingCombinator = "descendant";
    });
    return steps;
  }

  const steps = tokenizeSelector(trimmed);
  if (steps.length === 0) return [];

  const lastCompound = steps[steps.length - 1].compound;
  const descendants = collectDescendants(contextEl, []);
  const candidates = descendants.filter((el) => matchesCompound(el, lastCompound));

  if (steps.length === 1) return candidates;

  return candidates.filter((candidate) => {
    let node = candidate;
    for (let i = steps.length - 2; i >= 0; i--) {
      const combinatorToPrevStep = steps[i + 1].combinator;
      if (combinatorToPrevStep === "child") {
        node = node.parentElement;
        if (!node) return false;
        if (!matchesCompound(node, steps[i].compound)) return false;
      } else {
        // 자손(descendant) 결합자: 조상 중 하나만 이 compound와 일치하면 된다.
        let found = null;
        let cur = node.parentElement;
        while (cur) {
          if (matchesCompound(cur, steps[i].compound)) {
            found = cur;
            break;
          }
          cur = cur.parentElement;
        }
        if (!found) return false;
        node = found;
      }
    }
    return true;
  });
}

module.exports = {
  FakeElement,
  FakeDocument,
  fireListeners,
  makeEventTarget,
  normalizeListenerOptions,
};
