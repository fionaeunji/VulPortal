import "server-only";
import { headers } from "next/headers";
import { recordAudit } from "@/lib/audit";
import { execute, queryOne } from "@/lib/db";
import { getEnv, isProduction } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * 로그인 사용자 식별과 권한 확인.
 * - Databricks Apps 가 붙여 주는 X-Forwarded-Email 헤더만 신뢰합니다.
 * - 로컬 개발(NODE_ENV != production)에서만 DEV_USER_EMAIL 로 대체합니다.
 * - users 테이블에 없는 이메일은 조회자(VIEWER)로만 접근합니다.
 */

export const ROLES = ["ADMIN", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export interface CurrentUser {
  email: string;
  displayName: string;
  role: Role;
  /** users 테이블에 등록된 사용자인지 (미등록이면 VIEWER) */
  registered: boolean;
}

export const HEADER_EMAIL = "x-forwarded-email";
export const HEADER_USERNAME = "x-forwarded-preferred-username";
export const HEADER_CLIENT_IP = "x-forwarded-for";
/** 감사 로그(로그인 성공)를 같은 사용자에 대해 다시 남기기까지의 간격 */
const LOGIN_LOG_INTERVAL_MS = 8 * 60 * 60 * 1000;
const lastLoginLogged = new Map<string, number>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

/** 요청 헤더에서 이메일을 꺼냅니다. 운영에서는 헤더만, 로컬에서는 DEV_USER_EMAIL 대체 허용. */
export function resolveEmailFromHeaders(h: Headers): string | null {
  const fromHeader = normalizeEmail(h.get(HEADER_EMAIL));
  if (fromHeader) return fromHeader;
  if (!isProduction()) {
    return normalizeEmail(getEnv().DEV_USER_EMAIL) ?? null;
  }
  return null;
}

/** 요청 IP (Databricks Apps 프록시가 넣어 주는 X-Forwarded-For 의 첫 값) */
export function clientIpFromHeaders(h: Headers): string | null {
  const raw = h.get(HEADER_CLIENT_IP);
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  return /^[0-9a-fA-F.:]{3,45}$/.test(first) ? first : null;
}

interface UserRow {
  email: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
}

/** users 테이블에서 권한을 조회합니다. 없거나 비활성이면 VIEWER. DB 오류 시에도 안전하게 VIEWER 로 처리합니다. */
async function lookupRole(email: string): Promise<{ role: Role; displayName: string | null; registered: boolean }> {
  let row: UserRow | null = null;
  try {
    row = await queryOne<UserRow>(
      "SELECT email, display_name, role, is_active FROM users WHERE email = :email LIMIT 1",
      { email },
    );
  } catch (err) {
    // 권한 조회가 실패하면 더 낮은 권한(조회자)으로 취급합니다 (실패 시 안전 원칙)
    logger.error("사용자 권한 조회 실패 — 조회자 권한으로 처리", err);
    return { role: "VIEWER", displayName: null, registered: false };
  }
  if (!row || !row.is_active) return { role: "VIEWER", displayName: row?.display_name ?? null, registered: !!row };
  const role: Role = row.role === "ADMIN" ? "ADMIN" : "VIEWER";
  return { role, displayName: row.display_name, registered: true };
}

/**
 * 현재 요청의 로그인 사용자. 서버 컴포넌트·API 핸들러에서 호출합니다.
 * 헤더가 없으면(운영) null — proxy.ts 가 이미 401 로 막지만 이중으로 확인합니다.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const h = await headers();
  const email = resolveEmailFromHeaders(h);
  if (!email) return null;
  const { role, displayName, registered } = await lookupRole(email);
  const preferred = h.get(HEADER_USERNAME)?.trim();
  const user: CurrentUser = {
    email,
    displayName: displayName ?? preferred ?? email.split("@")[0] ?? email,
    role,
    registered,
  };
  await logLoginOnce(user, clientIpFromHeaders(h));
  return user;
}

/** 같은 사용자의 로그인 성공 기록은 일정 간격으로 한 번만 남깁니다 (요청마다 쌓이지 않도록). */
async function logLoginOnce(user: CurrentUser, ip: string | null): Promise<void> {
  const now = Date.now();
  const last = lastLoginLogged.get(user.email) ?? 0;
  if (now - last < LOGIN_LOG_INTERVAL_MS) return;
  lastLoginLogged.set(user.email, now);
  await recordAudit({
    actorEmail: user.email,
    action: "LOGIN_SUCCESS",
    targetType: "USER",
    targetId: user.email,
    detail: { role: user.role, registered: user.registered },
    ipAddress: ip,
  });
}

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** 로그인 사용자를 요구합니다. 없으면 401. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401, "로그인 정보가 없습니다");
  return user;
}

/** 관리자 권한을 요구합니다. 아니면 403. (API 핸들러마다 호출) */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new AuthError(403, "관리자만 사용할 수 있습니다");
  return user;
}

/**
 * 앱 시작 시 호출: 관리자가 한 명도 없으면 INITIAL_ADMIN_EMAIL 을 관리자로 등록합니다.
 * 이미 관리자가 있으면 아무 것도 하지 않습니다.
 */
export async function ensureInitialAdmin(): Promise<void> {
  const email = normalizeEmail(getEnv().INITIAL_ADMIN_EMAIL);
  if (!email) return;
  const existing = await queryOne<{ cnt: number | bigint }>(
    "SELECT COUNT(*) AS cnt FROM users WHERE role = 'ADMIN' AND is_active = true",
  );
  if (existing && Number(existing.cnt) > 0) return;
  await execute(
    `MERGE INTO users AS t
     USING (SELECT :email AS email) AS s
     ON t.email = s.email
     WHEN MATCHED THEN UPDATE SET role = 'ADMIN', is_active = true, updated_at = current_timestamp()
     WHEN NOT MATCHED THEN INSERT (email, display_name, role, is_active, created_at, updated_at, created_by)
       VALUES (s.email, NULL, 'ADMIN', true, current_timestamp(), current_timestamp(), 'SYSTEM')`,
    { email },
  );
  logger.info("최초 관리자 계정을 등록했습니다");
}
