import { AppConfig, ExportCycleSummary } from '../config/types';
import { ExportOrchestrator } from './orchestrator';
export declare class AppScheduler {
    private config;
    private orchestrator;
    private cronJob;
    private intervalTimer;
    private isShuttingDown;
    private lastSummary;
    private nextRunDate;
    constructor(config: AppConfig, orchestrator: ExportOrchestrator);
    updateConfig(newConfig: AppConfig): void;
    /**
     * Evaluates if current time falls within the configured active window (e.g. "09:00-20:00")
     */
    isWithinActiveWindow(now?: Date): boolean;
    /**
     * Starts the scheduler: runs first cycle immediately, then schedules recurring cycles
     */
    start(): Promise<void>;
    private calculateNextRun;
    /**
     * Executes a cycle with overlap prevention lock and active window verification
     */
    executeProtectedCycle(triggerSource: string): Promise<ExportCycleSummary | null>;
    /**
     * Manual trigger from Web UI ("Send Now")
     */
    triggerManualRun(): Promise<ExportCycleSummary>;
    /**
     * Stops the scheduler and waits for any ongoing cycle
     */
    stop(): Promise<void>;
    getLastSummary(): ExportCycleSummary | null;
    getNextRunDate(): Date | null;
}
