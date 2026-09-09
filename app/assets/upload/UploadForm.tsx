"use client";

import { useState } from "react";
import { exposureLabel } from "@/lib/asset-rules";

interface RowError {
  sheet: string;
  row: number;
  message: string;
}
interface SampleRow {
  sheet: string;
  row: number;
  assetType: string;
  assetName: string;
  vendor?: string | null;
  productName?: string | null;
  version?: string | null;
  cpe?: string | null;
  exposure: string;
  owner?: string | null;
  department?: string | null;
  ipAddress?: string | null;
  cpeGenerated: boolean;
}
interface UploadResult {
  mode: "preview" | "upsert" | "replace";
  totalRows: number;
  validRows: number;
  errors: RowError[];
  skippedSheets: string[];
  generatedCpeCount: number;
  sample: SampleRow[];
  saved?: number;
}

const MAX_BYTES = 10 * 1024 * 1024;

function readCsrfToken(): string {
  return document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ?? "";
}

/** 파일 선택 → 미리보기 → 처리 방식 선택 → 저장. 파일은 서버 메모리에서만 처리됩니다. */
export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"upsert" | "replace">("upsert");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(sendMode: "preview" | "upsert" | "replace"): Promise<void> {
    if (!file) {
      setError("파일을 선택하세요");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError(".xlsx 파일만 올릴 수 있습니다");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("파일 크기는 10MB 이하여야 합니다");
      return;
    }
    if (sendMode === "replace" && !window.confirm("기존 자산을 모두 지우고 이 파일 내용으로 교체합니다. 계속할까요?")) return;

    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("mode", sendMode);
      const response = await fetch("/api/assets/upload", {
        method: "POST",
        body: form,
        headers: { "X-CSRF-Token": readCsrfToken() },
        credentials: "same-origin",
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const msg =
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "업로드에 실패했습니다";
        setError(msg);
        // 오류가 있어도 미리보기 결과는 보여줄 수 있도록 한 번 더 요청
        if (sendMode !== "preview") await send("preview");
        return;
      }
      setResult(data as UploadResult);
    } catch {
      setError("서버와 통신하지 못했습니다");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="form-row">
        <label>
          엑셀 파일 (.xlsx)
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
          />
        </label>
        <button type="button" className="secondary" disabled={busy || !file} onClick={() => send("preview")}>
          미리보기 (검증만)
        </button>
      </div>

      {error ? <div className="alert-error">{error}</div> : null}

      {result ? (
        <>
          <h3>{result.mode === "preview" ? "미리보기 결과" : "저장 결과"}</h3>
          <table className="data summary">
            <tbody>
              <tr>
                <th>읽은 행</th>
                <td>{result.totalRows.toLocaleString()}건</td>
              </tr>
              <tr>
                <th>정상 행</th>
                <td>{result.validRows.toLocaleString()}건</td>
              </tr>
              <tr>
                <th>오류 행</th>
                <td className={result.errors.length > 0 ? "status-error" : "status-ok"}>{result.errors.length.toLocaleString()}건</td>
              </tr>
              <tr>
                <th>CPE 자동 생성</th>
                <td>{result.generatedCpeCount.toLocaleString()}건 (제조사/제품명/버전으로 생성)</td>
              </tr>
              {result.skippedSheets.length > 0 ? (
                <tr>
                  <th>건너뛴 시트</th>
                  <td>{result.skippedSheets.join(", ")} (1행 헤더가 템플릿과 달라 읽지 않음)</td>
                </tr>
              ) : null}
              {result.saved !== undefined ? (
                <tr>
                  <th>저장 완료</th>
                  <td className="status-ok">{result.saved.toLocaleString()}건 ({result.mode === "replace" ? "전체 교체" : "추가/갱신"})</td>
                </tr>
              ) : null}
            </tbody>
          </table>

          {result.errors.length > 0 ? (
            <>
              <h4 className="status-error">오류 행 (수정 후 다시 올려 주세요)</h4>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>시트</th>
                      <th>행</th>
                      <th>내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.slice(0, 200).map((e, i) => (
                      <tr key={`${e.sheet}-${e.row}-${i}`}>
                        <td>{e.sheet}</td>
                        <td>{e.row > 0 ? e.row : "-"}</td>
                        <td>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.errors.length > 200 ? <p className="muted">오류가 많아 앞 200건만 표시합니다.</p> : null}
            </>
          ) : null}

          {result.mode === "preview" && result.errors.length === 0 ? (
            <div className="form-row">
              <label>
                처리 방식
                <select value={mode} onChange={(e) => setMode(e.target.value === "replace" ? "replace" : "upsert")}>
                  <option value="upsert">추가/갱신 (자산명 기준)</option>
                  <option value="replace">전체 교체 (기존 자산 삭제 후 등록)</option>
                </select>
              </label>
              <button type="button" disabled={busy} onClick={() => send(mode)}>
                {mode === "replace" ? "전체 교체 실행" : "추가/갱신 실행"}
              </button>
            </div>
          ) : null}

          {result.sample.length > 0 ? (
            <>
              <h4>미리보기 (앞 {result.sample.length}건)</h4>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>시트</th>
                      <th>행</th>
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
                    </tr>
                  </thead>
                  <tbody>
                    {result.sample.map((r) => (
                      <tr key={`${r.sheet}-${r.row}`}>
                        <td>{r.sheet}</td>
                        <td>{r.row}</td>
                        <td>{r.assetType}</td>
                        <td>{r.assetName}</td>
                        <td>{r.vendor ?? "-"}</td>
                        <td>{r.productName ?? "-"}</td>
                        <td>{r.version ?? "-"}</td>
                        <td className="mono">{r.cpe ?? (r.cpeGenerated ? "(자동 생성)" : "-")}</td>
                        <td>{exposureLabel(r.exposure)}</td>
                        <td>{r.owner ?? "-"}</td>
                        <td>{r.department ?? "-"}</td>
                        <td>{r.ipAddress ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
