import type { NextResponse } from "next/server";
import { ApiError, jsonOk, parseJsonBody, toErrorResponse } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { clientIpFromHeaders, requireAdmin } from "@/lib/auth";
import { countActiveAdmins, listUsers, upsertUser, upsertUserSchema } from "@/lib/users";

export const dynamic = "force-dynamic";

/** GET /api/users — 사용자 목록 (관리자 전용) */
export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin();
    return jsonOk({ users: await listUsers() });
  } catch (err) {
    return toErrorResponse(err, "GET /api/users");
  }
}

/** PUT /api/users — 사용자 추가 또는 권한/활성 변경 (관리자 전용) */
export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    const input = await parseJsonBody(request, upsertUserSchema);

    // 마지막 관리자가 스스로를 강등/비활성화해 관리자가 0명이 되는 것을 막습니다.
    const losesAdmin = input.role !== "ADMIN" || !input.isActive;
    if (losesAdmin && input.email === admin.email && (await countActiveAdmins()) <= 1) {
      throw new ApiError(400, "마지막 관리자는 권한을 낮추거나 비활성화할 수 없습니다");
    }

    await upsertUser(input, admin.email);
    await recordAudit({
      actorEmail: admin.email,
      action: "USER_CHANGE",
      targetType: "USER",
      targetId: input.email,
      detail: { role: input.role, isActive: input.isActive },
      ipAddress: clientIpFromHeaders(request.headers),
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err, "PUT /api/users");
  }
}
