import { NextResponse, type NextRequest } from "next/server";

/**
 * 모든 요청이 거치는 서버 측 관문입니다 (Next.js 16 에서는 middleware 대신 proxy 라고 부릅니다).
 * 1단계: 요청마다 새 nonce 를 만들어 Content-Security-Policy 헤더를 붙입니다.
 * 2단계(예정): Databricks Apps 사용자 헤더 검사(로그인/권한).
 */
export function proxy(request: NextRequest): NextResponse {
  // 난수는 Web Crypto 를 사용합니다 (Math.random 금지).
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";

  const csp = [
    "default-src 'self'",
    // 개발 서버(HMR)는 eval 이 필요하므로 개발 모드에서만 허용합니다.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // 요청 헤더에도 넣어야 Next.js 가 자체 스크립트에 같은 nonce 를 붙입니다.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // 정적 파일·이미지에는 적용하지 않습니다.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
