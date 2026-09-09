/**
 * Next.js 서버가 시작될 때 한 번 실행되는 초기화 코드입니다.
 * 여기서 sql/schema.sql 의 CREATE TABLE IF NOT EXISTS 를 실행해 테이블을 준비합니다.
 * (Edge 런타임에서는 실행되지 않도록 Node.js 런타임에서만 동작합니다.)
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureSchema } = await import("@/lib/db");
  const { logger } = await import("@/lib/logger");
  try {
    await ensureSchema();
  } catch (err) {
    // 시작 시 DB 오류가 있어도 서버는 뜨게 두고, 화면에서 연결 상태를 보여줍니다.
    logger.error("앱 시작 시 테이블 준비 실패", err);
  }
}
