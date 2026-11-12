export type PeriodMode = 'today' | 'customRange' | 'sinceLastRun';
export type AttachMode = 'separate' | 'zip';
export type ExporterType = 'auto' | 'native' | 'xmlRebuild';
export type ReportType = 'Day Book' | 'Balance Sheet' | 'Both';

export interface TallyConfig {
  host: string;
  port: number;
  timeoutMs?: number; // default 60000ms
}

export interface DayBookConfig {
  reportType?: ReportType; // 'Day Book' | 'Balance Sheet' | 'Both'
  periodMode: PeriodMode;
  fromDate?: string; // YYYYMMDD
  toDate?: string;   // YYYYMMDD
  voucherTypes: string[]; // empty = all
  detailed: boolean;      // EXPLODEFLAG: Yes/No
  skipIfNoEntries: boolean;
  exporter: ExporterType; // auto | native | xmlRebuild
}

export interface ScheduleConfig {
  intervalMinutes: number; // default 30
  activeWindow?: {
    enabled: boolean;
    start: string; // HH:mm (e.g. "09:00")
    end: string;   // HH:mm (e.g. "20:00")
  };
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string; // stored encrypted at rest
  from: string;
}

export interface MailConfig {
  recipients: {
    to: string[];
    cc?: string[];
    bcc?: string[];
  };
  subjectTemplate: string; // e.g. "Day Book - {CompanyCount} Companies - {dd-MMM-yyyy HH:mm}"
  bodyTemplate?: string;
}

export interface LocalCopiesConfig {
  enabled: boolean;
  outputFolder: string;
  retentionDays: number;
}

export interface WebUiConfig {
  enabled: boolean;
  port: number; // default 9095
  host: string; // strictly 127.0.0.1
}

export interface AppConfig {
  tally: TallyConfig;
  companies: string[] | 'auto';
  dayBook: DayBookConfig;
  schedule: ScheduleConfig;
  smtp: SmtpConfig;
  mail: MailConfig;
  attachMode: AttachMode;
  keepLocalCopies: LocalCopiesConfig;
  webUi: WebUiConfig;
}

export interface CompanyState {
  lastRunTimestamp?: string;
  lastMaxAlterId?: number;
  lastDate?: string; // YYYYMMDD to detect midnight rollover
  lastStatus?: 'OK' | 'FAILED' | 'NO ENTRIES' | 'SKIPPED';
  lastVoucherCount?: number;
  lastError?: string;
}

export interface AppState {
  companies: Record<string, CompanyState>;
  lastCycleTimestamp?: string;
  lastTallyDownAlertTimestamp?: string;
}

export interface VoucherEntry {
  date: string; // YYYYMMDD or formatted
  voucherType: string;
  voucherNumber: string;
  partyLedgerName: string;
  narration?: string;
  amount: number;
  alterId?: number;
  masterId?: number;
  ledgerEntries: {
    ledgerName: string;
    amount: number;
    isDeemedPositive: boolean; // Yes = Debit, No = Credit
  }[];
}

export interface CompanyExportResult {
  companyName: string;
  status: 'OK' | 'FAILED' | 'NO ENTRIES' | 'SKIPPED';
  filePath?: string;
  fileName?: string;
  fileBuffer?: Buffer;
  voucherCount: number;
  newOrAlteredCount?: number;
  periodText: string;
  generatedAt: string;
  error?: string;
  methodUsed?: 'native' | 'xmlRebuild';
}

export interface ExportCycleSummary {
  startedAt: string;
  completedAt: string;
  totalCompanies: number;
  successfulCompanies: number;
  failedCompanies: number;
  skippedCompanies: number;
  results: CompanyExportResult[];
  emailSent: boolean;
  emailError?: string;
}

