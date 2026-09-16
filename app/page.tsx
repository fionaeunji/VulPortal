import Link from "next/link";
import SeverityChart from "@/app/components/SeverityChart";
import { exposureLabel } from "@/lib/asset-rules";
import {
  getAssetStatus,
  getEmergencyList,
  getSeverityDistribution,
  getSummary,
  getSyncStatus,
  type AssetStatusItem,
  type DashboardSummary,
  type EmergencyItem,
  type SeverityCount,
  type SyncStatus,
} from "@/lib/dashboard";
import { formatDateKst, formatDateTimeKst } from "@/lib/format";
import { remainingDays, severityLabel, statusLabel } from "@/lib/vuln-rules";

export const dynamic = "force-dynamic";

const SOURCE_LABEL = new Map<string, string>([
  ["ALL", "전체"],
  ["NVD", "NVD"],
  ["EPSS", "EPSS"],
  ["KEV", "KEV"],
  ["MATCH", "자산 매칭"],
  ["SEVERITY", "위험도 재계산"],
]);
const STATUS_LABEL = new Map<string, string>([
  ["QUEUED", "대기"],
  ["RUNNING", "실행 중"],
  ["SUCCESS", "성공"],
  ["FAILED", "실패"],
  ["SKIPPED", "건너뜀"],
]);

/** 엑셀 Export 링크 (파일 다운로드이므로 일반 링크 사용) */
function ExportLink({ part, label }: { part: string; label?: string }) {
  return (
    <a href={`/api/dashboard/export?part=${part}`} download className="button-link secondary small">
      {label ?? "엑셀 Export"}
    </a>
  );
}

