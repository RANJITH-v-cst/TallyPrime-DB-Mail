import { DayBookConfig, VoucherEntry } from '../../config/types';
export interface ExportOptions {
    companyName: string;
    config: DayBookConfig;
    fromDate: string;
    toDate: string;
    sinceAlterId?: number;
}
export interface ExporterResult {
    success: boolean;
    fileBuffer?: Buffer;
    voucherCount: number;
    newOrAlteredCount?: number;
    vouchers?: VoucherEntry[];
    error?: string;
    isFallback?: boolean;
}
export interface IExporter {
    readonly name: string;
    exportDayBook(options: ExportOptions): Promise<ExporterResult>;
}
