import "server-only";
import { z } from "zod";
import { ASSET_TYPES, EXPOSURES, generateCpe, isValidCpe } from "@/lib/asset-rules";
import { execute, query, queryOne, type SqlParams } from "@/lib/db";

/**
 * 자산 데이터 접근 모듈.
 * - 모든 SQL 은 named parameter 바인딩만 사용합니다.
 * - 정렬 컬럼은 허용 목록(SORTABLE)에서만 고릅니다.
 * - 대량 등록은 JSON 문자열 1개를 파라미터로 넘겨 from_json() 으로 풀어 씁니다 (문장 1개 = 원자적 처리).
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

/** 자산 1건 입력 검증 규칙 (엑셀 행·개별 수정 공용) */
export const assetInputSchema = z.object({
  assetType: z.enum(ASSET_TYPES, { error: "허용되지 않은 자산유형" }),
  assetName: z.string().trim().min(1, "자산명 누락").max(200),
  vendor: optionalText(200),
  productName: optionalText(200),
  version: optionalText(100),
  cpe: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || isValidCpe(v), "CPE 형식 오류 (cpe:2.3:... 형식)"),
  exposure: z.enum(EXPOSURES, { error: "노출구분은 경계면/내부 중 하나" }),
  owner: optionalText(100),
  department: optionalText(100),
  ipAddress: optionalText(64).refine(
    (v) => v === null || v === undefined || /^[0-9a-fA-F.:/, -]+$/.test(v),
    "IP 형식 오류",
  ),
});
export type AssetInput = z.infer<typeof assetInputSchema>;

export interface AssetRecord {
  id: string;
  assetType: string;
  assetName: string;
  vendor: string | null;
  productName: string | null;
  version: string | null;
  cpe: string | null;
  cpeSource: "INPUT" | "GENERATED" | null;
  exposure: string;
  owner: string | null;
  department: string | null;
  ipAddress: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}

interface AssetRow {
  id: string;
  asset_type: string;
  asset_name: string;
  vendor: string | null;
  product_name: string | null;
  version: string | null;
  cpe: string | null;
  cpe_source: string | null;
  exposure: string;
  owner: string | null;
  department: string | null;
  ip_address: string | null;
  created_at: unknown;
  updated_at: unknown;
}

const SELECT_COLUMNS = `id, asset_type, asset_name, vendor, product_name, version, cpe, cpe_source,
  exposure, owner, department, ip_address, created_at, updated_at`;

