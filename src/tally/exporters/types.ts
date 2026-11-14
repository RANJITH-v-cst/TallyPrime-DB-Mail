import { DayBookConfig, VoucherEntry } from '../../config/types';

export interface ExportOptions {
  companyName: string;
  config: DayBookConfig;
  fromDate: string; // YYYYMMDD
  toDate: string;   // YYYYMMDD
  sinceAlterId?: number;
  reportId?: string; // 'Day Book' or 'Balance Sheet'
  exportFolder?: string;
  tallyExportFolder?: string;
  signal?: AbortSignal;
}

export interface ExporterResult {
  success: boolean;
  fileBuffer?: Buffer;
  filePath?: string;
  fileName?: string;
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

