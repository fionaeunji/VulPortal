import { getCurrentUser } from "@/lib/auth";
import { isSyncJobConfigured } from "@/lib/databricks-jobs";
import { listSyncLogs, type SyncLogRecord } from "@/lib/sync";
import SyncPanel from "./SyncPanel";

export const dynamic = "force-dynamic";

/** 관리자 설정 › 취약점 수집: 수동 실행 버튼 + 수집 이력 */
export default async function SyncAdminPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return (
      <main className="container">
        <h1>취약점 수집</h1>
        <div className="alert-error">관리자만 접근할 수 있는 화면입니다.</div>
      </main>
    );
  }
  let logs: SyncLogRecord[] = [];
  let loadError = false;
  try {
    logs = await listSyncLogs(100);
  } catch {
    loadError = true;
  }
  return (
    <main className="container">
      <h1>관리자 설정 · 취약점 수집</h1>
      <p className="muted">
        매일 06:00(KST) 자동으로 NVD → EPSS → CISA KEV → 자산 매칭 → 위험도 재계산 순서로 실행됩니다. 필요하면 아래
        버튼으로 지금 바로 실행할 수 있습니다.
      </p>
      {loadError ? <div className="alert-error">수집 이력을 불러오지 못했습니다.</div> : null}
      <SyncPanel
        configured={isSyncJobConfigured()}
        initialLogs={logs.map((l) => ({
          id: l.id,
          runId: l.runId,
          source: l.source,
          status: l.status,
          startedAt: l.startedAt === null || l.startedAt === undefined ? null : String(l.startedAt),
          finishedAt: l.finishedAt === null || l.finishedAt === undefined ? null : String(l.finishedAt),
          processedCount: l.processedCount,
          errorMessage: l.errorMessage,
          triggeredBy: l.triggeredBy,
        }))}
      />
    </main>
  );
}
