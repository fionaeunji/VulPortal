import type { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, jsonOk, parseJsonBody, toErrorResponse } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { clientIpFromHeaders, requireUser } from "@/lib/auth";
import { getAssetVuln, statusChangeSchema, updateAssetVulnStatus } from "@/lib/asset-vulns";

export const dynamic = "force-dynamic";

const idSchema = z.uuid();
type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/asset-vulns/:id/status — 상태 변경 + 비고
 * - 로그인 사용자: 미조치 / 진행중 / 완료 / 위험수용
 * - 관리자만: "해당 없음"(NOT_APPLICABLE) 으로 제외하거나 되돌리기
 * - 모든 변경은 감사 로그(STATUS_CHANGE)에 이전/이후 상태와 함께 기록
 */
export async function PUT(request: Request, ctx: Ctx): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!idSchema.safeParse(id).success) throw new ApiError(400, "ID 형식 오류");
    const input = await parseJsonBody(request, statusChangeSchema);

    const before = await getAssetVuln(id);
    if (!before) throw new ApiError(404, "대상을 찾을 수 없습니다");

    const touchesNotApplicable = input.status === "NOT_APPLICABLE" || before.status === "NOT_APPLICABLE";
    if (touchesNotApplicable && user.role !== "ADMIN") {
      throw new ApiError(403, "'해당 없음' 처리와 되돌리기는 관리자만 할 수 있습니다");
    }

    await updateAssetVulnStatus(id, input, user.email);
    await recordAudit({
      actorEmail: user.email,
      action: "STATUS_CHANGE",
      targetType: "ASSET_VULNERABILITY",
      targetId: id,
      detail: {
        assetName: before.assetName,
        cveId: before.cveId,
        from: before.status,
        to: input.status,
        note: input.note ?? null,
      },
      ipAddress: clientIpFromHeaders(request.headers),
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err, "PUT /api/asset-vulns/:id/status");
  }
}
