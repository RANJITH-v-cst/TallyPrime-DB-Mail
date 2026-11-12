export type PeriodMode = 'today' | 'customRange' | 'sinceLastRun';
export type AttachMode = 'separate' | 'zip';
export type ExporterType = 'auto' | 'native' | 'xmlRebuild';
export interface TallyConfig {
    host: string;
    port: number;
    timeoutMs?: number;
}
export interface DayBookConfig {
    periodMode: PeriodMode;
    fromDate?: string;
    toDate?: string;
    voucherTypes: string[];
    detailed: boolean;
    skipIfNoEntries: boolean;
    exporter: ExporterType;
}
export interface ScheduleConfig {
    intervalMinutes: number;
    activeWindow?: {
        enabled: boolean;
        start: string;
        end: string;
    };
}
export interface SmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
}
export interface MailConfig {
    recipients: {
        to: string[];
        cc?: string[];
        bcc?: string[];
    };
    subjectTemplate: string;
    bodyTemplate?: string;
}
export interface LocalCopiesConfig {
    enabled: boolean;
    outputFolder: string;
    retentionDays: number;
}
export interface WebUiConfig {
    enabled: boolean;
    port: number;
    host: string;
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
    lastDate?: string;
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
    date: string;
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
        isDeemedPositive: boolean;
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
