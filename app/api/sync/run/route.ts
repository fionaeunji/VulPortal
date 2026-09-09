import type { NextResponse } from "next/server";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { clientIpFromHeaders, requireAdmin } from "@/lib/auth";
import { isSyncJobConfigured, runSyncJobNow } from "@/lib/databricks-jobs";
import { findRunningSync, recordQueuedRun } from "@/lib/sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/sync/run — 수집 Job 즉시 실행 (관리자 전용)
 * 이미 실행 중이면 409. 실행 요청은 감사 로그(SYNC_RUN)에 기록합니다.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = await requireAdmin();
    if (!isSyncJobConfigured()) throw new ApiError(503, "수집 Job 이 설정되지 않았습니다 (SYNC_JOB_ID)");
    const running = await findRunningSync();
    if (running) throw new ApiError(409, "수집이 이미 실행 중입니다. 끝난 뒤 다시 시도하세요");

    const { runId } = await runSyncJobNow(user.email);
    await recordQueuedRun(runId, user.email);
    await recordAudit({
      actorEmail: user.email,
      action: "SYNC_RUN",
      targetType: "SYNC",
      targetId: runId,
      ipAddress: clientIpFromHeaders(request.headers),
    });
    return jsonOk({ ok: true, runId }, 202);
  } catch (err) {
    return toErrorResponse(err, "POST /api/sync/run");
  }
}
