import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex, hmacSha256Hex, timingSafeEqualHex, generateSessionToken, generateId } from "../src/utils/hash.js";

describe("sha256Hex", () => {
  test("같은 입력은 항상 같은 해시를 만든다", async () => {
    const a = await sha256Hex("CLOAKLI-TEST-PRO");
    const b = await sha256Hex("CLOAKLI-TEST-PRO");
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  test("다른 입력은 다른 해시를 만든다", async () => {
    const a = await sha256Hex("key-a");
    const b = await sha256Hex("key-b");
    assert.notEqual(a, b);
  });
});

describe("hmacSha256Hex / timingSafeEqualHex", () => {
  test("올바른 secret으로 계산한 서명은 검증을 통과한다", async () => {
    const sig = await hmacSha256Hex("secret", "raw-body");
    const expected = await hmacSha256Hex("secret", "raw-body");
    assert.equal(timingSafeEqualHex(sig, expected), true);
  });

  test("잘못된 secret으로 계산한 서명은 검증에 실패한다", async () => {
    const sig = await hmacSha256Hex("secret", "raw-body");
    const wrong = await hmacSha256Hex("other-secret", "raw-body");
    assert.equal(timingSafeEqualHex(sig, wrong), false);
  });

  test("길이가 다른 문자열은 항상 false다", () => {
    assert.equal(timingSafeEqualHex("abc", "abcd"), false);
  });

  test("문자열이 아닌 값은 항상 false다", () => {
    assert.equal(timingSafeEqualHex(null, "abc"), false);
    assert.equal(timingSafeEqualHex(undefined, undefined), false);
  });
});

describe("generateSessionToken / generateId", () => {
  test("세션 토큰은 매번 다르고 충분히 길다", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    assert.notEqual(a, b);
    assert.ok(a.length >= 32);
  });

  test("id는 매번 다르다", () => {
    const a = generateId();
    const b = generateId();
    assert.notEqual(a, b);
  });
});
