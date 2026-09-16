import "server-only";
import ExcelJS from "exceljs";

/**
 * 엑셀 Export 공통 모듈.
 * - 문자열 셀은 =, +, -, @ 로 시작하면 앞에 ' 를 붙여 수식으로 해석되지 않게 합니다 (수식 삽입 방지).
 * - 파일은 메모리에서 만들어 바로 응답으로 보내고 서버에 저장하지 않습니다.
 */

export type CellValue = string | number | boolean | Date | null | undefined;

export interface SheetSpec {
  /** 시트 이름 (31자 이하, 엑셀 금지 문자 제외) */
  name: string;
  headers: string[];
  rows: CellValue[][];
}

/** 수식 삽입 방지: 위험 문자로 시작하는 문자열 앞에 ' 를 붙입니다. */
export function safeCell(value: CellValue): CellValue {
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

function safeSheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
}

/** 시트 여러 개로 된 .xlsx 를 만듭니다. */
export async function buildWorkbook(sheets: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "VulPortal";
  wb.created = new Date();
  for (const spec of sheets) {
    const ws = wb.addWorksheet(safeSheetName(spec.name));
    ws.addRow(spec.headers.map(safeCell));
    ws.getRow(1).font = { bold: true };
    for (const row of spec.rows) {
      ws.addRow(row.map((v) => safeCell(v) ?? null));
    }
    ws.columns.forEach((col, i) => {
      const header = spec.headers.at(i) ?? "";
      col.width = Math.min(60, Math.max(12, header.length * 2 + 4));
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** 다운로드 응답 헤더 (파일명은 호출하는 코드에서 고정값으로 넘깁니다) */
export function xlsxHeaders(asciiName: string, koreanName: string): Record<string, string> {
  return {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(koreanName)}`,
    "Cache-Control": "no-store",
  };
}
