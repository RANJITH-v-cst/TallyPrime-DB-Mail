import { AppConfig, ExportCycleSummary } from '../config/types';
export interface SendEmailOptions {
    summary: ExportCycleSummary;
    config: AppConfig;
    date?: Date;
}
export declare class MailerService {
    private config;
    private transporter;
    constructor(config: AppConfig);
    initTransporter(config: AppConfig): void;
    /**
     * Verifies SMTP connection and authentication credentials
     */
    verifyConnection(): Promise<{
        success: boolean;
        message: string;
    }>;
    /**
     * Sends export report email with attachments, with 3x retry and exponential backoff
     */
    sendDayBookEmail(options: SendEmailOptions): Promise<boolean>;
    /**
     * Sends an alert email (e.g. TallyPrime down or total failure)
     */
    sendAlert(title: string, message: string, details?: string): Promise<boolean>;
    /**
     * Helper to send an email with 3 retries and exponential backoff
     */
    private sendWithRetry;
}
