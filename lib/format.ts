/**
 * 날짜·시각 표시 도우미. 화면 표시는 항상 KST(Asia/Seoul) 기준입니다.
 * DB 드라이버가 TIMESTAMP 를 문자열 또는 Date 로 돌려줄 수 있어 둘 다 처리합니다.
 */
const KST = "Asia/Seoul";

export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.length > 0) {
    // Databricks 는 "2026-09-09 05:00:00.000" 형식(UTC)으로 줄 수 있어 ISO 로 바꿔 해석합니다.
    const normalized = /^\d{4}-\d{2}-\d{2} /.test(value) ? `${value.replace(" ", "T")}Z` : value;
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "number") return new Date(value);
  return null;
}

/** YYYY-MM-DD (KST) */
export function formatDateKst(value: unknown): string {
  const d = toDate(value);
  if (!d) return "-";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** YYYY-MM-DD HH:mm (KST) */
export function formatDateTimeKst(value: unknown): string {
  const d = toDate(value);
  if (!d) return "-";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
