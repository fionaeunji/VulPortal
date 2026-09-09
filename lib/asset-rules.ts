/**
 * 자산 관련 공통 규칙 (서버·브라우저 공용, 비밀 정보 없음).
 * 허용 값 목록과 CPE 자동 생성 규칙을 한 곳에 둡니다.
 */
export const ASSET_TYPES = ["서버", "NW장비", "보안시스템", "스토리지", "클라우드자산", "기타"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const EXPOSURES = ["EXTERNAL", "INTERNAL"] as const;
export type Exposure = (typeof EXPOSURES)[number];

export const EXPOSURE_LABEL: Record<Exposure, string> = { EXTERNAL: "경계면", INTERNAL: "내부" };

/** 내부 값을 화면 표기로 바꿉니다. 모르는 값은 그대로 보여줍니다. */
export function exposureLabel(value: string): string {
  if (value === "EXTERNAL") return EXPOSURE_LABEL.EXTERNAL;
  if (value === "INTERNAL") return EXPOSURE_LABEL.INTERNAL;
  return value;
}

/** 화면·엑셀에서 쓰는 한글 표기를 내부 값으로 바꿉니다. 영문 값도 허용합니다. */
export function parseExposure(raw: string): Exposure | null {
  const v = raw.trim().toUpperCase();
  if (v === "경계면" || v === "EXTERNAL" || v === "외부") return "EXTERNAL";
  if (v === "내부" || v === "INTERNAL") return "INTERNAL";
  return null;
}

/** CPE 2.3 문자열 형식 검사: cpe:2.3:{part}:{vendor}:...  콜론으로 나눈 요소가 13개, 모두 비어 있지 않아야 합니다. */
export function isValidCpe(value: string): boolean {
  if (value.length > 500 || /\s/.test(value)) return false;
  const parts = value.split(":");
  if (parts.length !== 13) return false;
  if (parts[0]?.toLowerCase() !== "cpe" || parts[1] !== "2.3") return false;
  const part = parts[2] ?? "";
  if (!["a", "h", "o", "*", "-"].includes(part.toLowerCase())) return false;
  return parts.slice(3).every((p) => p.length > 0);
}

/** CPE 구성 요소에 쓸 수 있도록 소문자·밑줄 형태로 바꿉니다. */
function cpeComponent(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  if (v.length === 0) return "*";
  // 공백은 밑줄, CPE 에서 특별한 뜻이 있는 문자는 백슬래시로 이스케이프
  return v.replace(/\s+/g, "_").replace(/([:*?\\])/g, "\\$1");
}

/** 제조사/제품명/버전으로 CPE 를 만듭니다. 형식: cpe:2.3:a:{제조사}:{제품명}:{버전}:*:*:*:*:*:*:* */
export function generateCpe(vendor: string | null, productName: string | null, version: string | null): string | null {
  if (!vendor?.trim() || !productName?.trim()) return null;
  return `cpe:2.3:a:${cpeComponent(vendor)}:${cpeComponent(productName)}:${cpeComponent(version)}:*:*:*:*:*:*:*`;
}

/** 엑셀 템플릿 1행 헤더 (순서 고정) */
export const EXCEL_HEADERS = [
  "자산유형",
  "자산명",
  "제조사",
  "제품명",
  "버전",
  "CPE",
  "노출구분(경계면/내부)",
  "담당자",
  "담당부서",
  "IP",
] as const;
