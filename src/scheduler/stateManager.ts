import * as fs from 'fs';
import * as path from 'path';
import { AppState, CompanyState } from '../config/types';
import { logger } from '../utils/logger';

export class StateManager {
  private stateFilePath: string;
  private state: AppState;

  constructor(filePath?: string) {
    this.stateFilePath = filePath || path.resolve(process.cwd(), 'state.json');
    this.state = this.loadState();
  }

  /**
   * Loads state from file or initializes default empty state
   */
  public loadState(): AppState {
    if (!fs.existsSync(this.stateFilePath)) {
      const initial: AppState = { companies: {} };
      this.state = initial;
      this.saveState();
      return initial;
    }

    try {
      const content = fs.readFileSync(this.stateFilePath, 'utf8');
      const parsed = JSON.parse(content);
      this.state = {
        companies: parsed.companies || {},
        lastCycleTimestamp: parsed.lastCycleTimestamp,
        lastTallyDownAlertTimestamp: parsed.lastTallyDownAlertTimestamp,
      };
      return this.state;
    } catch (err: any) {
      logger.warn(`Failed to read state.json: ${err.message}. Initializing empty state.`);
      this.state = { companies: {} };
      return this.state;
    }
  }

  /**
   * Atomically writes state to state.json using write-then-rename
   */
  public saveState(): void {
    try {
      const dir = path.dirname(this.stateFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tempFile = `${this.stateFilePath}.${Date.now()}.tmp`;
      const json = JSON.stringify(this.state, null, 2);
      fs.writeFileSync(tempFile, json, 'utf8');
      fs.renameSync(tempFile, this.stateFilePath);
    } catch (err: any) {
      logger.error(`Error atomically saving state.json: ${err.message}`);
    }
  }

  /**
   * Retrieves state for a given company
   */
  public getCompanyState(companyName: string): CompanyState {
    return this.state.companies[companyName] || {};
  }

  /**
   * Updates state for a given company and saves atomically
   */
  public updateCompanyState(companyName: string, update: Partial<CompanyState>): void {
    const current = this.state.companies[companyName] || {};
    this.state.companies[companyName] = {
      ...current,
      ...update,
    };
    this.saveState();
  }

  /**
   * Checks if date has rolled over to a new day since last run
   */
  public isMidnightRollover(companyName: string, todayStr: string): boolean {
    const compState = this.getCompanyState(companyName);
    if (!compState.lastDate) return false;
    return compState.lastDate !== todayStr;
  }

  /**
   * Records last full cycle timestamp
   */
  public setLastCycleTime(isoTime: string = new Date().toISOString()): void {
    this.state.lastCycleTimestamp = isoTime;
    this.saveState();
  }

  public getLastCycleTime(): string | undefined {
    return this.state.lastCycleTimestamp;
  }

  /**
   * Determines if a Tally-down alert mail can be sent (throttled to at most once per hour)
   */
  public shouldSendTallyDownAlert(): boolean {
    if (!this.state.lastTallyDownAlertTimestamp) return true;
    const lastAlert = new Date(this.state.lastTallyDownAlertTimestamp).getTime();
    const now = Date.now();
    const oneHourMs = 60 * 60 * 1000;
    return now - lastAlert >= oneHourMs;
  }

  /**
   * Records timestamp when Tally-down alert was sent
   */
  public recordTallyDownAlertSent(): void {
    this.state.lastTallyDownAlertTimestamp = new Date().toISOString();
    this.saveState();
  }

  /**
   * Clears Tally-down alert timestamp once Tally is back online
   */
  public clearTallyDownAlert(): void {
    if (this.state.lastTallyDownAlertTimestamp) {
      delete this.state.lastTallyDownAlertTimestamp;
      this.saveState();
    }
  }

  public getRawState(): AppState {
    return this.state;
  }
}

