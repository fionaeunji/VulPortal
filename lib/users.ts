import "server-only";
import { z } from "zod";
import { ROLES, type Role } from "@/lib/auth";
import { execute, query } from "@/lib/db";

/** 사용자 관리 (관리자 전용 기능에서 사용) */

export interface UserRecord {
  email: string;
  displayName: string | null;
  role: Role;
  isActive: boolean;
  createdAt: unknown;
  updatedAt: unknown;
  createdBy: string | null;
}

interface UserRow {
  email: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  created_at: unknown;
  updated_at: unknown;
  created_by: string | null;
}

function toRecord(row: UserRow): UserRecord {
  return {
    email: row.email,
    displayName: row.display_name,
    role: row.role === "ADMIN" ? "ADMIN" : "VIEWER",
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

export async function listUsers(): Promise<UserRecord[]> {
  const rows = await query<UserRow>(
    `SELECT email, display_name, role, is_active, created_at, updated_at, created_by
     FROM users ORDER BY role, email`,
  );
  return rows.map(toRecord);
}

/** 사용자 등록/수정 입력 검증 규칙 */
export const upsertUserSchema = z.object({
  email: z.email("이메일 형식이 아닙니다").max(254).transform((v) => v.trim().toLowerCase()),
  displayName: z.string().trim().max(100).optional().nullable(),
  role: z.enum(ROLES),
  isActive: z.boolean().default(true),
});
export type UpsertUserInput = z.infer<typeof upsertUserSchema>;

/** 이메일 기준으로 있으면 수정, 없으면 추가 (MERGE INTO) */
export async function upsertUser(input: UpsertUserInput, actorEmail: string): Promise<void> {
  await execute(
    `MERGE INTO users AS t
     USING (SELECT :email AS email) AS s
     ON t.email = s.email
     WHEN MATCHED THEN UPDATE SET
       display_name = :displayName, role = :role, is_active = :isActive, updated_at = current_timestamp()
     WHEN NOT MATCHED THEN INSERT (email, display_name, role, is_active, created_at, updated_at, created_by)
       VALUES (s.email, :displayName, :role, :isActive, current_timestamp(), current_timestamp(), :actor)`,
    {
      email: input.email,
      displayName: input.displayName ?? null,
      role: input.role,
      isActive: input.isActive,
      actor: actorEmail,
    },
  );
}

/** 활성 관리자 수 (마지막 관리자 강등 방지용) */
export async function countActiveAdmins(): Promise<number> {
  const rows = await query<{ cnt: number | bigint }>(
    "SELECT COUNT(*) AS cnt FROM users WHERE role = 'ADMIN' AND is_active = true",
  );
  return Number(rows[0]?.cnt ?? 0);
}
