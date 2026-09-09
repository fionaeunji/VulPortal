import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  createCsrfToken,
  csrfTokensMatch,
  isStateChangingMethod,
  isValidTokenFormat,
} from "@/lib/csrf";

/**
 * 모든 요청이 거치는 서버 측 관문입니다 (Next.js 16 에서는 middleware 대신 proxy 라고 부릅니다).
 * 1. 로그인 확인: Databricks Apps 가 붙여 주는 X-Forwarded-Email 헤더가 없으면 401.
 *    (로컬 개발에서는 DEV_USER_EMAIL 이 있으면 통과)
 * 2. CSRF 확인: POST/PUT/PATCH/DELETE 는 쿠키 토큰과 헤더 토큰이 같아야 통과, 아니면 403.
 * 3. 보안 헤더: 요청마다 새 nonce 로 Content-Security-Policy 를 붙입니다.
 *
 * DB 는 여기서 쓰지 않습니다. 권한(관리자/조회자)은 각 API 핸들러가 users 테이블로 확인합니다.
 */

const HEADER_EMAIL = "x-forwarded-email";
/** 로그인 없이 허용하는 경로 (상태 확인용) */
const PUBLIC_PATHS = new Set<string>(["/api/health", "/api/auth/denied"]);

function buildCsp(nonce: string, isDev: boolean): string {
  return [
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
}

function isLoggedIn(request: NextRequest, isDev: boolean): boolean {
  const email = request.headers.get(HEADER_EMAIL)?.trim() ?? "";
  if (email.length > 0) return true;
  // 로컬 개발 전용 대체 (운영 빌드에서는 NODE_ENV=production 이므로 절대 통과하지 않음)
  return isDev && Boolean(process.env.DEV_USER_EMAIL);
}

export function proxy(request: NextRequest): NextResponse {
  const isDev = process.env.NODE_ENV !== "production";
  const { pathname } = request.nextUrl;

  // 1. 로그인 확인
  if (!PUBLIC_PATHS.has(pathname) && !isLoggedIn(request, isDev)) {
    // 감사 로그(LOGIN_DENIED)를 남기기 위해 내부 경로로 넘깁니다. 응답은 401 입니다.
    return NextResponse.rewrite(new URL("/api/auth/denied", request.url));
  }

  // 2. CSRF 확인 (상태 변경 요청만)
  const cookieToken = request.cookies.get(CSRF_COOKIE)?.value;
  if (isStateChangingMethod(request.method)) {
    const headerToken = request.headers.get(CSRF_HEADER);
    const fetchSite = request.headers.get("sec-fetch-site");
    const crossSite = fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none";
    if (crossSite || !csrfTokensMatch(cookieToken, headerToken)) {
      return NextResponse.json({ error: "요청 검증에 실패했습니다. 페이지를 새로 고친 뒤 다시 시도하세요." }, { status: 403 });
    }
  }

  // 3. 보안 헤더 + CSRF 쿠키 발급
  const nonce = Buffer.from(randomUUID()).toString("base64");
  const csp = buildCsp(nonce, isDev);
  const csrfToken = isValidTokenFormat(cookieToken) ? cookieToken : createCsrfToken();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // 요청 헤더에도 넣어야 Next.js 가 자체 스크립트에 같은 nonce 를 붙입니다.
  requestHeaders.set("Content-Security-Policy", csp);
  // 레이아웃이 <meta name="csrf-token"> 에 넣을 수 있도록 요청 헤더로 전달합니다.
  requestHeaders.set(CSRF_HEADER, csrfToken);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  if (csrfToken !== cookieToken) {
    response.cookies.set(CSRF_COOKIE, csrfToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: !isDev,
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  }
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
