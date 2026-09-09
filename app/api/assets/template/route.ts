import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { buildAssetTemplate } from "@/lib/excel";

export const dynamic = "force-dynamic";

/** GET /api/assets/template — 자산 업로드 템플릿(.xlsx) 다운로드. 파일명은 코드에 고정. */
export async function GET(): Promise<NextResponse> {
  try {
    await requireUser();
    const buffer = await buildAssetTemplate();
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="asset_template.xlsx"; filename*=UTF-8''${encodeURIComponent("자산_업로드_템플릿.xlsx")}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return toErrorResponse(err, "GET /api/assets/template");
  }
}
