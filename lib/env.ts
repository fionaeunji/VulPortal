import "server-only";
import { z } from "zod";

/**
 * 서버 환경변수를 한 곳에서 검증합니다.
 * - 운영(Databricks Apps): DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET (서비스 프린시펄 OAuth)
 * - 로컬 개발: DATABRICKS_TOKEN (개인 액세스 토큰)
 * 비밀 값은 이 모듈 밖으로 로그·응답에 절대 내보내지 않습니다.
 */

// Unity Catalog 식별자(카탈로그/스키마)는 SQL 에 그대로 들어가므로 허용 문자를 엄격히 제한합니다.
const identifier = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,62}$/, "소문자·숫자·밑줄만 허용됩니다");

const hostSchema = z
  .string()
  .min(1)
  .transform((raw) => raw.replace(/^https?:\/\//, "").replace(/\/+$/, ""))
  .refine((h) => /^[a-z0-9.-]+$/.test(h), "DATABRICKS_HOST 형식이 올바르지 않습니다");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABRICKS_HOST: hostSchema,
  DATABRICKS_WAREHOUSE_ID: z.string().regex(/^[a-z0-9]+$/, "웨어하우스 ID 형식 오류"),
  DATABRICKS_CATALOG: identifier.default("main"),
  DATABRICKS_SCHEMA: identifier.default("vuln_portal"),
  DATABRICKS_TOKEN: z.string().min(1).optional(),
  DATABRICKS_CLIENT_ID: z.string().min(1).optional(),
  DATABRICKS_CLIENT_SECRET: z.string().min(1).optional(),
  DEV_USER_EMAIL: z.email().optional(),
  /** 취약점 수집 Job 의 ID (databricks bundle deploy 후 Databricks 화면에서 확인). 없으면 수동 실행 버튼 비활성 */
  SYNC_JOB_ID: z.string().regex(/^[0-9]+$/, "SYNC_JOB_ID 는 숫자여야 합니다").optional(),
  INITIAL_ADMIN_EMAIL: z.email().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** 환경변수를 검증해 돌려줍니다. 잘못되면 어떤 항목이 문제인지(값은 제외) 알려주는 오류를 냅니다. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`환경변수 설정 오류: ${fields}`);
  }
  const env = parsed.data;
  if (!env.DATABRICKS_TOKEN && !(env.DATABRICKS_CLIENT_ID && env.DATABRICKS_CLIENT_SECRET)) {
    throw new Error(
      "환경변수 설정 오류: DATABRICKS_TOKEN(로컬) 또는 DATABRICKS_CLIENT_ID/SECRET(운영) 중 하나가 필요합니다",
    );
  }
  cached = env;
  return env;
}

/** 운영 빌드 여부. 운영에서는 DEV_USER_EMAIL 등 개발 편의 기능을 모두 끕니다. */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
