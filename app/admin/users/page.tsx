import { getCurrentUser } from "@/lib/auth";
import { listUsers, type UserRecord } from "@/lib/users";
import UsersManager from "./UsersManager";

export const dynamic = "force-dynamic";

/** 관리자 설정 > 사용자 관리. 서버에서 권한을 확인해 관리자가 아니면 내용을 보여주지 않습니다. */
export default async function UsersAdminPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return (
      <main className="container">
        <h1>관리자 설정</h1>
        <div className="alert-error">관리자만 접근할 수 있는 화면입니다.</div>
      </main>
    );
  }
  let users: UserRecord[] = [];
  let loadError = false;
  try {
    users = await listUsers();
  } catch {
    loadError = true;
  }
  return (
    <main className="container">
      <h1>관리자 설정 · 사용자 관리</h1>
      <p className="muted">
        여기에 등록되지 않은 사용자는 자동으로 &quot;조회자&quot; 권한으로만 접근합니다. 관리자 권한은 여기서만
        부여할 수 있습니다.
      </p>
      {loadError ? <div className="alert-error">사용자 목록을 불러오지 못했습니다.</div> : null}
      <UsersManager
        initialUsers={users.map((u) => ({
          email: u.email,
          displayName: u.displayName,
          role: u.role,
          isActive: u.isActive,
        }))}
        currentEmail={user.email}
      />
    </main>
  );
}
