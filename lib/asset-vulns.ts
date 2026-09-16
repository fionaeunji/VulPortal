import "server-only";
import { z } from "zod";
import { EXPOSURES } from "@/lib/asset-rules";
import { query, queryOne, type SqlParams } from "@/lib/db";
import { toDate } from "@/lib/format";
import { SEVERITIES, STATUSES } from "@/lib/vuln-rules";

/** 자산-취약점 매칭 결과 조회 */

export interface AssetVulnRecord {
  id: string;
  assetId: string;
  assetName: string;
  assetType: string;
  exposure: string;
  owner: string | null;
  department: string | null;
  cveId: string;
  severity: string;
  matchMethod: string;
  cvssScore: number | null;
  epssScore: number | null;
  epssInitial: number | null;
  isKev: boolean;
  detectedAt: Date | null;
  dueDate: Date | null;
  status: string;
  completedAt: Date | null;
  note: string | null;
  updatedBy: string | null;
}

interface AssetVulnRow {
  id: string;
  asset_id: string;
  asset_name: string;
  asset_type: string;
  exposure: string;
  owner: string | null;
  department: string | null;
  cve_id: string;
  severity: string;
  match_method: string;
  cvss_score: number | null;
  epss_score: number | null;
  epss_initial: number | null;
  is_kev: boolean;
  detected_at: unknown;
  due_date: unknown;
  status: string;
  completed_at: unknown;
  note: string | null;
  updated_by: string | null;
}

const SELECT = `SELECT av.id, av.asset_id, a.asset_name, a.asset_type, a.exposure, a.owner, a.department,
  av.cve_id, av.severity, av.match_method, v.cvss_score, v.epss_score, v.epss_initial, v.is_kev,
  av.detected_at, av.due_date, av.status, av.completed_at, av.note, av.updated_by
  FROM asset_vulnerabilities av
  JOIN assets a ON a.id = av.asset_id
  LEFT JOIN vulnerabilities v ON v.cve_id = av.cve_id`;

function toRecord(r: AssetVulnRow): AssetVulnRecord {
  return {
    id: r.id,
    assetId: r.asset_id,
    assetName: r.asset_name,
    assetType: r.asset_type,
    exposure: r.exposure,
    owner: r.owner,
    department: r.department,
    cveId: r.cve_id,
    severity: r.severity,
    matchMethod: r.match_method,
    cvssScore: r.cvss_score === null ? null : Number(r.cvss_score),
    epssScore: r.epss_score === null ? null : Number(r.epss_score),
    epssInitial: r.epss_initial === null ? null : Number(r.epss_initial),
    isKev: Boolean(r.is_kev),
    detectedAt: toDate(r.detected_at),
    dueDate: toDate(r.due_date),
    status: r.status,
    completedAt: toDate(r.completed_at),
    note: r.note,
    updatedBy: r.updated_by,
  };
}

/** 정렬 허용 목록 */
const SORTABLE = new Map<string, string>([
  ["dueDate", "av.due_date"],
  ["severity", "av.severity"],
  ["assetName", "a.asset_name"],
  ["cveId", "av.cve_id"],
  ["cvssScore", "v.cvss_score"],
  ["detectedAt", "av.detected_at"],
  ["status", "av.status"],
]);

export const vulnListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(STATUSES).optional(),
  exposure: z.enum(EXPOSURES).optional(),
  department: z.string().trim().max(100).optional(),
  overdue: z.enum(["1"]).optional(),
  sort: z.enum([...SORTABLE.keys()] as [string, ...string[]]).default("dueDate"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type VulnListQuery = z.infer<typeof vulnListQuerySchema>;

function buildWhere(q: VulnListQuery): { sql: string; params: SqlParams } {
  const where: string[] = [];
  const params: SqlParams = {};
  if (q.q) {
    where.push("(lower(a.asset_name) LIKE :kw OR lower(av.cve_id) LIKE :kw OR lower(a.owner) LIKE :kw)");
    params.kw = `%${q.q.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`;
  }
  if (q.severity) {
    where.push("av.severity = :severity");
    params.severity = q.severity;
  }
  if (q.status) {
    where.push("av.status = :status");
    params.status = q.status;
  }
  if (q.exposure) {
    where.push("a.exposure = :exposure");
    params.exposure = q.exposure;
  }
  if (q.department) {
    where.push("a.department = :department");
    params.department = q.department;
  }
  if (q.overdue) {
    where.push("av.status IN ('OPEN', 'IN_PROGRESS') AND av.due_date < current_timestamp()");
  }
  return { sql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "", params };
}

export async function listAssetVulns(q: VulnListQuery): Promise<{ items: AssetVulnRecord[]; total: number }> {
  const { sql: whereSql, params } = buildWhere(q);
  const sortColumn = SORTABLE.get(q.sort) ?? "av.due_date";
  const direction = q.order === "desc" ? "DESC" : "ASC";
  const countRow = await queryOne<{ cnt: number | bigint }>(
    `SELECT COUNT(*) AS cnt FROM asset_vulnerabilities av JOIN assets a ON a.id = av.asset_id ${whereSql}`,
    params,
  );
  const rows = await query<AssetVulnRow>(
    `${SELECT} ${whereSql} ORDER BY ${sortColumn} ${direction}, av.cve_id ASC LIMIT :limit OFFSET :offset`,
    { ...params, limit: q.pageSize, offset: (q.page - 1) * q.pageSize },
  );
  return { items: rows.map(toRecord), total: Number(countRow?.cnt ?? 0) };
}

export async function getAssetVuln(id: string): Promise<AssetVulnRecord | null> {
  const row = await queryOne<AssetVulnRow>(`${SELECT} WHERE av.id = :id`, { id });
  return row ? toRecord(row) : null;
}

/** 필터용 담당부서 목록 */
export async function listDepartments(): Promise<string[]> {
  const rows = await query<{ department: string }>(
    "SELECT DISTINCT department FROM assets WHERE department IS NOT NULL ORDER BY department",
  );
  return rows.map((r) => r.department);
}
