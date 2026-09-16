"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { exposureLabel } from "@/lib/asset-rules";
import { apiFetch } from "@/lib/client/api";
import { formatDateKst } from "@/lib/format";
import { MATCH_METHOD_LABEL, STATUSES, isOverdue, remainingDays, severityLabel, statusLabel } from "@/lib/vuln-rules";

export interface VulnItem {
  id: string;
  assetName: string;
  exposure: string;
  cveId: string;
  severity: string;
  matchMethod: string;
  cvssScore: number | null;
  epssScore: number | null;
  epssInitial: number | null;
  isKev: boolean;
  detectedAt: string | null;
  dueDate: string | null;
  status: string;
  completedAt: string | null;
  note: string | null;
  owner: string | null;
  department: string | null;
  updatedBy: string | null;
}

/** 자산-취약점 목록 표. 행마다 상태·비고를 바꿔 저장할 수 있습니다 (서버 API 가 권한·입력을 재검사). */
export default function VulnTable({ items, isAdmin }: { items: VulnItem[]; isAdmin: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<VulnItem | null>(null);
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const now = new Date();

  function startEdit(item: VulnItem): void {
    setEditing(item);
    setStatus(item.status);
    setNote(item.note ?? "");
    setMessage(null);
  }

  async function save(): Promise<void> {
    if (!editing) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch(`/api/asset-vulns/${encodeURIComponent(editing.id)}/status`, {
        method: "PUT",
        body: { status, note },
      });
      setMessage({ kind: "ok", text: `${editing.assetName} / ${editing.cveId} 상태를 '${statusLabel(status)}'(으)로 저장했습니다` });
      setEditing(null);
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "저장 실패" });
    } finally {
      setBusy(false);
    }
  }

  const allowedStatuses = STATUSES.filter((s) => isAdmin || s !== "NOT_APPLICABLE");

  return (
    <section className="card">
      {message ? <div className={message.kind === "ok" ? "alert-ok" : "alert-error"}>{message.text}</div> : null}

      {editing ? (
        <div className="edit-form">
          <h3>
            상태 변경 — {editing.assetName} / <span className="mono">{editing.cveId}</span>
          </h3>
          <div className="form-row">
            <label>
              상태
              <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={busy}>
                {allowedStatuses.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
                {!isAdmin && editing.status === "NOT_APPLICABLE" ? (
                  <option value="NOT_APPLICABLE">{statusLabel("NOT_APPLICABLE")}</option>
                ) : null}
              </select>
            </label>
            <label style={{ flex: 1 }}>
              비고 (500자 이하)
              <input type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} style={{ width: "100%" }} />
            </label>
            <button type="button" onClick={save} disabled={busy}>
              저장
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)} disabled={busy}>
              취소
            </button>
          </div>
          {!isAdmin && editing.status === "NOT_APPLICABLE" ? (
            <p className="muted small-text">&quot;해당 없음&quot; 건은 관리자만 되돌릴 수 있습니다.</p>
          ) : null}
          {status === "DONE" ? <p className="muted small-text">완료로 저장하면 완료일이 오늘로 기록됩니다.</p> : null}
        </div>
      ) : null}

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
              <th>완료일</th>
              <th>담당자</th>
              <th>비고</th>
              <th>변경</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={16} className="muted">
                  조건에 맞는 항목이 없습니다.
                </td>
              </tr>
            ) : null}
            {items.map((r) => {
              const due = r.dueDate ? new Date(r.dueDate) : null;
              const days = remainingDays(due, now);
              const overdue = isOverdue(r.status, due, now);
              return (
                <tr key={r.id} className={r.status === "NOT_APPLICABLE" ? "row-muted" : ""}>
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
                  <td className="nowrap">{formatDateKst(r.completedAt)}</td>
                  <td>{r.owner ?? "-"}</td>
                  <td className="note-cell" title={r.note ?? ""}>
                    {r.note ?? ""}
                  </td>
                  <td className="nowrap">
                    <button type="button" className="secondary small" disabled={busy} onClick={() => startEdit(r)}>
                      상태 변경
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
