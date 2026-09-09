import "server-only";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Databricks Jobs API 호출 (수집 Job "지금 수동 실행").
 * - URL 은 환경변수 호스트 + 코드에 고정된 경로만 사용합니다.
 * - 운영: 서비스 프린시펄 OAuth 토큰, 로컬: 개인 토큰.
 * - 타임아웃 30초, 재시도 3회 (네트워크 오류·5xx 만 재시도).
 */

const TIMEOUT_MS = 30_000;
const RETRIES = 3;

let cachedToken: { value: string; expiresAt: number } | null = null;

/** 서비스 프린시펄 OAuth(M2M) 토큰을 받아 캐시합니다. 토큰 값은 로그에 남기지 않습니다. */
async function getOAuthToken(): Promise<string> {
  const env = getEnv();
  if (!env.DATABRICKS_CLIENT_ID || !env.DATABRICKS_CLIENT_SECRET) throw new Error("OAuth 자격증명 없음");
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const body = new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis" });
  const basic = Buffer.from(`${env.DATABRICKS_CLIENT_ID}:${env.DATABRICKS_CLIENT_SECRET}`).toString("base64");
  const response = await fetchWithRetry(`https://${env.DATABRICKS_HOST}/oidc/v1/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`OAuth 토큰 발급 실패 (HTTP ${response.status})`);
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("OAuth 토큰 응답 형식 오류");
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function getBearerToken(): Promise<string> {
  const env = getEnv();
  if (env.DATABRICKS_CLIENT_ID && env.DATABRICKS_CLIENT_SECRET) return getOAuthToken();
  if (env.DATABRICKS_TOKEN) return env.DATABRICKS_TOKEN;
  throw new Error("Databricks 인증 정보가 없습니다");
}

/** fetch 에 타임아웃과 재시도를 붙입니다. 4xx 는 재시도하지 않습니다. */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.status >= 500 || response.status === 429) {
        lastError = new Error(`HTTP ${response.status}`);
      } else {
        return response;
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  throw lastError instanceof Error ? lastError : new Error("요청 실패");
}

/** 수집 Job 을 즉시 실행하고 run_id 를 돌려줍니다 (POST /api/2.2/jobs/run-now). */
export async function runSyncJobNow(triggeredBy: string): Promise<{ runId: string }> {
  const env = getEnv();
  if (!env.SYNC_JOB_ID) throw new Error("SYNC_JOB_ID 환경변수가 없습니다");
  const token = await getBearerToken();
  const response = await fetchWithRetry(`https://${env.DATABRICKS_HOST}/api/2.2/jobs/run-now`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: Number(env.SYNC_JOB_ID),
      job_parameters: { triggered_by: triggeredBy },
    }),
  });
  if (!response.ok) {
    logger.error(`Jobs API run-now 실패 (HTTP ${response.status})`);
    throw new Error(`수집 Job 실행 요청 실패 (HTTP ${response.status})`);
  }
  const data = (await response.json()) as { run_id?: number };
  if (typeof data.run_id !== "number") throw new Error("Jobs API 응답 형식 오류");
  return { runId: String(data.run_id) };
}

/** 수동 실행 버튼을 쓸 수 있는지 (Job ID 설정 여부) */
export function isSyncJobConfigured(): boolean {
  return Boolean(getEnv().SYNC_JOB_ID);
}
