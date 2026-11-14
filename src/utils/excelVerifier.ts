import ExcelJS from 'exceljs';

export interface HeaderScanResult {
  hasCreatedBy: boolean;
  hasCreatedTime: boolean;
  headerRowIndex: number;
  createdByCol: number;
  createdTimeCol: number;
}

/**
 * Scans an Excel buffer or file path to check for "Created By" and "Created Time" columns in the header row.
 */
export async function scanExcelHeader(bufferOrPath: Buffer | string): Promise<HeaderScanResult> {
  const workbook = new ExcelJS.Workbook();
  if (typeof bufferOrPath === 'string') {
    await workbook.xlsx.readFile(bufferOrPath);
  } else {
    await workbook.xlsx.load(bufferOrPath as any);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return {
      hasCreatedBy: false,
      hasCreatedTime: false,
      headerRowIndex: -1,
      createdByCol: -1,
      createdTimeCol: -1,
    };
  }

  let headerRowIndex = -1;
  let createdByCol = -1;
  let createdTimeCol = -1;

  for (let r = 1; r <= Math.min(sheet.rowCount, 15); r++) {
    const row = sheet.getRow(r);
    let rowText = '';
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const val = String(cell.value || '').trim();
      rowText += ` ${val}`;
      if (/created\s*by/i.test(val)) createdByCol = colNumber;
      if (/created\s*time|creation\s*time|entry\s*time/i.test(val)) createdTimeCol = colNumber;
    });

    if (/date/i.test(rowText) && /particulars/i.test(rowText)) {
      headerRowIndex = r;
      break;
    }
  }

  return {
    hasCreatedBy: createdByCol !== -1,
    hasCreatedTime: createdTimeCol !== -1,
    headerRowIndex,
    createdByCol,
    createdTimeCol,
  };
}

/**
 * Convenience helper that returns true if both "Created By" and "Created Time" columns are present.
 */
export async function hasCreatedColumns(bufferOrPath: Buffer | string): Promise<boolean> {
  try {
    const res = await scanExcelHeader(bufferOrPath);
    return res.hasCreatedBy && res.hasCreatedTime;
  } catch {
    return false;
  }
}
