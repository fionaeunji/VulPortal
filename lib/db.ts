import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { DBSQLClient, DBSQLLogger, LogLevel } from "@databricks/sql";
import type IDBSQLSession from "@databricks/sql/dist/contracts/IDBSQLSession";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Databricks SQL Warehouse 연결 모듈 (앱에서 DB 를 만지는 유일한 곳).
 *
 * - 운영(Databricks Apps): DATABRICKS_CLIENT_ID / SECRET 로 서비스 프린시펄 OAuth(M2M) 접속
 * - 로컬 개발: DATABRICKS_TOKEN(개인 액세스 토큰) 접속
 * - 모든 SQL 은 named parameter(:이름) 바인딩만 사용합니다. 문자열 연결로 SQL 을 만들지 않습니다.
 */

/** 파라미터로 넘길 수 있는 값의 종류 */
export type SqlParam = string | number | bigint | boolean | Date | null;
export type SqlParams = Record<string, SqlParam>;
export type Row = Record<string, unknown>;

/** 드라이버 내부 로그도 비밀 정보가 섞이지 않도록 우리 로거를 거칩니다. */
const driverLogger = new DBSQLLogger({ level: LogLevel.warn });

interface DbState {
  client: DBSQLClient | null;
  session: IDBSQLSession | null;
  connecting: Promise<IDBSQLSession> | null;
  schemaReady: boolean;
}

// 개발 서버(HMR)에서 모듈이 다시 로드돼도 연결이 중복 생성되지 않도록 전역에 보관합니다.
interface GlobalWithDb {
  __vulportalDb?: DbState;
}
const globalWithDb = globalThis as unknown as GlobalWithDb;
function state(): DbState {
  if (!globalWithDb.__vulportalDb) {
    globalWithDb.__vulportalDb = { client: null, session: null, connecting: null, schemaReady: false };
  }
  return globalWithDb.__vulportalDb;
}

/** 인증 방식을 환경변수에 따라 자동 선택합니다. (운영=OAuth, 로컬=PAT) */
function buildConnectOptions() {
  const env = getEnv();
  const base = {
    host: env.DATABRICKS_HOST,
    path: `/sql/1.0/warehouses/${env.DATABRICKS_WAREHOUSE_ID}`,
    userAgentEntry: "vulportal",
    socketTimeout: 120_000,
    // TLS 인증서 검증은 항상 켭니다 (API 오용 항목: TLS 검증 비활성화 금지).
    checkServerCertificate: true,
  };
  if (env.DATABRICKS_CLIENT_ID && env.DATABRICKS_CLIENT_SECRET) {
    return {
      ...base,
      authType: "databricks-oauth" as const,
      oauthClientId: env.DATABRICKS_CLIENT_ID,
      oauthClientSecret: env.DATABRICKS_CLIENT_SECRET,
    };
  }
  if (env.DATABRICKS_TOKEN) {
    return { ...base, authType: "access-token" as const, token: env.DATABRICKS_TOKEN };
  }
  throw new Error("Databricks 인증 정보가 없습니다");
}

export function authMode(): "oauth" | "pat" {
  const env = getEnv();
  return env.DATABRICKS_CLIENT_ID && env.DATABRICKS_CLIENT_SECRET ? "oauth" : "pat";
}

async function connectClient(): Promise<DBSQLClient> {
  const s = state();
  if (s.client) return s.client;
  const client = new DBSQLClient({ logger: driverLogger });
  await client.connect(buildConnectOptions());
  s.client = client;
  return client;
}

/** 세션을 하나 열어 재사용합니다. 오류가 나면 버리고 다음 호출 때 새로 엽니다. */
async function getSession(): Promise<IDBSQLSession> {
  const s = state();
  if (s.session) return s.session;
  if (s.connecting) return s.connecting;
  const env = getEnv();
  s.connecting = (async () => {
    const client = await connectClient();
    const session = await client.openSession({
      initialCatalog: env.DATABRICKS_CATALOG,
      initialSchema: env.DATABRICKS_SCHEMA,
    });
    s.session = session;
    return session;
  })();
  try {
    return await s.connecting;
  } finally {
    s.connecting = null;
  }
}

