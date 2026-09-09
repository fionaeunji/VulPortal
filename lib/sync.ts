import "server-only";
import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "@/lib/db";

/** 수집 이력(sync_logs) 조회와 실행 잠금 확인 */

export interface SyncLogRecord {
  id: string;
  runId: string | null;
  source: string;
  status: string;
  startedAt: unknown;
  finishedAt: unknown;
  processedCount: number | null;
  errorMessage: string | null;
  triggeredBy: string | null;
}

interface SyncLogRow {
  id: string;
  run_id: string | null;
  source: string;
  status: string;
  started_at: unknown;
  finished_at: unknown;
  processed_count: number | bigint | null;
  error_message: string | null;
  triggered_by: string | null;
}

/** 이 시간이 지난 RUNNING/QUEUED 기록은 죽은 것으로 보고 잠금에서 제외합니다 (노트북과 같은 값) */
const LOCK_EXPIRE_HOURS = 6;

export async function listSyncLogs(limit = 100): Promise<SyncLogRecord[]> {
  const rows = await query<SyncLogRow>(
    `SELECT id, run_id, source, status, started_at, finished_at, processed_count, error_message, triggered_by
     FROM sync_logs ORDER BY started_at DESC LIMIT :limit`,
    { limit },
  );
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    source: r.source,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    processedCount: r.processed_count === null ? null : Number(r.processed_count),
    errorMessage: r.error_message,
    triggeredBy: r.triggered_by,
  }));
}

/** 최근 전체 실행(ALL) 1건 — 대시보드 "최근 수집 상태"에 사용 */
export async function latestSyncRun(): Promise<SyncLogRecord | null> {
  const rows = await listSyncLogsBySource("ALL", 1);
  return rows[0] ?? null;
}

async function listSyncLogsBySource(source: string, limit: number): Promise<SyncLogRecord[]> {
  const rows = await query<SyncLogRow>(
    `SELECT id, run_id, source, status, started_at, finished_at, processed_count, error_message, triggered_by
     FROM sync_logs WHERE source = :source ORDER BY started_at DESC LIMIT :limit`,
    { source, limit },
  );
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    source: r.source,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    processedCount: r.processed_count === null ? null : Number(r.processed_count),
    errorMessage: r.error_message,
    triggeredBy: r.triggered_by,
  }));
}

/** 실행 중(QUEUED/RUNNING)인 전체 수집이 있는지 확인합니다. 동시 실행 방지용. */
export async function findRunningSync(): Promise<SyncLogRecord | null> {
  const cutoff = new Date(Date.now() - LOCK_EXPIRE_HOURS * 3600 * 1000);
  const row = await queryOne<SyncLogRow>(
    `SELECT id, run_id, source, status, started_at, finished_at, processed_count, error_message, triggered_by
     FROM sync_logs
     WHERE source = 'ALL' AND status IN ('QUEUED', 'RUNNING') AND started_at > :cutoff
     ORDER BY started_at DESC LIMIT 1`,
    { cutoff },
  );
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    source: row.source,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    processedCount: row.processed_count === null ? null : Number(row.processed_count),
    errorMessage: row.error_message,
    triggeredBy: row.triggered_by,
  };
}

/** 수동 실행 요청 직후 QUEUED 행을 남깁니다. 노트북이 시작되면 같은 run_id 행을 RUNNING 으로 바꿉니다. */
export async function recordQueuedRun(runId: string, triggeredBy: string): Promise<void> {
  await execute(
    `INSERT INTO sync_logs (id, run_id, source, status, started_at, finished_at, processed_count, error_message, triggered_by)
     VALUES (:id, :runId, 'ALL', 'QUEUED', current_timestamp(), NULL, NULL, NULL, :by)`,
    { id: randomUUID(), runId, by: triggeredBy },
  );
}
