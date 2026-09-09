import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { logger } from "@/lib/logger";

/**
 * API 공통 도우미.
 * - 입력은 zod 로 검증하고 실패하면 400
 * - 권한 오류는 401/403
 * - 그 밖의 오류는 서버 로그에만 상세를 남기고 사용자에게는 일반 메시지(500)
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 요청 본문(JSON)을 zod 스키마로 검증합니다. */
export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "요청 본문이 올바른 JSON 이 아닙니다");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join(".") || "(본문)").join(", ");
    throw new ApiError(400, `입력값이 올바르지 않습니다: ${fields}`);
  }
  return result.data;
}

/** URL 검색 파라미터를 zod 스키마로 검증합니다. */
export function parseSearchParams<T>(url: URL, schema: z.ZodType<T>): T {
  const result = schema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join(".") || "(파라미터)").join(", ");
    throw new ApiError(400, `조회 조건이 올바르지 않습니다: ${fields}`);
  }
  return result.data;
}

export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** 오류를 HTTP 응답으로 바꿉니다. 스택·SQL·경로는 응답에 넣지 않습니다. */
export function toErrorResponse(err: unknown, context: string): NextResponse {
  if (err instanceof AuthError || err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  logger.error(`API 오류 (${context})`, err);
  return NextResponse.json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요." }, { status: 500 });
}
