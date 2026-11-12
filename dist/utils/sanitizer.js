"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeFilename = sanitizeFilename;
exports.buildExportFileName = buildExportFileName;
/**
 * Sanitizes a string for use as a valid Windows filename.
 * Removes forbidden characters: < > : " / \ | ? * and ASCII control characters (0-31).
 * Replaces spaces or consecutive separators cleanly, and strips trailing periods and spaces.
 */
function sanitizeFilename(name, replacement = '_') {
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
 * Builds standard Day Book export filename:
 * <CompanyName>_DayBook_<yyyyMMdd_HHmm>.xlsx
 */
function buildExportFileName(companyName, date = new Date()) {
    const sanitizedCompany = sanitizeFilename(companyName);
    const pad = (n) => n.toString().padStart(2, '0');
    const yyyy = date.getFullYear();
    const MM = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const HH = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const timestamp = `${yyyy}${MM}${dd}_${HH}${mm}`;
    return `${sanitizedCompany}_DayBook_${timestamp}.xlsx`;
}
//# sourceMappingURL=sanitizer.js.map