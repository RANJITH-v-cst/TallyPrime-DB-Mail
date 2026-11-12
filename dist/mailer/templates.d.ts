import { ExportCycleSummary } from '../config/types';
/**
 * Formats a date object to dd-MMM-yyyy HH:mm (e.g. 12-Nov-2026 11:30)
 */
export declare function formatDateTime(d?: Date): string;
/**
 * Generates email subject from template with placeholders:
 * {CompanyCount}, {dd-MMM-yyyy HH:mm}, {dd-MMM-yyyy}, {HH:mm}
 */
export declare function buildSubject(template: string, companyCount: number, date?: Date): string;
/**
 * Builds HTML table email body for export results
 */
export declare function buildExportEmailHtml(summary: ExportCycleSummary, modeText: string): string;
/**
 * Builds Alert Email HTML when all companies fail or TallyPrime is unreachable
 */
export declare function buildAlertEmailHtml(title: string, message: string, details?: string): string;
