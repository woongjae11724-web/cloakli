// SHA-256/HMAC 유틸리티. Cloudflare Workers와 Node(18+) 양쪽에 존재하는 표준 Web Crypto
// API(`crypto.subtle`)만 사용하므로, 이 서버 코드는 두 환경 모두에서 그대로 동작한다.

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 라이선스 키, installation ID 등 "원문을 저장하지 않고 식별만 하면 되는 값"을 해시한다.
export async function sha256Hex(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(digest);
}

// 두 16진수 문자열을 길이 유출 없이(같은 길이일 때) 상수 시간에 비교한다.
// 서명/토큰 비교에 사용하며, 문자열 조기 종료(===)로 인한 타이밍 사이드채널을 피한다.
export function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Lemon Squeezy webhook은 원문 body에 대한 HMAC-SHA256 서명을 16진수로 보낸다(X-Signature).
export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bufferToHex(mac);
}

// 세션 토큰: 32바이트(256비트) 암호학적 난수를 base64url로 인코딩한다.
export function generateSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 안전한 무작위 id(라이선스/instance/webhook 이벤트 row의 기본키로 사용).
export function generateId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
