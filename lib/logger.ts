import "server-only";

/**
 * 서버 전용 로거.
 * - 토큰/비밀키처럼 보이는 문자열은 마스킹한 뒤 기록합니다.
 * - 사용자에게는 이 로그를 절대 그대로 보여주지 않습니다 (에러처리 항목).
 */

const SECRET_PATTERNS: RegExp[] = [
  /dapi[a-f0-9]{32,}/gi, // Databricks PAT
  /dose[a-f0-9]{32,}/gi, // Databricks OAuth secret
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /(client_secret|token|password|api[_-]?key)\s*[=:]\s*\S+/gi,
];

function redact(text: string): string {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, "[REDACTED]"), text);
}

function serializeError(err: unknown): string {
  if (err instanceof Error) {
    return redact(`${err.name}: ${err.message}`);
  }
  return redact(String(err));
}

function write(level: "INFO" | "WARN" | "ERROR", message: string, err?: unknown): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${level} ${redact(message)}${err === undefined ? "" : ` | ${serializeError(err)}`}`;
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (message: string) => write("INFO", message),
  warn: (message: string, err?: unknown) => write("WARN", message, err),
  error: (message: string, err?: unknown) => write("ERROR", message, err),
};
