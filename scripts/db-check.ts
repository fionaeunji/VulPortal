/**
 * SQL Warehouse 연결 테스트 스크립트
 * 실행: npm run db:check   (.env.local 의 값을 자동으로 읽습니다)
 *
 * 하는 일
 *  1. 환경변수 검증
 *  2. Warehouse 접속 + SELECT 1
 *  3. sql/schema.sql 실행(테이블 없으면 생성)
 *  4. 테이블 목록 출력
 */
import { authMode, closeDb, ensureSchema, ping, query } from "@/lib/db";
import { getEnv } from "@/lib/env";

async function main(): Promise<void> {
  const env = getEnv();
  console.log("1) 환경변수 확인");
  console.log(`   - 호스트: ${env.DATABRICKS_HOST}`);
  console.log(`   - 웨어하우스: ${env.DATABRICKS_WAREHOUSE_ID}`);
  console.log(`   - 카탈로그.스키마: ${env.DATABRICKS_CATALOG}.${env.DATABRICKS_SCHEMA}`);
  console.log(`   - 인증 방식: ${authMode() === "oauth" ? "서비스 프린시펄 OAuth(운영)" : "개인 토큰(로컬)"}`);

  console.log("2) Warehouse 접속 테스트 (SELECT 1) ... 웨어하우스가 꺼져 있으면 시작까지 1~5분 걸릴 수 있습니다");
  const ok = await ping();
  if (!ok) {
    console.error("   실패: 접속할 수 없습니다. 호스트/웨어하우스 ID/토큰을 확인하세요.");
    process.exitCode = 1;
    return;
  }
  console.log("   성공");

  console.log("3) 테이블 준비 (sql/schema.sql)");
  const result = await ensureSchema();
  console.log(`   성공: ${result.statements}개 문장 실행`);

  console.log("4) 테이블 목록");
  const tables = await query<{ tableName: string }>("SHOW TABLES");
  for (const t of tables) console.log(`   - ${t.tableName}`);
  console.log("연결 테스트 완료");
}

main()
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    // 토큰 등 비밀 값이 메시지에 섞이지 않도록 간단히 마스킹
    console.error("오류:", message.replace(/dapi[a-f0-9]+/gi, "[REDACTED]"));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
