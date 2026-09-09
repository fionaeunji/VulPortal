"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ASSET_TYPES, EXPOSURES, exposureLabel } from "@/lib/asset-rules";
import { apiFetch } from "@/lib/client/api";

export interface AssetItem {
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
}

/** 자산 목록 표 + 개별 수정/삭제 (관리자). 서버 API 가 권한과 입력을 다시 검사합니다. */
export default function AssetTable({ items, isAdmin }: { items: AssetItem[]; isAdmin: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AssetItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function onDelete(item: AssetItem): Promise<void> {
    if (!window.confirm(`자산 '${item.assetName}' 을(를) 삭제할까요? 매칭된 취약점 정보도 함께 삭제됩니다.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch(`/api/assets/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      setMessage({ kind: "ok", text: `'${item.assetName}' 삭제 완료` });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "삭제 실패" });
    } finally {
      setBusy(false);
    }
  }

  async function onSave(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!editing) return;
    const form = new FormData(e.currentTarget);
    const body = {
      assetType: String(form.get("assetType") ?? ""),
      assetName: String(form.get("assetName") ?? ""),
      vendor: String(form.get("vendor") ?? ""),
      productName: String(form.get("productName") ?? ""),
      version: String(form.get("version") ?? ""),
      cpe: String(form.get("cpe") ?? ""),
      exposure: String(form.get("exposure") ?? ""),
      owner: String(form.get("owner") ?? ""),
      department: String(form.get("department") ?? ""),
      ipAddress: String(form.get("ipAddress") ?? ""),
    };
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch(`/api/assets/${encodeURIComponent(editing.id)}`, { method: "PUT", body });
      setMessage({ kind: "ok", text: `'${body.assetName}' 저장 완료` });
      setEditing(null);
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "저장 실패" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      {message ? <div className={message.kind === "ok" ? "alert-ok" : "alert-error"}>{message.text}</div> : null}

      {editing ? (
        <form className="edit-form" onSubmit={onSave}>
          <h3>자산 수정</h3>
          <div className="form-row">
            <label>
              자산유형
              <select name="assetType" defaultValue={editing.assetType}>
                {ASSET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              자산명 *
              <input type="text" name="assetName" required maxLength={200} defaultValue={editing.assetName} />
            </label>
            <label>
              노출구분
              <select name="exposure" defaultValue={editing.exposure}>
                {EXPOSURES.map((x) => (
                  <option key={x} value={x}>
                    {exposureLabel(x)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              제조사
              <input type="text" name="vendor" maxLength={200} defaultValue={editing.vendor ?? ""} />
            </label>
            <label>
              제품명
              <input type="text" name="productName" maxLength={200} defaultValue={editing.productName ?? ""} />
            </label>
            <label>
              버전
              <input type="text" name="version" maxLength={100} defaultValue={editing.version ?? ""} />
            </label>
          </div>
          <div className="form-row">
            <label>
              CPE (비우면 자동 생성)
              <input type="text" name="cpe" maxLength={500} defaultValue={editing.cpeSource === "INPUT" ? (editing.cpe ?? "") : ""} />
            </label>
            <label>
              담당자
              <input type="text" name="owner" maxLength={100} defaultValue={editing.owner ?? ""} />
            </label>
            <label>
              담당부서
              <input type="text" name="department" maxLength={100} defaultValue={editing.department ?? ""} />
            </label>
            <label>
              IP
              <input type="text" name="ipAddress" maxLength={64} defaultValue={editing.ipAddress ?? ""} />
            </label>
          </div>
          <div className="form-row">
            <button type="submit" disabled={busy}>
              저장
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(null)}>
              취소
            </button>
          </div>
        </form>
      ) : null}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>자산유형</th>
              <th>자산명</th>
              <th>제조사</th>
              <th>제품명</th>
              <th>버전</th>
              <th>CPE</th>
              <th>노출구분</th>
              <th>담당자</th>
              <th>담당부서</th>
              <th>IP</th>
              {isAdmin ? <th>관리</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 11 : 10} className="muted">
                  자산이 없습니다. 템플릿을 내려받아 엑셀로 등록하세요.
                </td>
              </tr>
            ) : null}
            {items.map((a) => (
              <tr key={a.id}>
                <td>{a.assetType}</td>
                <td>{a.assetName}</td>
                <td>{a.vendor ?? "-"}</td>
                <td>{a.productName ?? "-"}</td>
                <td>{a.version ?? "-"}</td>
                <td className="mono">
                  {a.cpe ?? "-"}
                  {a.cpeSource === "GENERATED" ? <span className="badge badge-viewer">자동</span> : null}
                </td>
                <td>{exposureLabel(a.exposure)}</td>
                <td>{a.owner ?? "-"}</td>
                <td>{a.department ?? "-"}</td>
                <td>{a.ipAddress ?? "-"}</td>
                {isAdmin ? (
                  <td className="nowrap">
                    <button type="button" className="secondary small" disabled={busy} onClick={() => setEditing(a)}>
                      수정
                    </button>{" "}
                    <button type="button" className="danger small" disabled={busy} onClick={() => onDelete(a)}>
                      삭제
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
