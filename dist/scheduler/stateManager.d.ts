import { AppState, CompanyState } from '../config/types';
export declare class StateManager {
    private stateFilePath;
    private state;
    constructor(filePath?: string);
    /**
     * Loads state from file or initializes default empty state
     */
    loadState(): AppState;
    /**
     * Atomically writes state to state.json using write-then-rename
     */
    saveState(): void;
    /**
     * Retrieves state for a given company
     */
    getCompanyState(companyName: string): CompanyState;
    /**
     * Updates state for a given company and saves atomically
     */
    updateCompanyState(companyName: string, update: Partial<CompanyState>): void;
    /**
     * Checks if date has rolled over to a new day since last run
     */
    isMidnightRollover(companyName: string, todayStr: string): boolean;
    /**
     * Records last full cycle timestamp
     */
    setLastCycleTime(isoTime?: string): void;
    getLastCycleTime(): string | undefined;
    /**
     * Determines if a Tally-down alert mail can be sent (throttled to at most once per hour)
     */
    shouldSendTallyDownAlert(): boolean;
    /**
     * Records timestamp when Tally-down alert was sent
     */
    recordTallyDownAlertSent(): void;
    /**
     * Clears Tally-down alert timestamp once Tally is back online
     */
    clearTallyDownAlert(): void;
    getRawState(): AppState;
}
