import type { NextConfig } from "next";

// 공통 보안 헤더. Content-Security-Policy 는 요청마다 nonce 가 필요하므로 proxy.ts 에서 설정합니다.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  // 응답 헤더에서 서버 종류(Next.js) 노출 제거
  poweredByHeader: false,
  // 서버 전용 패키지는 번들에 포함하지 않고 Node.js 에서 직접 로드 (클라이언트 번들 유출 방지)
  serverExternalPackages: ["@databricks/sql"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
