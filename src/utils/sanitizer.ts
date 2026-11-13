/**
 * Sanitizes a string for use as a valid Windows filename.
 * Removes forbidden characters: < > : " / \ | ? * and ASCII control characters (0-31).
 * Replaces spaces or consecutive separators cleanly, and strips trailing periods and spaces.
 */
export function sanitizeFilename(name: string, replacement: string = '_'): string {
  if (!name || typeof name !== 'string') {
    return 'unnamed';
  }

  // Replace reserved Windows characters: < > : " / \ | ? *
  // and ASCII control characters (0-31)
  let clean = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, replacement);

  // Replace reserved Windows filenames (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  const reservedRegex = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  if (reservedRegex.test(clean)) {
    clean = `${clean}_file`;
  }

  // Collapse consecutive replacement characters
  if (replacement) {
    const escaped = replacement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(`${escaped}+`, 'g'), replacement);
  }

  // Strip leading/trailing spaces and dots (invalid at the end of Windows filenames)
  clean = clean.trim().replace(/[. ]+$/, '');

  // Fallback if empty after sanitizing
  if (!clean) {
    clean = 'file';
  }

  // Limit filename length to 120 chars to avoid exceeding Windows MAX_PATH limits
  if (clean.length > 120) {
    clean = clean.substring(0, 120).trim().replace(/[. ]+$/, '');
  }

  return clean;
}

/**
 * Formats a YYYYMMDD string into DD-MMM-YYYY (e.g. "01-Apr-2026").
 */
export function formatDateForFilename(yyyymmdd: string): string {
  if (!yyyymmdd || !/^\d{8}$/.test(yyyymmdd)) return yyyymmdd || 'unknown';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yyyy = yyyymmdd.substring(0, 4);
  const mm = parseInt(yyyymmdd.substring(4, 6), 10) - 1;
  const dd = yyyymmdd.substring(6, 8);
  return `${dd}-${months[mm]}-${yyyy}`;
}

/**
 * Builds standard Day Book / Balance Sheet export filename.
 *
 * For customRange (fromDate & toDate provided and different from each other):
 *   <Company>_DayBook_<DD-MMM-YYYY>_to_<DD-MMM-YYYY>.xlsx
 *   e.g. Ranjith_Enterprices_DayBook_01-Apr-2026_to_30-Apr-2026.xlsx
 *
 * For today / sinceLastRun (no date range):
 *   <Company>_<ReportName>_<yyyyMMdd_HHmmss>.xlsx
 *
 * A short timestamp suffix is always appended to prevent two companies or runs
 * from ever overwriting each other's file.
 */
export function buildExportFileName(
  companyName: string,
  date: Date = new Date(),
  reportName: string = 'DayBook',
  fromDate?: string,
  toDate?: string
): string {
  const sanitizedCompany = sanitizeFilename(companyName);
  const cleanReportName = sanitizeFilename(reportName.replace(/\s+/g, ''));
  const pad = (n: number) => n.toString().padStart(2, '0');

  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const timestamp = `${yyyy}${MM}${dd}_${HH}${mm}${ss}`;

  // Date-range filename when both fromDate and toDate are present
  if (fromDate && toDate && /^\d{8}$/.test(fromDate) && /^\d{8}$/.test(toDate)) {
    const fromStr = sanitizeFilename(formatDateForFilename(fromDate));
    const toStr = sanitizeFilename(formatDateForFilename(toDate));
    return `${sanitizedCompany}_${cleanReportName}_${fromStr}_to_${toStr}.xlsx`;
  }

  return `${sanitizedCompany}_${cleanReportName}_${timestamp}.xlsx`;
}

