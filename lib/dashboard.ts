import "server-only";
import { query, queryOne } from "@/lib/db";
import { toDate } from "@/lib/format";
import { latestSyncRun, listSyncLogs, type SyncLogRecord } from "@/lib/sync";

/**
 * 대시보드 집계 조회.
 * 집계 기준: "해당 없음(NOT_APPLICABLE)" 으로 제외한 건은 모든 집계에서 뺍니다.
 * 조치율 = 완료 ÷ (전체 − 위험수용) × 100
 */

export interface DashboardSummary {
  total: number;
  emergencyOpen: number;
  completionRate: number | null;
  overdue: number;
  done: number;
  riskAccepted: number;
}

interface SummaryRow {
  total: number | bigint;
  emergency_open: number | bigint;
  done: number | bigint;
  risk_accepted: number | bigint;
  overdue: number | bigint;
}

const NOT_EXCLUDED = "av.status <> 'NOT_APPLICABLE'";

/** 완료 ÷ (전체 − 위험수용) × 100, 분모가 0이면 null */
export function completionRate(done: number, total: number, riskAccepted: number): number | null {
  const denominator = total - riskAccepted;
  if (denominator <= 0) return null;
  return Math.round((done / denominator) * 1000) / 10;
}

export async function getSummary(): Promise<DashboardSummary> {
  const row = await queryOne<SummaryRow>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN av.severity = 'EMERGENCY' AND av.status IN ('OPEN','IN_PROGRESS') THEN 1 ELSE 0 END) AS emergency_open,
            SUM(CASE WHEN av.status = 'DONE' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN av.status = 'RISK_ACCEPTED' THEN 1 ELSE 0 END) AS risk_accepted,
            SUM(CASE WHEN av.status IN ('OPEN','IN_PROGRESS') AND av.due_date < current_timestamp() THEN 1 ELSE 0 END) AS overdue
     FROM asset_vulnerabilities av WHERE ${NOT_EXCLUDED}`,
  );
  const total = Number(row?.total ?? 0);
  const done = Number(row?.done ?? 0);
  const riskAccepted = Number(row?.risk_accepted ?? 0);
  return {
    total,
    emergencyOpen: Number(row?.emergency_open ?? 0),
    done,
    riskAccepted,
    completionRate: completionRate(done, total, riskAccepted),
    overdue: Number(row?.overdue ?? 0),
  };
}

export interface SeverityCount {
  severity: string;
  open: number;
  done: number;
  total: number;
}

export async function getSeverityDistribution(): Promise<SeverityCount[]> {
  const rows = await query<{ severity: string; open_cnt: number | bigint; done_cnt: number | bigint; total: number | bigint }>(
    `SELECT av.severity,
            SUM(CASE WHEN av.status IN ('OPEN','IN_PROGRESS') THEN 1 ELSE 0 END) AS open_cnt,
            SUM(CASE WHEN av.status = 'DONE' THEN 1 ELSE 0 END) AS done_cnt,
            COUNT(*) AS total
     FROM asset_vulnerabilities av WHERE ${NOT_EXCLUDED}
     GROUP BY av.severity`,
  );
  const byKey = new Map(rows.map((r) => [r.severity, r]));
  return ["EMERGENCY", "PRIORITY", "CAUTION"].map((severity) => {
    const r = byKey.get(severity);
    return {
      severity,
      open: Number(r?.open_cnt ?? 0),
      done: Number(r?.done_cnt ?? 0),
      total: Number(r?.total ?? 0),
    };
  });
}

export interface EmergencyItem {
  id: string;
  assetName: string;
  exposure: string;
  cveId: string;
  cvssScore: number | null;
  epssScore: number | null;
  isKev: boolean;
  dueDate: Date | null;
  status: string;
  owner: string | null;
  department: string | null;
}

interface EmergencyRow {
  id: string;
  asset_name: string;
  exposure: string;
  cve_id: string;
  cvss_score: number | null;
  epss_score: number | null;
  is_kev: boolean;
  due_date: unknown;
  status: string;
  owner: string | null;
  department: string | null;
}

/** 긴급 조치 대상: 위험도 긴급 + 미조치, 기한 빠른 순 */
export async function getEmergencyList(limit: number | null): Promise<EmergencyItem[]> {
  const rows = await query<EmergencyRow>(
    `SELECT av.id, a.asset_name, a.exposure, av.cve_id, v.cvss_score, v.epss_score, v.is_kev,
            av.due_date, av.status, a.owner, a.department
     FROM asset_vulnerabilities av
     JOIN assets a ON a.id = av.asset_id
     LEFT JOIN vulnerabilities v ON v.cve_id = av.cve_id
     WHERE av.severity = 'EMERGENCY' AND av.status IN ('OPEN','IN_PROGRESS')
     ORDER BY av.due_date ASC, av.cve_id ASC
     ${limit === null ? "" : "LIMIT :limit"}`,
    limit === null ? undefined : { limit },
  );
  return rows.map((r) => ({
    id: r.id,
    assetName: r.asset_name,
    exposure: r.exposure,
    cveId: r.cve_id,
    cvssScore: r.cvss_score === null ? null : Number(r.cvss_score),
    epssScore: r.epss_score === null ? null : Number(r.epss_score),
    isKev: Boolean(r.is_kev),
    dueDate: toDate(r.due_date),
    status: r.status,
    owner: r.owner,
    department: r.department,
  }));
}

export interface AssetStatusItem {
  assetId: string;
  assetName: string;
  assetType: string;
  exposure: string;
  owner: string | null;
  department: string | null;
  emergency: number;
  priority: number;
  caution: number;
  total: number;
  done: number;
  riskAccepted: number;
  overdue: number;
  completionRate: number | null;
}

interface AssetStatusRow {
  asset_id: string;
  asset_name: string;
  asset_type: string;
  exposure: string;
  owner: string | null;
  department: string | null;
  emergency: number | bigint;
  priority: number | bigint;
  caution: number | bigint;
  total: number | bigint;
  done: number | bigint;
  risk_accepted: number | bigint;
  overdue: number | bigint;
}

/** 자산별 취약점 현황: 긴급 건수 많은 순. limit=null 이면 전체(Export 용) */
export async function getAssetStatus(limit: number | null): Promise<AssetStatusItem[]> {
  const rows = await query<AssetStatusRow>(
    `SELECT a.id AS asset_id, a.asset_name, a.asset_type, a.exposure, a.owner, a.department,
            SUM(CASE WHEN av.severity = 'EMERGENCY' THEN 1 ELSE 0 END) AS emergency,
            SUM(CASE WHEN av.severity = 'PRIORITY' THEN 1 ELSE 0 END) AS priority,
            SUM(CASE WHEN av.severity = 'CAUTION' THEN 1 ELSE 0 END) AS caution,
            COUNT(av.id) AS total,
            SUM(CASE WHEN av.status = 'DONE' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN av.status = 'RISK_ACCEPTED' THEN 1 ELSE 0 END) AS risk_accepted,
            SUM(CASE WHEN av.status IN ('OPEN','IN_PROGRESS') AND av.due_date < current_timestamp() THEN 1 ELSE 0 END) AS overdue
     FROM assets a
     LEFT JOIN asset_vulnerabilities av ON av.asset_id = a.id AND ${NOT_EXCLUDED}
     GROUP BY a.id, a.asset_name, a.asset_type, a.exposure, a.owner, a.department
     ORDER BY emergency DESC, priority DESC, caution DESC, a.asset_name ASC
     ${limit === null ? "" : "LIMIT :limit"}`,
    limit === null ? undefined : { limit },
  );
  return rows.map((r) => {
    const total = Number(r.total);
    const done = Number(r.done);
    const riskAccepted = Number(r.risk_accepted);
    return {
      assetId: r.asset_id,
      assetName: r.asset_name,
      assetType: r.asset_type,
      exposure: r.exposure,
      owner: r.owner,
      department: r.department,
      emergency: Number(r.emergency),
      priority: Number(r.priority),
      caution: Number(r.caution),
      total,
      done,
      riskAccepted,
      overdue: Number(r.overdue),
      completionRate: completionRate(done, total, riskAccepted),
    };
  });
}

export interface SyncStatus {
  latest: SyncLogRecord | null;
  steps: SyncLogRecord[];
}

/** 최근 수집 상태: 마지막 전체 실행 + 그 실행의 단계별 결과 */
export async function getSyncStatus(): Promise<SyncStatus> {
  const latest = await latestSyncRun();
  if (!latest) return { latest: null, steps: [] };
  const recent = await listSyncLogs(60);
  const steps = recent.filter((l) => l.runId === latest.runId && l.source !== "ALL");
  return { latest, steps };
}
