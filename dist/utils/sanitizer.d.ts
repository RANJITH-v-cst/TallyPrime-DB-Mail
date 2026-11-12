/**
 * Sanitizes a string for use as a valid Windows filename.
 * Removes forbidden characters: < > : " / \ | ? * and ASCII control characters (0-31).
 * Replaces spaces or consecutive separators cleanly, and strips trailing periods and spaces.
 */
export declare function sanitizeFilename(name: string, replacement?: string): string;
/**
 * Builds standard Day Book export filename:
 * <CompanyName>_DayBook_<yyyyMMdd_HHmm>.xlsx
 */
export declare function buildExportFileName(companyName: string, date?: Date): string;
