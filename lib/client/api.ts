"use client";

/**
 * 브라우저에서 API 를 호출할 때 쓰는 공통 함수.
 * - 상태를 바꾸는 요청(POST/PUT/DELETE)에 CSRF 토큰 헤더를 자동으로 붙입니다.
 * - 서버가 보낸 오류 메시지를 Error 로 바꿔 던집니다.
 */

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function readCsrfToken(): string {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta?.getAttribute("content") ?? "";
}

export async function apiFetch<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = readCsrfToken();
  }
  const response = await fetch(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "same-origin",
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "요청을 처리하지 못했습니다";
    throw new ApiClientError(response.status, message);
  }
  return data as T;
}
