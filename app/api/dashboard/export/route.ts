import { NextResponse } from "next/server";
import { z } from "zod";
import { parseSearchParams, toErrorResponse } from "@/lib/api";
import { exposureLabel } from "@/lib/asset-rules";
import { requireUser } from "@/lib/auth";
import { getAssetStatus, getEmergencyList, getSeverityDistribution, getSummary, getSyncStatus } from "@/lib/dashboard";
import { buildWorkbook, xlsxHeaders, type SheetSpec } from "@/lib/export";
import { formatDateKst, formatDateTimeKst } from "@/lib/format";
import { remainingDays, severityLabel, statusLabel } from "@/lib/vuln-rules";

export const dynamic = "force-dynamic";

const PARTS = ["summary", "severity", "emergency", "assets", "sync", "all"] as const;
const querySchema = z.object({ part: z.enum(PARTS).default("all") });

/** 파일명은 코드에 고정 (사용자 입력으로 만들지 않음) */
const FILE_NAMES = new Map<string, [string, string]>([
  ["summary", ["dashboard_summary.xlsx", "대시보드_요약.xlsx"]],
  ["severity", ["dashboard_severity.xlsx", "위험도별_분포.xlsx"]],
  ["emergency", ["dashboard_emergency.xlsx", "긴급_조치_대상.xlsx"]],
  ["assets", ["dashboard_assets.xlsx", "자산별_취약점_현황.xlsx"]],
  ["sync", ["dashboard_sync.xlsx", "최근_수집_상태.xlsx"]],
  ["all", ["dashboard_all.xlsx", "대시보드_전체.xlsx"]],
]);

async function summarySheet(): Promise<SheetSpec> {
  const s = await getSummary();
  return {
    name: "요약",
    headers: ["항목", "값"],
    rows: [
      ["기준 시각(KST)", formatDateTimeKst(new Date())],
      ["총 취약점 건수", s.total],
      ["긴급 취약점 건수(미조치)", s.emergencyOpen],
      ["조치율(%)", s.completionRate ?? "-"],
      ["기한 초과 건수", s.overdue],
      ["완료 건수", s.done],
      ["위험수용 건수", s.riskAccepted],
    ],
  };
}

async function severitySheet(): Promise<SheetSpec> {
  const rows = await getSeverityDistribution();
  return {
    name: "위험도별 분포",
    headers: ["위험도", "미조치", "완료", "전체"],
    rows: rows.map((r) => [severityLabel(r.severity), r.open, r.done, r.total]),
  };
}

async function emergencySheet(): Promise<SheetSpec> {
  const now = new Date();
  const rows = await getEmergencyList(null);
  return {
    name: "긴급 조치 대상",
    headers: ["자산명", "노출구분", "CVE", "CVSS", "EPSS", "KEV", "기한", "남은 일수", "상태", "담당자", "담당부서"],
    rows: rows.map((r) => [
      r.assetName,
      exposureLabel(r.exposure),
      r.cveId,
      r.cvssScore,
      r.epssScore,
      r.isKev ? "예" : "아니오",
      formatDateKst(r.dueDate),
      remainingDays(r.dueDate, now),
      statusLabel(r.status),
      r.owner,
      r.department,
    ]),
  };
}

async function assetsSheet(): Promise<SheetSpec> {
  const rows = await getAssetStatus(null);
  return {
    name: "자산별 현황",
    headers: ["자산명", "자산유형", "노출구분", "긴급", "우선", "주의", "전체", "완료", "위험수용", "기한 초과", "조치율(%)", "담당자", "담당부서"],
    rows: rows.map((r) => [
      r.assetName,
      r.assetType,
      exposureLabel(r.exposure),
      r.emergency,
      r.priority,
      r.caution,
      r.total,
      r.done,
      r.riskAccepted,
      r.overdue,
      r.completionRate ?? "-",
      r.owner,
      r.department,
    ]),
  };
}

async function syncSheet(): Promise<SheetSpec> {
  const s = await getSyncStatus();
  const rows = s.latest ? [s.latest, ...s.steps] : [];
  return {
    name: "최근 수집 상태",
    headers: ["단계", "상태", "시작(KST)", "종료(KST)", "처리 건수", "실행 주체", "오류"],
    rows: rows.map((l) => [
      l.source,
      l.status,
      formatDateTimeKst(l.startedAt),
      formatDateTimeKst(l.finishedAt),
      l.processedCount,
      l.triggeredBy,
      l.errorMessage,
    ]),
  };
}

/** GET /api/dashboard/export?part=summary|severity|emergency|assets|sync|all */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireUser();
    const { part } = parseSearchParams(new URL(request.url), querySchema);
    const sheets: SheetSpec[] = [];
    if (part === "summary" || part === "all") sheets.push(await summarySheet());
    if (part === "severity" || part === "all") sheets.push(await severitySheet());
    if (part === "emergency" || part === "all") sheets.push(await emergencySheet());
    if (part === "assets" || part === "all") sheets.push(await assetsSheet());
    if (part === "sync" || part === "all") sheets.push(await syncSheet());
    const buffer = await buildWorkbook(sheets);
    const [ascii, korean] = FILE_NAMES.get(part) ?? ["dashboard.xlsx", "대시보드.xlsx"];
    return new NextResponse(new Uint8Array(buffer), { status: 200, headers: xlsxHeaders(ascii, korean) });
  } catch (err) {
    return toErrorResponse(err, "GET /api/dashboard/export");
  }
}
