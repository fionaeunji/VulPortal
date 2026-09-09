import Link from "next/link";
import type { CurrentUser } from "@/lib/auth";

/** 상단 메뉴. 관리자에게만 "관리자 설정" 메뉴를 보여줍니다 (실제 권한 검사는 서버에서 별도로 수행). */
export default function Nav({ user }: { user: CurrentUser | null }) {
  return (
    <header className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand">
          VulPortal
        </Link>
        <nav className="menu">
          <Link href="/">대시보드</Link>
          <Link href="/assets">자산 관리</Link>
          <Link href="/vulnerabilities">취약점 관리</Link>
          {user?.role === "ADMIN" ? <Link href="/admin/users">관리자 설정</Link> : null}
        </nav>
        <div className="user">
          {user ? (
            <>
              <span>{user.displayName}</span>
              <span className={`badge ${user.role === "ADMIN" ? "badge-admin" : "badge-viewer"}`}>
                {user.role === "ADMIN" ? "관리자" : "조회자"}
              </span>
            </>
          ) : (
            <span className="muted">로그인 정보 없음</span>
          )}
        </div>
      </div>
    </header>
  );
}
