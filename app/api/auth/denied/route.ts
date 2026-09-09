import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { clientIpFromHeaders } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * proxy.ts 가 로그인 헤더 없는 요청을 이곳으로 넘깁니다.
 * 감사 로그(LOGIN_DENIED)를 남기고 401 을 돌려줍니다.
 */
async function deny(request: Request): Promise<NextResponse> {
  await recordAudit({
    actorEmail: "anonymous",
    action: "LOGIN_DENIED",
    detail: { path: new URL(request.url).pathname, method: request.method },
    ipAddress: clientIpFromHeaders(request.headers),
  });
  return NextResponse.json(
    { error: "로그인 정보가 없습니다. Databricks 에 로그인한 뒤 앱 주소로 접속하세요." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = deny;
export const POST = deny;
export const PUT = deny;
export const PATCH = deny;
export const DELETE = deny;
