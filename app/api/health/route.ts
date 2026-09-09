import { NextResponse } from "next/server";
import { ping } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 * 앱과 DB 연결 상태를 알려줍니다. 오류 내용(SQL, 경로, 스택)은 절대 응답에 넣지 않습니다.
 */
export async function GET(): Promise<NextResponse> {
  const dbOk = await ping();
  return NextResponse.json(
    {
      app: "ok",
      db: dbOk ? "ok" : "error",
      checkedAt: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
