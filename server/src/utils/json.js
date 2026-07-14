// 표준 Response만 사용하는 최소 JSON 응답 헬퍼. 무거운 프레임워크를 쓰지 않는다.

export function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

// 요청 body를 JSON으로 안전하게 파싱한다. 실패해도 예외를 던지지 않고 null을 돌려준다.
export async function parseJsonSafely(request) {
  try {
    return await request.json();
  } catch (err) {
    return null;
  }
}

// 필수 문자열 필드가 모두 존재하는지 확인한다. 개인정보나 원본 값을 포함하지 않는
// 필드 이름 목록만 오류로 돌려준다.
export function requireStringFields(body, fieldNames) {
  const missing = [];
  fieldNames.forEach((name) => {
    if (!body || typeof body[name] !== "string" || body[name].trim() === "") {
      missing.push(name);
    }
  });
  return missing;
}
