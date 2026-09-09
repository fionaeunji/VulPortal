import type { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, jsonOk, parseJsonBody, toErrorResponse } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { clientIpFromHeaders, requireAdmin, requireUser } from "@/lib/auth";
import { assetInputSchema, deleteAsset, getAsset, updateAsset } from "@/lib/assets";

export const dynamic = "force-dynamic";

const idSchema = z.uuid("자산 ID 형식 오류");
type Ctx = { params: Promise<{ id: string }> };

async function parseId(ctx: Ctx): Promise<string> {
  const { id } = await ctx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new ApiError(400, "자산 ID 형식 오류");
  return parsed.data;
}

/** GET /api/assets/:id — 자산 1건 */
export async function GET(_request: Request, ctx: Ctx): Promise<NextResponse> {
  try {
    await requireUser();
    const id = await parseId(ctx);
    const asset = await getAsset(id);
    if (!asset) throw new ApiError(404, "자산을 찾을 수 없습니다");
    return jsonOk({ asset });
  } catch (err) {
    return toErrorResponse(err, "GET /api/assets/:id");
  }
}

/** PUT /api/assets/:id — 개별 수정 (관리자 전용) */
export async function PUT(request: Request, ctx: Ctx): Promise<NextResponse> {
  try {
    const user = await requireAdmin();
    const id = await parseId(ctx);
    const input = await parseJsonBody(request, assetInputSchema);
    const ok = await updateAsset(id, input);
    if (!ok) throw new ApiError(404, "자산을 찾을 수 없습니다");
    await recordAudit({
      actorEmail: user.email,
      action: "ASSET_UPSERT",
      targetType: "ASSET",
      targetId: id,
      detail: { assetName: input.assetName, via: "edit" },
      ipAddress: clientIpFromHeaders(request.headers),
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err, "PUT /api/assets/:id");
  }
}

/** DELETE /api/assets/:id — 삭제 (관리자 전용, 감사 로그 기록) */
export async function DELETE(request: Request, ctx: Ctx): Promise<NextResponse> {
  try {
    const user = await requireAdmin();
    const id = await parseId(ctx);
    const before = await getAsset(id);
    if (!before) throw new ApiError(404, "자산을 찾을 수 없습니다");
    await deleteAsset(id);
    await recordAudit({
      actorEmail: user.email,
      action: "ASSET_DELETE",
      targetType: "ASSET",
      targetId: id,
      detail: { assetName: before.assetName },
      ipAddress: clientIpFromHeaders(request.headers),
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err, "DELETE /api/assets/:id");
  }
}
