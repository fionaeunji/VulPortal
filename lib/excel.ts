import "server-only";
import ExcelJS from "exceljs";
import { z } from "zod";
import { EXCEL_HEADERS, parseExposure, ASSET_TYPES } from "@/lib/asset-rules";
import { assetInputSchema, type AssetInput } from "@/lib/assets";

/**
 * 엑셀 업로드 파싱 / 템플릿 생성.
 * - 파일은 메모리에서만 처리하고 디스크에 저장하지 않습니다.
 * - 수식 셀은 계산 결과 값만 읽고, =, +, -, @ 로 시작하는 문자열은 앞에 ' 를 붙입니다 (수식 삽입 방지).
 * - 여러 시트가 있으면 헤더가 맞는 시트를 모두 읽고, 자산명이 겹치면 시트·행 번호를 알려줍니다.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_ROWS = 20_000;
const ALLOWED_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream", // 일부 브라우저가 이렇게 보냄. 확장자·파일 서명으로 추가 확인
]);

export interface RowError {
  sheet: string;
  row: number;
  message: string;
}

export interface ParsedRow {
  sheet: string;
  row: number;
  input: AssetInput;
  cpeGenerated: boolean;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: RowError[];
  skippedSheets: string[];
  totalRows: number;
}

/** 파일 확장자·MIME·크기 검사 (파일 서명은 parseAssetWorkbook 에서 추가 확인) */
export function validateUploadFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".xlsx")) return ".xlsx 파일만 업로드할 수 있습니다";
  if (file.size === 0) return "빈 파일입니다";
  if (file.size > MAX_FILE_BYTES) return "파일 크기는 10MB 이하여야 합니다";
  if (file.type && !ALLOWED_MIME.has(file.type)) return "엑셀(.xlsx) 형식이 아닙니다";
  return null;
}

/** .xlsx 는 ZIP 형식이므로 파일 앞 4바이트가 PK\x03\x04 여야 합니다. */
function isXlsxSignature(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

/** 수식 삽입 방지: =, +, -, @ 또는 탭/캐리지리턴으로 시작하면 앞에 ' 를 붙입니다. */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** 제어 문자 제거 + 앞뒤 공백 제거 + 수식 무력화 */
function clean(text: string): string {
  const stripped = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return neutralizeFormula(stripped);
}

/** 셀 값을 안전한 문자열로 바꿉니다 (수식은 결과만, 서식 객체는 텍스트만). */
function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return clean(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) return clean(value.richText.map((r) => r.text).join(""));
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as ExcelJS.CellFormulaValue).result;
      return result === undefined || result === null ? "" : cellToText(result as ExcelJS.CellValue);
    }
    if ("hyperlink" in value) return clean(String(value.text ?? ""));
    if ("error" in value) return "";
  }
  return "";
}

/** 헤더 행이 템플릿과 같은지 확인 (공백 무시) */
function headerMatches(cells: string[]): boolean {
  const norm = (s: string) => s.replace(/\s+/g, "");
  return EXCEL_HEADERS.every((h, i) => norm(cells.at(i) ?? "") === norm(h));
}

