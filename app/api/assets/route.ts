import type { NextResponse } from "next/server";
import { jsonOk, parseSearchParams, toErrorResponse } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { listAssets, listQuerySchema } from "@/lib/assets";

export const dynamic = "force-dynamic";

/** GET /api/assets — 자산 목록 (검색·필터·정렬·페이지). 정렬 컬럼은 허용 목록으로 검증. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireUser();
    const q = parseSearchParams(new URL(request.url), listQuerySchema);
    const result = await listAssets(q);
    return jsonOk({ ...result, page: q.page, pageSize: q.pageSize });
  } catch (err) {
    return toErrorResponse(err, "GET /api/assets");
  }
}
