import type { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { clientIpFromHeaders, requireAdmin } from "@/lib/auth";
import { replaceAllAssets, upsertAssets } from "@/lib/assets";
import { parseAssetWorkbook, validateUploadFile, MAX_FILE_BYTES } from "@/lib/excel";

export const dynamic = "force-dynamic";

const modeSchema = z.enum(["preview", "upsert", "replace"]);

/**
 * POST /api/assets/upload  (multipart/form-data: file, mode)
 * - mode=preview : 검증 결과만 돌려주고 DB 에 쓰지 않음
 * - mode=upsert  : 자산명 기준 추가/갱신
 * - mode=replace : 전체 교체
 * 오류 행이 하나라도 있으면 저장하지 않습니다. 파일은 메모리에서만 처리하고 저장하지 않습니다.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = await requireAdmin();
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_FILE_BYTES + 64 * 1024) throw new ApiError(413, "파일 크기는 10MB 이하여야 합니다");

    const form = await request.formData();
    const mode = modeSchema.safeParse(form.get("mode"));
    if (!mode.success) throw new ApiError(400, "처리 방식(mode)이 올바르지 않습니다");
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "파일이 없습니다");
    const fileError = validateUploadFile(file);
    if (fileError) throw new ApiError(400, fileError);

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseAssetWorkbook(buffer);

    const preview = {
      totalRows: parsed.totalRows,
      validRows: parsed.rows.length,
      errors: parsed.errors,
      skippedSheets: parsed.skippedSheets,
      generatedCpeCount: parsed.rows.filter((r) => r.cpeGenerated).length,
      sample: parsed.rows
        .slice(0, 20)
        .map((r) => ({ sheet: r.sheet, row: r.row, ...r.input, cpeGenerated: r.cpeGenerated })),
    };

    if (mode.data === "preview") return jsonOk({ mode: "preview", ...preview });
    if (parsed.errors.length > 0) {
      throw new ApiError(400, `오류 행이 ${parsed.errors.length}건 있어 저장하지 않았습니다. 수정 후 다시 올려 주세요`);
    }
    if (parsed.rows.length === 0) throw new ApiError(400, "저장할 행이 없습니다");

    const inputs = parsed.rows.map((r) => r.input);
    const ip = clientIpFromHeaders(request.headers);
    if (mode.data === "replace") {
      const result = await replaceAllAssets(inputs);
      await recordAudit({
        actorEmail: user.email,
        action: "ASSET_REPLACE_ALL",
        targetType: "ASSET",
        detail: { inserted: result.inserted, fileName: file.name.slice(0, 100) },
        ipAddress: ip,
      });
      return jsonOk({ mode: "replace", saved: result.inserted, ...preview });
    }
    const result = await upsertAssets(inputs);
    await recordAudit({
      actorEmail: user.email,
      action: "ASSET_UPSERT",
      targetType: "ASSET",
      detail: { affected: result.affected, fileName: file.name.slice(0, 100) },
      ipAddress: ip,
    });
    return jsonOk({ mode: "upsert", saved: result.affected, ...preview });
  } catch (err) {
    return toErrorResponse(err, "POST /api/assets/upload");
  }
}
