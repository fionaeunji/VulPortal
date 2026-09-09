import "server-only";
import { randomUUID } from "node:crypto";
import { execute } from "@/lib/db";
import { logger } from "@/lib/logger";

/** 감사 로그에 남기는 행위 종류 (코드에 고정) */
export type AuditAction =
  | "LOGIN_SUCCESS"
  | "LOGIN_DENIED"
  | "USER_CHANGE"
  | "ASSET_DELETE"
  | "ASSET_REPLACE_ALL"
  | "ASSET_UPSERT"
  | "STATUS_CHANGE"
  | "SYNC_RUN";

export interface AuditEntry {
  actorEmail: string;
  action: AuditAction;
  targetType?: "ASSET" | "ASSET_VULNERABILITY" | "USER" | "SYNC";
  targetId?: string;
  /** 추가 정보. 비밀번호·토큰 등 비밀 값은 절대 넣지 않습니다. */
  detail?: Record<string, string | number | boolean | null>;
  ipAddress?: string | null;
}

/** 감사 로그 1건 기록. 기록 실패가 본 작업을 막지 않도록 오류는 서버 로그에만 남깁니다. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await execute(
      `INSERT INTO audit_logs (id, occurred_at, actor_email, action, target_type, target_id, detail, ip_address)
       VALUES (:id, current_timestamp(), :actorEmail, :action, :targetType, :targetId, :detail, :ipAddress)`,
      {
        id: randomUUID(),
        actorEmail: entry.actorEmail,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        detail: entry.detail ? JSON.stringify(entry.detail) : null,
        ipAddress: entry.ipAddress ?? null,
      },
    );
  } catch (err) {
    logger.error(`감사 로그 기록 실패 (${entry.action})`, err);
  }
}
