// 라우트 핸들러가 LicenseRepository 구현체를 얻는 단일 지점.
// 자동 테스트는 env.__testRepo에 메모리 구현을 주입해 D1/Miniflare 없이 라우트 로직을
// 그대로 실행한다. 운영 환경에서는 env.__testRepo가 없으므로 항상 실제 D1(env.DB)을 쓴다.
import { createD1Repository } from "./d1Repository.js";

export function getRepo(env) {
  if (env.__testRepo) return env.__testRepo;
  if (!env.DB) throw new Error("D1 바인딩(env.DB)이 설정되지 않았습니다. wrangler.toml의 d1_databases를 확인하세요.");
  return createD1Repository(env.DB);
}
