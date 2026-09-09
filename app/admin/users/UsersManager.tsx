"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/client/api";

interface UserItem {
  email: string;
  displayName: string | null;
  role: "ADMIN" | "VIEWER";
  isActive: boolean;
}

/** 사용자 추가·권한 변경 화면 (브라우저에서 동작). 서버 API 가 다시 한 번 권한을 검사합니다. */
export default function UsersManager({
  initialUsers,
  currentEmail,
}: {
  initialUsers: UserItem[];
  currentEmail: string;
}) {
  const [users, setUsers] = useState<UserItem[]>(initialUsers);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"ADMIN" | "VIEWER">("VIEWER");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload(): Promise<void> {
    const data = await apiFetch<{ users: UserItem[] }>("/api/users");
    setUsers(data.users);
  }

  async function save(input: UserItem): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch("/api/users", { method: "PUT", body: input });
      await reload();
      setMessage({ kind: "ok", text: `${input.email} 저장 완료` });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "저장 실패" });
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(e: FormEvent): Promise<void> {
    e.preventDefault();
    await save({ email, displayName: displayName || null, role, isActive: true });
    setEmail("");
    setDisplayName("");
    setRole("VIEWER");
  }

  return (
    <section className="card">
      <h2>사용자 추가 / 수정</h2>
      <form className="form-row" onSubmit={onAdd}>
        <label>
          이메일
          <input type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          표시 이름 (선택)
          <input type="text" maxLength={100} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label>
          권한
          <select value={role} onChange={(e) => setRole(e.target.value === "ADMIN" ? "ADMIN" : "VIEWER")}>
            <option value="VIEWER">조회자</option>
            <option value="ADMIN">관리자</option>
          </select>
        </label>
        <button type="submit" disabled={busy}>
          저장
        </button>
      </form>
      {message ? <div className={message.kind === "ok" ? "alert-ok" : "alert-error"}>{message.text}</div> : null}

      <h2>사용자 목록</h2>
      <table className="data">
        <thead>
          <tr>
            <th>이메일</th>
            <th>표시 이름</th>
            <th>권한</th>
            <th>상태</th>
            <th>변경</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                등록된 사용자가 없습니다.
              </td>
            </tr>
          ) : null}
          {users.map((u) => (
            <tr key={u.email}>
              <td>
                {u.email}
                {u.email === currentEmail ? <span className="muted"> (나)</span> : null}
              </td>
              <td>{u.displayName ?? "-"}</td>
              <td>{u.role === "ADMIN" ? "관리자" : "조회자"}</td>
              <td>{u.isActive ? "활성" : "비활성"}</td>
              <td>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => save({ ...u, role: u.role === "ADMIN" ? "VIEWER" : "ADMIN" })}
                >
                  {u.role === "ADMIN" ? "조회자로 변경" : "관리자로 변경"}
                </button>{" "}
                <button type="button" className="secondary" disabled={busy} onClick={() => save({ ...u, isActive: !u.isActive })}>
                  {u.isActive ? "비활성화" : "활성화"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
