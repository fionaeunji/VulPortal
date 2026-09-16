import Link from "next/link";
import { EXPOSURES, exposureLabel } from "@/lib/asset-rules";
import { listAssetVulns, listDepartments, vulnListQuerySchema, type AssetVulnRecord } from "@/lib/asset-vulns";
import { getCurrentUser } from "@/lib/auth";
import { DUE_RULE_TABLE, SEVERITIES, STATUSES, severityLabel, statusLabel } from "@/lib/vuln-rules";
import VulnTable from "./VulnTable";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v) || undefined;

/** 취약점 관리: 필터 · 상태 변경 · 엑셀 Export */
export default async function VulnerabilitiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const parsed = vulnListQuerySchema.safeParse({
    q: first(sp.q),
    severity: first(sp.severity),
    status: first(sp.status),
    exposure: first(sp.exposure),
    department: first(sp.department),
    overdue: first(sp.overdue),
    sort: first(sp.sort),
    order: first(sp.order),
    page: first(sp.page),
  });
  const q = parsed.success ? parsed.data : vulnListQuerySchema.parse({});

  const user = await getCurrentUser();
  const isAdmin = user?.role === "ADMIN";

  let items: AssetVulnRecord[] = [];
  let total = 0;
  let departments: string[] = [];
  let loadError = false;
  try {
    const [result, deps] = await Promise.all([listAssetVulns(q), listDepartments()]);
    items = result.items;
    total = result.total;
    departments = deps;
  } catch {
    loadError = true;
  }
  const pageCount = Math.max(1, Math.ceil(total / q.pageSize));

  const buildParams = (page: number) => {
    const p = new URLSearchParams();
    if (q.q) p.set("q", q.q);
    if (q.severity) p.set("severity", q.severity);
    if (q.status) p.set("status", q.status);
    if (q.exposure) p.set("exposure", q.exposure);
    if (q.department) p.set("department", q.department);
    if (q.overdue) p.set("overdue", "1");
    p.set("sort", q.sort);
    p.set("order", q.order);
    p.set("page", String(page));
    return p;
  };
  const exportHref = `/api/asset-vulns/export?${buildParams(1).toString()}`;

  return (
    <main className="container">
      <div className="page-head">
        <h1>취약점 관리</h1>
        <div className="actions">
          <a href={exportHref} download className="button-link secondary">
            목록 엑셀 Export (현재 조건 전체)
          </a>
        </div>
      </div>

      <form className="form-row card" method="get" action="/vulnerabilities">
        <label>
          검색 (자산명·CVE·담당자)
          <input type="text" name="q" maxLength={100} defaultValue={q.q ?? ""} />
        </label>
        <label>
          위험도
          <select name="severity" defaultValue={q.severity ?? ""}>
            <option value="">전체</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {severityLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          상태
          <select name="status" defaultValue={q.status ?? ""}>
            <option value="">전체</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          노출구분
          <select name="exposure" defaultValue={q.exposure ?? ""}>
            <option value="">전체</option>
            {EXPOSURES.map((e) => (
              <option key={e} value={e}>
                {exposureLabel(e)}
              </option>
            ))}
          </select>
        </label>
        <label>
          담당부서
          <select name="department" defaultValue={q.department ?? ""}>
            <option value="">전체</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          정렬
          <select name="sort" defaultValue={q.sort}>
            <option value="dueDate">기한</option>
            <option value="severity">위험도</option>
            <option value="assetName">자산명</option>
            <option value="cveId">CVE</option>
            <option value="cvssScore">CVSS</option>
            <option value="detectedAt">탐지일</option>
            <option value="status">상태</option>
          </select>
        </label>
        <label>
          순서
          <select name="order" defaultValue={q.order}>
            <option value="asc">오름차순</option>
            <option value="desc">내림차순</option>
          </select>
        </label>
        <label className="checkbox">
          <span>
            <input type="checkbox" name="overdue" value="1" defaultChecked={Boolean(q.overdue)} /> 기한 초과만
          </span>
        </label>
        <button type="submit">조회</button>
        <Link href="/vulnerabilities" className="button-link secondary">
          초기화
        </Link>
      </form>

      {loadError ? <div className="alert-error">매칭 결과를 불러오지 못했습니다.</div> : null}

      <p className="muted">
        총 {total.toLocaleString()}건 · {q.page}/{pageCount} 페이지
        {isAdmin ? null : " · '해당 없음' 처리는 관리자만 할 수 있습니다"}
      </p>
      <VulnTable
        items={items.map((r) => ({
          id: r.id,
          assetName: r.assetName,
          exposure: r.exposure,
          cveId: r.cveId,
          severity: r.severity,
          matchMethod: r.matchMethod,
          cvssScore: r.cvssScore,
          epssScore: r.epssScore,
          epssInitial: r.epssInitial,
          isKev: r.isKev,
          detectedAt: r.detectedAt?.toISOString() ?? null,
          dueDate: r.dueDate?.toISOString() ?? null,
          status: r.status,
          completedAt: r.completedAt?.toISOString() ?? null,
          note: r.note,
          owner: r.owner,
          department: r.department,
          updatedBy: r.updatedBy,
        }))}
        isAdmin={isAdmin}
      />

      <div className="pager">
        {q.page > 1 ? <Link href={`/vulnerabilities?${buildParams(q.page - 1)}`}>← 이전</Link> : <span className="muted">← 이전</span>}
        <span>
          {q.page} / {pageCount}
        </span>
        {q.page < pageCount ? <Link href={`/vulnerabilities?${buildParams(q.page + 1)}`}>다음 →</Link> : <span className="muted">다음 →</span>}
      </div>

      <section className="card">
        <h3>판정 규칙</h3>
        <p className="muted">
          위험도: KEV 등재 → 긴급 / CVSS 9.0 이상 + EPSS초기 0.3 이상 → 긴급 / CVSS 9.0 이상 + EPSS초기 0.1 이상 → 우선 /
          CVSS 7.0 이상 → 주의 / 그 외는 저장하지 않음. &quot;유사 매칭&quot;은 제조사·제품명 문자열 비교 결과라 정확하지 않을 수
          있으며, 관리자가 &quot;해당 없음&quot;으로 제외할 수 있습니다.
        </p>
        <table className="data summary">
          <thead>
            <tr>
              <th>위험도</th>
              <th>경계면 자산</th>
              <th>내부 자산</th>
            </tr>
          </thead>
          <tbody>
            {DUE_RULE_TABLE.map((row) => (
              <tr key={row.severity}>
                <td>{severityLabel(row.severity)}</td>
                <td>{row.external}</td>
                <td>{row.internal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
