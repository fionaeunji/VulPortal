"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { formatDateTimeKst } from "@/lib/format";

interface SyncLogItem {
  id: string;
  runId: string | null;
  source: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  processedCount: number | null;
  errorMessage: string | null;
  triggeredBy: string | null;
}

const SOURCE_LABEL = new Map<string, string>([
  ["ALL", "전체 실행"],
  ["NVD", "NVD (CVSS)"],
  ["EPSS", "EPSS"],
  ["KEV", "CISA KEV"],
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

function statusClass(status: string): string {
  if (status === "SUCCESS") return "status-ok";
  if (status === "FAILED") return "status-error";
  return "muted";
}

/** 수동 실행 버튼과 수집 이력 표 */
export default function SyncPanel({ configured, initialLogs }: { configured: boolean; initialLogs: SyncLogItem[] }) {
  const [logs, setLogs] = useState<SyncLogItem[]>(initialLogs);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function reload(): Promise<void> {
    setBusy(true);
    try {
      const data = await apiFetch<{ logs: SyncLogItem[] }>("/api/sync/logs");
      setLogs(data.logs);
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "이력 조회 실패" });
    } finally {
      setBusy(false);
    }
  }

  async function runNow(): Promise<void> {
    if (!window.confirm("취약점 수집을 지금 실행할까요? 완료까지 수십 분이 걸릴 수 있습니다.")) return;
    setBusy(true);
    setMessage(null);
    try {
      const data = await apiFetch<{ runId: string }>("/api/sync/run", { method: "POST", body: {} });
      setMessage({ kind: "ok", text: `수집 실행을 요청했습니다 (실행 ID ${data.runId}). 잠시 후 새로 고침으로 진행 상황을 확인하세요.` });
      await reload();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "실행 요청 실패" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="form-row">
        <button type="button" disabled={busy || !configured} onClick={runNow}>
          지금 수동 실행
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={reload}>
          새로 고침
        </button>
        {!configured ? <span className="muted">SYNC_JOB_ID 환경변수가 없어 수동 실행을 쓸 수 없습니다.</span> : null}
      </div>
      {message ? <div className={message.kind === "ok" ? "alert-ok" : "alert-error"}>{message.text}</div> : null}

      <h2>수집 이력 (최근 100건)</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>시작</th>
              <th>종료</th>
              <th>단계</th>
              <th>상태</th>
              <th>처리 건수</th>
              <th>실행 주체</th>
              <th>실행 ID</th>
              <th>오류</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  수집 이력이 없습니다.
                </td>
              </tr>
            ) : null}
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="nowrap">{formatDateTimeKst(l.startedAt)}</td>
                <td className="nowrap">{formatDateTimeKst(l.finishedAt)}</td>
                <td>{SOURCE_LABEL.get(l.source) ?? l.source}</td>
                <td className={statusClass(l.status)}>{STATUS_LABEL.get(l.status) ?? l.status}</td>
                <td>{l.processedCount === null ? "-" : l.processedCount.toLocaleString()}</td>
                <td>{l.triggeredBy ?? "-"}</td>
                <td className="mono">{l.runId ?? "-"}</td>
                <td>{l.errorMessage ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