function toRecord(r: AssetRow): AssetRecord {
  return {
    id: r.id,
    assetType: r.asset_type,
    assetName: r.asset_name,
    vendor: r.vendor,
    productName: r.product_name,
    version: r.version,
    cpe: r.cpe,
    cpeSource: r.cpe_source === "INPUT" || r.cpe_source === "GENERATED" ? r.cpe_source : null,
    exposure: r.exposure,
    owner: r.owner,
    department: r.department,
    ipAddress: r.ip_address,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 입력값에 CPE 가 없으면 자동 생성해 저장용 형태로 바꿉니다. */
export function withCpe(input: AssetInput): AssetInput & { cpe: string | null; cpeSource: "INPUT" | "GENERATED" | null } {
  if (input.cpe) return { ...input, cpe: input.cpe, cpeSource: "INPUT" };
  const generated = generateCpe(input.vendor ?? null, input.productName ?? null, input.version ?? null);
  return { ...input, cpe: generated, cpeSource: generated ? "GENERATED" : null };
}

/** 정렬 허용 목록: 화면에서 받은 이름 → 실제 컬럼 (사용자 입력을 SQL 에 직접 넣지 않기 위함) */
const SORTABLE = new Map<string, string>([
  ["assetName", "asset_name"],
  ["assetType", "asset_type"],
  ["exposure", "exposure"],
  ["vendor", "vendor"],
  ["department", "department"],
  ["updatedAt", "updated_at"],
]);

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  assetType: z.enum(ASSET_TYPES).optional(),
  exposure: z.enum(EXPOSURES).optional(),
  sort: z.enum([...SORTABLE.keys()] as [string, ...string[]]).default("assetName"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export async function listAssets(q: ListQuery): Promise<{ items: AssetRecord[]; total: number }> {
  const where: string[] = [];
  const params: SqlParams = {};
  if (q.q) {
    where.push(
      "(lower(asset_name) LIKE :kw OR lower(vendor) LIKE :kw OR lower(product_name) LIKE :kw OR lower(owner) LIKE :kw OR lower(ip_address) LIKE :kw)",
    );
    params.kw = `%${q.q.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`;
  }
  if (q.assetType) {
    where.push("asset_type = :assetType");
    params.assetType = q.assetType;
  }
  if (q.exposure) {
    where.push("exposure = :exposure");
    params.exposure = q.exposure;
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const sortColumn = SORTABLE.get(q.sort) ?? "asset_name";
  const direction = q.order === "desc" ? "DESC" : "ASC";

  const countRow = await queryOne<{ cnt: number | bigint }>(`SELECT COUNT(*) AS cnt FROM assets ${whereSql}`, params);
  const rows = await query<AssetRow>(
    `SELECT ${SELECT_COLUMNS} FROM assets ${whereSql}
     ORDER BY ${sortColumn} ${direction}, asset_name ASC
     LIMIT :limit OFFSET :offset`,
    { ...params, limit: q.pageSize, offset: (q.page - 1) * q.pageSize },
  );
  return { items: rows.map(toRecord), total: Number(countRow?.cnt ?? 0) };
}

export async function getAsset(id: string): Promise<AssetRecord | null> {
  const row = await queryOne<AssetRow>(`SELECT ${SELECT_COLUMNS} FROM assets WHERE id = :id`, { id });
  return row ? toRecord(row) : null;
}

export async function updateAsset(id: string, input: AssetInput): Promise<boolean> {
  const a = withCpe(input);
  const existing = await getAsset(id);
  if (!existing) return false;
  await execute(
    `UPDATE assets SET
       asset_type = :assetType, asset_name = :assetName, vendor = :vendor, product_name = :productName,
       version = :version, cpe = :cpe, cpe_source = :cpeSource, exposure = :exposure, owner = :owner,
       department = :department, ip_address = :ipAddress, updated_at = current_timestamp()
     WHERE id = :id`,
    {
      id,
      assetType: a.assetType,
      assetName: a.assetName,
      vendor: a.vendor ?? null,
      productName: a.productName ?? null,
      version: a.version ?? null,
      cpe: a.cpe,
      cpeSource: a.cpeSource,
      exposure: a.exposure,
      owner: a.owner ?? null,
      department: a.department ?? null,
      ipAddress: a.ipAddress ?? null,
    },
  );
  return true;
}

/** 자산 삭제 + 그 자산의 매칭 결과 삭제 */
export async function deleteAsset(id: string): Promise<boolean> {
  const existing = await getAsset(id);
  if (!existing) return false;
  await execute("DELETE FROM asset_vulnerabilities WHERE asset_id = :id", { id });
  await execute("DELETE FROM assets WHERE id = :id", { id });
  return true;
}

/** from_json() 에 넘길 행 구조 (컬럼 이름은 코드에 고정) */
const ROW_STRUCT =
  "ARRAY<STRUCT<asset_type:STRING, asset_name:STRING, vendor:STRING, product_name:STRING, version:STRING, cpe:STRING, cpe_source:STRING, exposure:STRING, owner:STRING, department:STRING, ip_address:STRING>>";

function toJsonRows(inputs: AssetInput[]): string {
  return JSON.stringify(
    inputs.map((i) => {
      const a = withCpe(i);
      return {
        asset_type: a.assetType,
        asset_name: a.assetName,
        vendor: a.vendor ?? null,
        product_name: a.productName ?? null,
        version: a.version ?? null,
        cpe: a.cpe,
        cpe_source: a.cpeSource,
        exposure: a.exposure,
        owner: a.owner ?? null,
        department: a.department ?? null,
        ip_address: a.ipAddress ?? null,
      };
    }),
  );
}

const UPSERT_CHUNK = 500;

/**
 * 추가/갱신 (자산명 기준). 같은 자산명이 있으면 수정, 없으면 추가합니다.
 * 각 MERGE 문장은 Delta 테이블에서 원자적으로 처리됩니다.
 */
export async function upsertAssets(inputs: AssetInput[]): Promise<{ affected: number }> {
  let affected = 0;
  for (let i = 0; i < inputs.length; i += UPSERT_CHUNK) {
    const chunk = inputs.slice(i, i + UPSERT_CHUNK);
    await execute(
      `MERGE INTO assets AS t
       USING (SELECT r.* FROM (SELECT explode(from_json(:rows, '${ROW_STRUCT}')) AS r)) AS s
       ON lower(t.asset_name) = lower(s.asset_name)
       WHEN MATCHED THEN UPDATE SET
         asset_type = s.asset_type, vendor = s.vendor, product_name = s.product_name, version = s.version,
         cpe = s.cpe, cpe_source = s.cpe_source, exposure = s.exposure, owner = s.owner,
         department = s.department, ip_address = s.ip_address, updated_at = current_timestamp()
       WHEN NOT MATCHED THEN INSERT
         (id, asset_type, asset_name, vendor, product_name, version, cpe, cpe_source, exposure, owner, department, ip_address, created_at, updated_at)
         VALUES (uuid(), s.asset_type, s.asset_name, s.vendor, s.product_name, s.version, s.cpe, s.cpe_source, s.exposure, s.owner, s.department, s.ip_address, current_timestamp(), current_timestamp())`,
      { rows: toJsonRows(chunk) },
    );
    affected += chunk.length;
  }
  return { affected };
}

/**
 * 전체 교체. INSERT OVERWRITE 문장 1개로 처리하므로 중간에 실패하면 기존 데이터가 그대로 남습니다(롤백 효과).
 * 같은 자산명이 이미 있으면 id 와 최초 등록일은 유지해 매칭 이력이 끊기지 않게 합니다.
 * 교체 후 사라진 자산의 매칭 결과는 함께 삭제합니다.
 */
export async function replaceAllAssets(inputs: AssetInput[]): Promise<{ inserted: number; removedMatches: boolean }> {
  await execute(
    `INSERT OVERWRITE assets
     SELECT coalesce(a.id, uuid()) AS id, s.asset_type, s.asset_name, s.vendor, s.product_name, s.version,
            s.cpe, s.cpe_source, s.exposure, s.owner, s.department, s.ip_address,
            coalesce(a.created_at, current_timestamp()) AS created_at, current_timestamp() AS updated_at
     FROM (SELECT r.* FROM (SELECT explode(from_json(:rows, '${ROW_STRUCT}')) AS r)) AS s
     LEFT JOIN assets AS a ON lower(a.asset_name) = lower(s.asset_name)`,
    { rows: toJsonRows(inputs) },
  );
  await execute("DELETE FROM asset_vulnerabilities WHERE asset_id NOT IN (SELECT id FROM assets)");
  return { inserted: inputs.length, removedMatches: true };
}
