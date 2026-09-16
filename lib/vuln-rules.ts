/**
 * 자산-취약점 관련 공통 규칙 (서버·브라우저 공용, 비밀 정보 없음).
 * 위험도·상태 표기와 조치 기한 규칙을 한 곳에 둡니다. (실제 계산은 수집 노트북이 같은 규칙으로 수행)
 */
export const SEVERITIES = ["EMERGENCY", "PRIORITY", "CAUTION"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABEL: Record<Severity, string> = { EMERGENCY: "긴급", PRIORITY: "우선", CAUTION: "주의" };

export const STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "RISK_ACCEPTED", "NOT_APPLICABLE"] as const;
export type VulnStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<VulnStatus, string> = {
  OPEN: "미조치",
  IN_PROGRESS: "진행중",
  DONE: "완료",
  RISK_ACCEPTED: "위험수용",
  NOT_APPLICABLE: "해당 없음",
};

export const MATCH_METHOD_LABEL: Record<string, string> = { CPE: "CPE 일치", FUZZY: "유사 매칭(정확도 낮음)" };

/** 조치 기한 규칙 표 (화면 안내용) */
export const DUE_RULE_TABLE: { severity: Severity; external: string; internal: string }[] = [
  { severity: "EMERGENCY", external: "72시간", internal: "6주" },
  { severity: "PRIORITY", external: "2주", internal: "6주" },
  { severity: "CAUTION", external: "1개월", internal: "3개월" },
];

export function severityLabel(value: string): string {
  return value === "EMERGENCY" || value === "PRIORITY" || value === "CAUTION" ? SEVERITY_LABEL[value] : value;
}

export function statusLabel(value: string): string {
  switch (value) {
    case "OPEN":
      return STATUS_LABEL.OPEN;
    case "IN_PROGRESS":
      return STATUS_LABEL.IN_PROGRESS;
    case "DONE":
      return STATUS_LABEL.DONE;
    case "RISK_ACCEPTED":
      return STATUS_LABEL.RISK_ACCEPTED;
    case "NOT_APPLICABLE":
      return STATUS_LABEL.NOT_APPLICABLE;
    default:
      return value;
  }
}

/** 조치가 끝나지 않은 상태인지 (기한 초과 판정 대상) */
export function isOpenStatus(status: string): boolean {
  return status === "OPEN" || status === "IN_PROGRESS";
}

/** 기한까지 남은 일수 (음수면 초과). 기한이 없으면 null */
export function remainingDays(dueDate: Date | null, now: Date = new Date()): number | null {
  if (!dueDate) return null;
  return Math.ceil((dueDate.getTime() - now.getTime()) / 86_400_000);
}

/** 기한 경과 + 미조치 = 기한 초과 */
export function isOverdue(status: string, dueDate: Date | null, now: Date = new Date()): boolean {
  return isOpenStatus(status) && dueDate !== null && dueDate.getTime() < now.getTime();
}
