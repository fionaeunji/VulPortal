import { NextResponse } from "next/server";
import { parseSearchParams, toErrorResponse } from "@/lib/api";
import { exposureLabel } from "@/lib/asset-rules";
import { listAssetVulnsForExport, vulnListQuerySchema } from "@/lib/asset-vulns";
import { requireUser } from "@/lib/auth";
import { buildWorkbook, xlsxHeaders } from "@/lib/export";
import { formatDateKst } from "@/lib/format";
import { MATCH_METHOD_LABEL, remainingDays, severityLabel, statusLabel } from "@/lib/vuln-rules";

export const dynamic = "force-dynamic";

/** GET /api/asset-vulns/export?…필터 — 현재 필터 조건의 목록 전체를 xlsx 로 내려받습니다. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireUser();
    const q = parseSearchParams(new URL(request.url), vulnListQuerySchema);
    const rows = await listAssetVulnsForExport(q);
    const now = new Date();
    const buffer = await buildWorkbook([
      {
        name: "자산-취약점",
        headers: [
          "자산명", "자산유형", "노출구분", "담당자", "담당부서", "CVE", "위험도", "매칭", "CVSS", "EPSS(현재)", "EPSS(초기)",
          "KEV", "탐지일", "기한", "남은 일수", "상태", "완료일", "비고", "마지막 변경자",
        ],
        rows: rows.map((r) => [
          r.assetName,
          r.assetType,
          exposureLabel(r.exposure),
          r.owner,
          r.department,
          r.cveId,
          severityLabel(r.severity),
          r.matchMethod === "FUZZY" ? MATCH_METHOD_LABEL.FUZZY : MATCH_METHOD_LABEL.CPE,
          r.cvssScore,
          r.epssScore,
          r.epssInitial,
          r.isKev ? "예" : "아니오",
          formatDateKst(r.detectedAt),
          formatDateKst(r.dueDate),
          remainingDays(r.dueDate, now),
          statusLabel(r.status),
          formatDateKst(r.completedAt),
          r.note,
          r.updatedBy,
        ]),
      },
    ]);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: xlsxHeaders("asset_vulnerabilities.xlsx", "자산_취약점_목록.xlsx"),
    });
  } catch (err) {
    return toErrorResponse(err, "GET /api/asset-vulns/export");
  }
}
