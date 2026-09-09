import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** 관리자 설정 첫 화면 */
export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return (
      <main className="container">
        <h1>관리자 설정</h1>
        <div className="alert-error">관리자만 접근할 수 있는 화면입니다.</div>
      </main>
    );
  }
  return (
    <main className="container">
      <h1>관리자 설정</h1>
      <div className="grid-2">
        <Link href="/admin/sync" className="card link-card">
          <h2>취약점 수집</h2>
          <p className="muted">지금 수동 실행, 수집 이력(SyncLog) 조회</p>
        </Link>
        <Link href="/admin/users" className="card link-card">
          <h2>사용자 관리</h2>
          <p className="muted">관리자/조회자 권한 부여, 비활성화</p>
        </Link>
      </div>
    </main>
  );
}
