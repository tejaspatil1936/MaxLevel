import Papa from "papaparse";
import * as XLSX from "xlsx";

export interface ParsedStudentRow {
  prn: string;
  email: string;
  name: string;
}

export interface ParseResult {
  validRows: ParsedStudentRow[];
  invalidRows: Array<{ rowNumber: number; raw: any; reason: string }>;
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function parseEligibilityFile(
  buffer: Buffer,
  fileName: string
): Promise<ParseResult> {
  const isXlsx = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");
  let rawRows: Record<string, any>[] = [];

  if (isXlsx) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error("Excel workbook contains no sheets");
    }
    const worksheet = workbook.Sheets[firstSheetName];
    rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet);
  } else {
    const csvContent = buffer.toString("utf-8");
    const parsed = Papa.parse<Record<string, any>>(csvContent, {
      header: true,
      skipEmptyLines: "greedy",
    });
    rawRows = parsed.data;
  }

  const validRows: ParsedStudentRow[] = [];
  const invalidRows: Array<{ rowNumber: number; raw: any; reason: string }> = [];

  for (let idx = 0; idx < rawRows.length; idx++) {
    const row = rawRows[idx];
    const rowNumber = idx + 2; // +1 for 0-index, +1 for header row

    // Find columns by normalized key
    let prn = "";
    let email = "";
    let name = "";

    for (const [key, value] of Object.entries(row)) {
      const norm = normalizeHeader(key);
      const valStr = String(value ?? "").trim();
      if (norm === "prn" || norm === "prnno" || norm === "rollno") {
        prn = valStr;
      } else if (norm === "email" || norm === "emailid" || norm === "studentemail") {
        email = valStr.toLowerCase();
      } else if (norm === "name" || norm === "studentname" || norm === "fullname") {
        name = valStr;
      }
    }

    if (!prn) {
      invalidRows.push({ rowNumber, raw: row, reason: "Missing PRN" });
      continue;
    }
    if (!email || !email.includes("@")) {
      invalidRows.push({ rowNumber, raw: row, reason: "Invalid or missing email" });
      continue;
    }
    if (!name) {
      invalidRows.push({ rowNumber, raw: row, reason: "Missing student name" });
      continue;
    }

    validRows.push({ prn, email, name });
  }

  return { validRows, invalidRows };
}