/** 업로드된 엑셀을 읽어 검증합니다. DB 에는 쓰지 않습니다. */
export async function parseAssetWorkbook(buffer: Buffer): Promise<ParseResult> {
  if (!isXlsxSignature(buffer)) {
    return {
      rows: [],
      errors: [{ sheet: "-", row: 0, message: "엑셀(.xlsx) 파일이 아닙니다" }],
      skippedSheets: [],
      totalRows: 0,
    };
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return {
      rows: [],
      errors: [{ sheet: "-", row: 0, message: "엑셀 파일을 읽을 수 없습니다 (손상되었거나 암호가 걸려 있음)" }],
      skippedSheets: [],
      totalRows: 0,
    };
  }

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const skippedSheets: string[] = [];
  const seen = new Map<string, { sheet: string; row: number }>();
  let totalRows = 0;

  for (const sheet of workbook.worksheets) {
    const sheetName = clean(sheet.name).slice(0, 60);
    const headerCells: string[] = [];
    for (let i = 1; i <= EXCEL_HEADERS.length; i += 1) {
      headerCells.push(cellToText(sheet.getRow(1).getCell(i).value));
    }
    if (!headerMatches(headerCells)) {
      skippedSheets.push(sheetName);
      continue;
    }

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const cells = EXCEL_HEADERS.map((_, i) => cellToText(row.getCell(i + 1).value));
      if (cells.every((c) => c.length === 0)) return; // 빈 행
      totalRows += 1;
      if (totalRows > MAX_ROWS) return;

      const [assetType, assetName, vendor, productName, version, cpe, exposureRaw, owner, department, ip] = cells;
      const exposure = parseExposure(exposureRaw ?? "");
      const candidate = {
        assetType,
        assetName,
        vendor,
        productName,
        version,
        cpe,
        exposure: exposure ?? "",
        owner,
        department,
        ipAddress: ip,
      };
      const parsed = assetInputSchema.safeParse(candidate);
      if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => describeIssue(i)).join("; ");
        errors.push({ sheet: sheetName, row: rowNumber, message: msg });
        return;
      }
      const key = parsed.data.assetName.toLowerCase();
      const dup = seen.get(key);
      if (dup) {
        errors.push({
          sheet: sheetName,
          row: rowNumber,
          message: `자산명 '${parsed.data.assetName}' 중복 — 시트 '${dup.sheet}' ${dup.row}행에 이미 있습니다`,
        });
        return;
      }
      seen.set(key, { sheet: sheetName, row: rowNumber });
      rows.push({ sheet: sheetName, row: rowNumber, input: parsed.data, cpeGenerated: !parsed.data.cpe });
    });
  }

  if (totalRows > MAX_ROWS) {
    errors.unshift({
      sheet: "-",
      row: 0,
      message: `행 수가 ${MAX_ROWS.toLocaleString()}건을 넘습니다. 파일을 나눠 올려 주세요`,
    });
  }
  if (rows.length === 0 && errors.length === 0) {
    errors.push({
      sheet: "-",
      row: 0,
      message: "읽을 수 있는 자산 행이 없습니다. 1행 헤더가 템플릿과 같은지 확인하세요",
    });
  }
  return { rows, errors, skippedSheets, totalRows };
}

const FIELD_LABEL = new Map<string, string>([
  ["assetType", "자산유형"],
  ["assetName", "자산명"],
  ["vendor", "제조사"],
  ["productName", "제품명"],
  ["version", "버전"],
  ["cpe", "CPE"],
  ["exposure", "노출구분"],
  ["owner", "담당자"],
  ["department", "담당부서"],
  ["ipAddress", "IP"],
]);

/** zod 오류를 담당자가 읽을 수 있는 한글 문장으로 바꿉니다. */
function describeIssue(issue: z.core.$ZodIssue): string {
  const field = String(issue.path[0] ?? "");
  const name = FIELD_LABEL.get(field) ?? field;
  if (field === "assetType") return `자산유형 오류 (허용: ${ASSET_TYPES.join(", ")})`;
  if (field === "exposure") return "노출구분 오류 (허용: 경계면, 내부)";
  if (issue.code === "too_big") return `${name} 길이 초과`;
  if (issue.code === "too_small") return `${name} 누락`;
  return `${name}: ${issue.message}`;
}

/** 자산 업로드 템플릿(.xlsx) 생성. 1행 헤더 + 예시 2행 + 안내 시트 */
export async function buildAssetTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "VulPortal";
  const ws = wb.addWorksheet("자산");
  ws.addRow([...EXCEL_HEADERS]);
  ws.getRow(1).font = { bold: true };
  ws.addRow(["서버", "web-prod-01", "Apache", "HTTP Server", "2.4.58", "", "경계면", "홍길동", "인프라팀", "10.0.1.10"]);
  ws.addRow([
    "NW장비",
    "fw-core-01",
    "Fortinet",
    "FortiOS",
    "7.2.5",
    "cpe:2.3:o:fortinet:fortios:7.2.5:*:*:*:*:*:*:*",
    "경계면",
    "김철수",
    "보안팀",
    "10.0.0.1",
  ]);
  ws.columns.forEach((col) => {
    col.width = 22;
  });

  const guide = wb.addWorksheet("작성안내");
  guide.addRow(["항목", "설명"]);
  guide.getRow(1).font = { bold: true };
  guide.addRow(["자산유형", `다음 중 하나: ${ASSET_TYPES.join(", ")}`]);
  guide.addRow(["자산명", "필수. 호스트명 등 고유한 이름. 추가/갱신 시 이 값으로 같은 자산을 찾습니다"]);
  guide.addRow(["제조사/제품명/버전", "CPE 가 없을 때 자동 생성과 유사 매칭에 사용됩니다"]);
  guide.addRow(["CPE", "선택. cpe:2.3:... 형식. 비우면 제조사/제품명/버전으로 자동 생성"]);
  guide.addRow(["노출구분", "경계면(외부 노출) 또는 내부"]);
  guide.addRow(["담당자/담당부서/IP", "선택"]);
  guide.addRow(["주의", "예시 2행은 지우고 실제 자산을 입력하세요. 자산명은 파일 안에서 중복될 수 없습니다"]);
  guide.getColumn(1).width = 22;
  guide.getColumn(2).width = 90;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
