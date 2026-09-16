import { exposureLabel } from "@/lib/asset-rules";
import { listAssetVulns, vulnListQuerySchema, type AssetVulnRecord } from "@/lib/asset-vulns";
import { formatDateKst } from "@/lib/format";
import {
  DUE_RULE_TABLE,
  MATCH_METHOD_LABEL,
  isOverdue,
  remainingDays,
  severityLabel,
  statusLabel,
} from "@/lib/vuln-rules";

export const dynamic = "force-dynamic";

/** 취약점 관리 (5단계: 매칭 결과 확인용 읽기 전용 목록. 필터·상태 변경은 7단계) */
export default async function VulnerabilitiesPage() {
  const q = vulnListQuerySchema.parse({ pageSize: "100" });
  let items: AssetVulnRecord[] = [];
  let total = 0;
  let loadError = false;
  try {
    const result = await listAssetVulns(q);
    items = result.items;
    total = result.total;
  } catch {
    loadError = true;
  }
  const now = new Date();

  return (
    <main className="container">
      <h1>취약점 관리</h1>
      <p className="muted">
        수집 Job 이 자산과 취약점을 매칭한 결과입니다. 기한이 빠른 순으로 최대 100건을 보여줍니다. (필터·상태 변경은
        7단계에서 추가됩니다)
      </p>
      {loadError ? <div className="alert-error">매칭 결과를 불러오지 못했습니다.</div> : null}

      <section className="card">
        <p className="muted">총 {total.toLocaleString()}건</p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>자산명</th>
                <th>노출구분</th>
                <th>CVE</th>
                <th>위험도</th>
                <th>매칭</th>
                <th>CVSS</th>
                <th>EPSS(초기)</th>
                <th>KEV</th>
                <th>탐지일</th>
                <th>기한</th>
                <th>남은 일수</th>
                <th>상태</th>
                <th>담당자</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={13} className="muted">
                    매칭된 취약점이 없습니다. 자산을 등록하고 수집 Job 을 실행하면 여기에 표시됩니다.
                  </td>
                </tr>
              ) : null}
              {items.map((r) => {
                const days = remainingDays(r.dueDate, now);
                const overdue = isOverdue(r.status, r.dueDate, now);
                return (
                  <tr key={r.id}>
                    <td>{r.assetName}</td>
                    <td>{exposureLabel(r.exposure)}</td>
                    <td className="mono">{r.cveId}</td>
                    <td>
                      <span className={`sev sev-${r.severity.toLowerCase()}`}>{severityLabel(r.severity)}</span>
                    </td>
                    <td>
                      {r.matchMethod === "FUZZY" ? (
                        <span className="badge badge-warn" title="제조사/제품명 문자열 비교로 매칭되어 정확하지 않을 수 있습니다">
                          {MATCH_METHOD_LABEL.FUZZY}
                        </span>
                      ) : (
                        MATCH_METHOD_LABEL.CPE
                      )}
                    </td>
                    <td>{r.cvssScore ?? "-"}</td>
                    <td>{r.epssInitial === null ? "-" : r.epssInitial.toFixed(3)}</td>
                    <td>{r.isKev ? "예" : "-"}</td>
                    <td className="nowrap">{formatDateKst(r.detectedAt)}</td>
                    <td className="nowrap">{formatDateKst(r.dueDate)}</td>
                    <td className={overdue ? "status-error" : ""}>
                      {days === null ? "-" : overdue ? `${Math.abs(days)}일 초과` : `${days}일`}
                    </td>
                    <td>{statusLabel(r.status)}</td>
                    <td>{r.owner ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h3>판정 규칙</h3>
        <p className="muted">
          위험도: KEV 등재 → 긴급 / CVSS 9.0 이상 + EPSS초기 0.3 이상 → 긴급 / CVSS 9.0 이상 + EPSS초기 0.1 이상 → 우선 /
          CVSS 7.0 이상 → 주의 / 그 외는 저장하지 않음
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
