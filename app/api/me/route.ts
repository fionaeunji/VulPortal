import type { NextResponse } from "next/server";
import { jsonOk, toErrorResponse } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/me — 현재 로그인 사용자와 권한 (필요한 필드만 반환) */
export async function GET(): Promise<NextResponse> {
  try {
    const user = await requireUser();
    return jsonOk({ email: user.email, displayName: user.displayName, role: user.role, registered: user.registered });
  } catch (err) {
    return toErrorResponse(err, "GET /api/me");
  }
}
