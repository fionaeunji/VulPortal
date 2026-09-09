import type { NextResponse } from "next/server";
import { jsonOk, toErrorResponse } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { listSyncLogs } from "@/lib/sync";

export const dynamic = "force-dynamic";

/** GET /api/sync/logs — 수집 이력 최근 100건 (관리자 전용) */
export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin();
    return jsonOk({ logs: await listSyncLogs(100) });
  } catch (err) {
    return toErrorResponse(err, "GET /api/sync/logs");
  }
}