/** 대시보드 (첫 화면) */
export default async function DashboardPage() {
  let summary: DashboardSummary | null = null;
  let severity: SeverityCount[] = [];
  let emergency: EmergencyItem[] = [];
  let assets: AssetStatusItem[] = [];
  let sync: SyncStatus | null = null;
  let loadError = false;
  try {
    [summary, severity, emergency, assets, sync] = await Promise.all([
      getSummary(),
      getSeverityDistribution(),
      getEmergencyList(100),
      getAssetStatus(100),
      getSyncStatus(),
    ]);
  } catch {
    loadError = true;
  }
  const now = new Date();

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>대시보드</h1>
          <p className="muted">기준 시각 {formatDateTimeKst(now)} (KST) · &quot;해당 없음&quot; 처리 건은 집계에서 제외</p>
        </div>
        <div className="actions">
          <a href="/api/dashboard/export?part=all" download className="button-link">
            전체 Export (시트별 xlsx)
          </a>
        </div>
      </div>

      {loadError ? (
        <div className="alert-error">대시보드 데이터를 불러오지 못했습니다. DB 연결 상태를 확인하세요. (/api/health)</div>
      ) : null}

      {/* 상단 카드 4개 */}
      <section className="cards">
        <div className="card stat">
          <div className="stat-label">총 취약점 건수</div>
          <div className="stat-value">{summary ? summary.total.toLocaleString() : "-"}</div>
          <ExportLink part="summary" />
        </div>
        <div className="card stat">
          <div className="stat-label">긴급 취약점 (미조치)</div>
          <div className="stat-value status-error">{summary ? summary.emergencyOpen.toLocaleString() : "-"}</div>
          <ExportLink part="summary" />
        </div>
        <div className="card stat">
          <div className="stat-label">조치율</div>
          <div className="stat-value status-ok">{summary?.completionRate === null || !summary ? "-" : `${summary.completionRate}%`}</div>
          <div className="muted small-text">완료 ÷ (전체 − 위험수용)</div>
          <ExportLink part="summary" />
        </div>
        <div className="card stat">
          <div className="stat-label">기한 초과</div>
          <div className="stat-value status-error">{summary ? summary.overdue.toLocaleString() : "-"}</div>
          <ExportLink part="summary" />
        </div>
      </section>

      <section className="grid-2">
        {/* 위험도별 분포 */}
        <div className="card">
          <div className="card-head">
            <h2>위험도별 취약점 분포 (미조치)</h2>
            <ExportLink part="severity" />
          </div>
          <SeverityChart
            data={severity.map((s) => ({ label: severityLabel(s.severity), open: s.open, done: s.done, total: s.total }))}
          />
          <table className="data summary">
            <thead>
              <tr>
                <th>위험도</th>
                <th>미조치</th>
                <th>완료</th>
                <th>전체</th>
              </tr>
            </thead>
            <tbody>
              {severity.map((s) => (
                <tr key={s.severity}>
                  <td>
                    <span className={`sev sev-${s.severity.toLowerCase()}`}>{severityLabel(s.severity)}</span>
                  </td>
                  <td>{s.open.toLocaleString()}</td>
                  <td>{s.done.toLocaleString()}</td>
                  <td>{s.total.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 최근 수집 상태 */}
        <div className="card">
          <div className="card-head">
            <h2>최근 수집 상태</h2>
            <ExportLink part="sync" />
          </div>
          {sync?.latest ? (
            <>
              <p>
                마지막 동기화: <strong>{formatDateTimeKst(sync.latest.startedAt)}</strong> ·{" "}
                <span className={sync.latest.status === "SUCCESS" ? "status-ok" : sync.latest.status === "FAILED" ? "status-error" : "muted"}>
                  {STATUS_LABEL.get(sync.latest.status) ?? sync.latest.status}
                </span>
                {sync.latest.finishedAt ? <span className="muted"> (종료 {formatDateTimeKst(sync.latest.finishedAt)})</span> : null}
              </p>
              <table className="data summary">
                <thead>
                  <tr>
                    <th>단계</th>
                    <th>상태</th>
                    <th>처리 건수</th>
                  </tr>
                </thead>
                <tbody>
                  {sync.steps.map((s) => (
                    <tr key={s.id}>
                      <td>{SOURCE_LABEL.get(s.source) ?? s.source}</td>
                      <td className={s.status === "SUCCESS" ? "status-ok" : s.status === "FAILED" ? "status-error" : "muted"}>
                        {STATUS_LABEL.get(s.status) ?? s.status}
                      </td>
                      <td>{s.processedCount === null ? "-" : s.processedCount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="muted">아직 수집 이력이 없습니다. 관리자 설정 › 취약점 수집에서 실행할 수 있습니다.</p>
          )}
        </div>
      </section>

      {/* 긴급 조치 대상 */}
      <section className="card">
        <div className="card-head">
          <h2>긴급 조치 대상 (기한 빠른 순, 최대 100건)</h2>
          <ExportLink part="emergency" label="엑셀 Export (전체)" />
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>자산명</th>
                <th>노출구분</th>
                <th>CVE</th>
                <th>CVSS</th>
                <th>EPSS</th>
                <th>KEV</th>
                <th>기한</th>
                <th>남은 일수</th>
                <th>상태</th>
                <th>담당자</th>
              </tr>
            </thead>
            <tbody>
              {emergency.length === 0 ? (
                <tr>
                  <td colSpan={10} className="muted">
                    미조치 긴급 취약점이 없습니다.
                  </td>
                </tr>
              ) : null}
              {emergency.map((r) => {
                const days = remainingDays(r.dueDate, now);
                const overdue = days !== null && days < 0;
                return (
                  <tr key={r.id}>
                    <td>{r.assetName}</td>
                    <td>{exposureLabel(r.exposure)}</td>
                    <td className="mono">{r.cveId}</td>
                    <td>{r.cvssScore ?? "-"}</td>
                    <td>{r.epssScore === null ? "-" : r.epssScore.toFixed(3)}</td>
                    <td>{r.isKev ? "예" : "-"}</td>
                    <td className="nowrap">{formatDateKst(r.dueDate)}</td>
                    <td className={overdue ? "status-error" : ""}>{days === null ? "-" : overdue ? `${Math.abs(days)}일 초과` : `${days}일`}</td>
                    <td>{statusLabel(r.status)}</td>
                    <td>{r.owner ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 자산별 취약점 현황 */}
      <section className="card">
        <div className="card-head">
          <h2>자산별 취약점 현황 (긴급 많은 순, 최대 100건)</h2>
          <ExportLink part="assets" label="엑셀 Export (전체)" />
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>자산명</th>
                <th>유형</th>
                <th>노출구분</th>
                <th>긴급</th>
                <th>우선</th>
                <th>주의</th>
                <th>기한 초과</th>
                <th>조치율</th>
                <th>담당부서</th>
              </tr>
            </thead>
            <tbody>
              {assets.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">
                    등록된 자산이 없습니다. <Link href="/assets">자산 관리</Link>에서 등록하세요.
                  </td>
                </tr>
              ) : null}
              {assets.map((a) => (
                <tr key={a.assetId}>
                  <td>{a.assetName}</td>
                  <td>{a.assetType}</td>
                  <td>{exposureLabel(a.exposure)}</td>
                  <td className={a.emergency > 0 ? "status-error" : ""}>{a.emergency}</td>
                  <td>{a.priority}</td>
                  <td>{a.caution}</td>
                  <td className={a.overdue > 0 ? "status-error" : ""}>{a.overdue}</td>
                  <td>{a.completionRate === null ? "-" : `${a.completionRate}%`}</td>
                  <td>{a.department ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