async function resetConnection(): Promise<void> {
  const s = state();
  const { session, client } = s;
  s.session = null;
  s.client = null;
  try {
    await session?.close();
  } catch {
    // 이미 끊긴 세션이면 무시
  }
  try {
    await client?.close();
  } catch {
    // 이미 끊긴 연결이면 무시
  }
}

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    /ECONN|ETIMEDOUT|EPIPE|socket hang up|Invalid SessionHandle|session .* closed|not found/i.test(msg) ||
    err.name === "HiveDriverError"
  );
}

async function run(sql: string, params: SqlParams | undefined, session: IDBSQLSession): Promise<Row[]> {
  const operation = await session.executeStatement(sql, {
    namedParameters: params,
    runAsync: true,
  });
  try {
    const rows = await operation.fetchAll();
    return rows as Row[];
  } finally {
    await operation.close();
  }
}

/**
 * SELECT 문을 실행해 행 목록을 돌려줍니다.
 * @param sql   named parameter(:이름)를 포함한 SQL. 테이블·컬럼명은 코드에 고정합니다.
 * @param params 바인딩할 값. 사용자 입력은 반드시 여기로만 전달합니다.
 */
export async function query<T extends Row = Row>(sql: string, params?: SqlParams): Promise<T[]> {
  try {
    const session = await getSession();
    return (await run(sql, params, session)) as T[];
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    // 연결이 끊긴 경우 한 번만 재연결 후 재시도
    logger.warn("DB 연결 오류로 재연결합니다", err);
    await resetConnection();
    const session = await getSession();
    return (await run(sql, params, session)) as T[];
  }
}

/** INSERT / UPDATE / MERGE / DELETE 등 결과 행이 필요 없는 문장을 실행합니다. */
export async function execute(sql: string, params?: SqlParams): Promise<void> {
  await query(sql, params);
}

/** 한 행만 필요할 때 사용합니다. 없으면 null. */
export async function queryOne<T extends Row = Row>(sql: string, params?: SqlParams): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** sql/schema.sql 을 읽어 세미콜론 단위 문장 배열로 나눕니다. (파일 경로는 코드에 고정) */
async function loadSchemaStatements(): Promise<string[]> {
  const file = path.join(process.cwd(), "sql", "schema.sql");
  const text = await fs.readFile(file, "utf8");
  const withoutComments = text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  return withoutComments
    .split(";")
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}

/**
 * 앱 시작 시 한 번 호출: 스키마와 테이블을 없으면 만듭니다 (CREATE ... IF NOT EXISTS).
 * 이미 있으면 아무 것도 바꾸지 않습니다.
 */
export async function ensureSchema(): Promise<{ statements: number }> {
  const s = state();
  const env = getEnv();
  // 스키마 생성은 initialSchema 없이 별도 세션에서 실행 (스키마가 아직 없을 수 있으므로)
  const client = await connectClient();
  const bootstrap = await client.openSession({ initialCatalog: env.DATABRICKS_CATALOG });
  try {
    try {
      await run(`CREATE SCHEMA IF NOT EXISTS \`${env.DATABRICKS_SCHEMA}\``, undefined, bootstrap);
    } catch (err) {
      // 스키마 생성 권한이 없을 수 있음. 스키마가 이미 있으면 테이블 생성은 계속 진행됩니다.
      logger.warn("스키마 생성을 건너뜁니다 (권한 없음 또는 이미 존재)", err);
    }
  } finally {
    await bootstrap.close();
  }

  const statements = await loadSchemaStatements();
  for (const stmt of statements) {
    await execute(stmt);
  }
  s.schemaReady = true;
  logger.info(`테이블 확인 완료 (${statements.length}개 문장 실행)`);
  return { statements: statements.length };
}

/** 연결 상태를 간단히 확인합니다. 오류 상세는 로그에만 남기고 호출자에게는 true/false 만 돌려줍니다. */
export async function ping(): Promise<boolean> {
  try {
    const rows = await query<{ ok: number }>("SELECT 1 AS ok");
    return rows.length === 1;
  } catch (err) {
    logger.error("DB 연결 확인 실패", err);
    return false;
  }
}

/** 프로세스 종료 시 연결을 정리합니다. */
export async function closeDb(): Promise<void> {
  await resetConnection();
}
