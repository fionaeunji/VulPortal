import { authMode, ping } from "@/lib/db";
import { getEnv } from "@/lib/env";

// DB 상태는 요청 때마다 확인해야 하므로 정적 생성(캐시)을 끕니다.
export const dynamic = "force-dynamic";

/** 1단계 확인용 첫 화면: 서버가 뜨고 SQL Warehouse 에 연결되는지 보여줍니다. */
export default async function Home() {
  let dbOk = false;
  let target = "";
  let mode = "";
  try {
    const env = getEnv();
    target = `${env.DATABRICKS_CATALOG}.${env.DATABRICKS_SCHEMA}`;
    mode = authMode() === "oauth" ? "서비스 프린시펄 OAuth (운영)" : "개인 토큰 (로컬)";
    dbOk = await ping();
  } catch {
    // 환경변수 오류 등: 상세 내용은 서버 로그에만 남기고 화면에는 일반 메시지만 표시
  }

  return (
    <main className="container">
      <h1>VulPortal</h1>
      <p className="muted">사내 IT 자산 취약점 관리 포털 · 1단계 골격</p>

      <section className="card">
        <h2>연결 상태</h2>
        <table className="data">
          <tbody>
            <tr>
              <th>SQL Warehouse 연결</th>
              <td>
                {dbOk ? (
                  <span className="status-ok">정상</span>
                ) : (
                  <span className="status-error">실패 — .env.local 설정과 서버 로그를 확인하세요</span>
                )}
              </td>
            </tr>
            <tr>
              <th>대상 카탈로그.스키마</th>
              <td>{target || "-"}</td>
            </tr>
            <tr>
              <th>인증 방식</th>
              <td>{mode || "-"}</td>
            </tr>
            <tr>
              <th>확인 시각</th>
              <td>{new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
