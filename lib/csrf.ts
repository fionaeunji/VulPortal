import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * CSRF(사이트 간 요청 위조) 방지용 토큰 처리.
 * 방식: "이중 제출 쿠키" — 서버가 준 토큰을 쿠키(httpOnly)와 요청 헤더에 각각 담아 보내면
 * 둘이 같은지 비교합니다. 다른 사이트에서는 헤더 값을 알 수 없어 위조가 불가능합니다.
 */
export const CSRF_COOKIE = "vp_csrf";
export const CSRF_HEADER = "x-csrf-token";
const TOKEN_BYTES = 32;

/** 새 토큰 생성 (암호학적 난수 사용, Math.random 금지) */
export function createCsrfToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/** 토큰 형식 검사: 64자리 16진수만 허용 */
export function isValidTokenFormat(token: string | null | undefined): token is string {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

/** 두 토큰이 같은지 시간 차 공격에 안전하게 비교 */
export function csrfTokensMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!isValidTokenFormat(a) || !isValidTokenFormat(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** 상태를 바꾸는 HTTP 메서드인지 (이 메서드들만 CSRF 검사 대상) */
export function isStateChangingMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}
