// LicenseProvider 팩토리. 환경 변수 LICENSE_PROVIDER("mock" | "lemonsqueezy")로 고른다.
// production 환경에서 mock을 요청하면 즉시 에러를 던져 요청 자체를 처리하지 않는다 —
// "production에서는 Mock provider 사용 시 서버 시작 또는 빌드 실패" 요구 사항을 만족한다.
import { createMockLicenseProvider } from "./MockLicenseProvider.js";
import { createLemonSqueezyLicenseProvider } from "./LemonSqueezyLicenseProvider.js";

export function createLicenseProvider(env) {
  const providerName = (env.LICENSE_PROVIDER || "lemonsqueezy").toLowerCase();

  if (providerName === "mock") {
    if (env.ENVIRONMENT === "production") {
      throw new Error("MockLicenseProvider는 production 환경(ENVIRONMENT=production)에서 사용할 수 없습니다.");
    }
    return createMockLicenseProvider();
  }

  return createLemonSqueezyLicenseProvider(env);
}
