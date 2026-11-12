import { AppConfig, ExportCycleSummary } from '../config/types';
import { CompanyDiscoveryService } from '../tally/companyDiscovery';
import { StateManager } from './stateManager';
import { MailerService } from '../mailer/mailer';
export declare class ExportOrchestrator {
    private config;
    private stateManager;
    private tallyClient;
    private discoveryService;
    private exporterFactory;
    private mailer;
    private isCycleRunning;
    constructor(config: AppConfig, stateManager: StateManager);
    updateConfig(newConfig: AppConfig): void;
    getIsRunning(): boolean;
    /**
     * Helper to format Date into YYYYMMDD
     */
    toYyyyMmDd(d?: Date): string;
    /**
     * Runs a complete export cycle across all open/configured companies sequentially.
     */
    runCycle(): Promise<ExportCycleSummary>;
    /**
     * Exports Day Book for a single company with period and state handling
     */
    private exportSingleCompany;
    /**
     * Saves copies of exported .xlsx files to the configured local folder
     */
    private saveLocalCopies;
    /**
     * Cleans up local copies older than retentionDays
     */
    private cleanOldLocalCopies;
    getDiscoveryService(): CompanyDiscoveryService;
    getMailer(): MailerService;
}
