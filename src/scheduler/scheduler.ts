import cron, { ScheduledTask } from 'node-cron';
import { AppConfig, ExportCycleSummary } from '../config/types';
import { ExportOrchestrator } from './orchestrator';
import { logger } from '../utils/logger';

export class AppScheduler {
  private cronJob: ScheduledTask | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;
  private lastSummary: ExportCycleSummary | null = null;
  private nextRunDate: Date | null = null;

  constructor(
    private config: AppConfig,
    private orchestrator: ExportOrchestrator
  ) {}

  public updateConfig(newConfig: AppConfig): void {
    const scheduleChanged =
      this.config.schedule.mode !== newConfig.schedule.mode ||
      this.config.schedule.dailyTime !== newConfig.schedule.dailyTime ||
      this.config.schedule.intervalMinutes !== newConfig.schedule.intervalMinutes;

    this.config = newConfig;
    this.orchestrator.updateConfig(newConfig);

    if (scheduleChanged) {
      logger.info(`Scheduler configuration changed. Reconfiguring scheduler...`);
      this.stop();
      this.start();
    }
  }

  /**
   * Evaluates if current time falls within the configured active window (e.g. "09:00-20:00")
   */
  public isWithinActiveWindow(now: Date = new Date()): boolean {
    const window = this.config.schedule.activeWindow;
    if (!window || !window.enabled) return true;

    const [startH, startM] = window.start.split(':').map((v) => parseInt(v, 10));
    const [endH, endM] = window.end.split(':').map((v) => parseInt(v, 10));

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // Over midnight window
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
  }

  /**
   * Starts the scheduler: supports both Daily mode (e.g. 20:00 every night) and Interval mode.
   */
  public async start(): Promise<void> {
    if (this.isShuttingDown) return;

    const schedule = this.config.schedule;
    const isDaily = (schedule.mode || 'daily') === 'daily';
    const dailyTime = schedule.dailyTime || '20:00';

    if (isDaily) {
      const [hStr, mStr] = dailyTime.split(':');
      const hour = parseInt(hStr || '20', 10);
      const minute = parseInt(mStr || '0', 10);
      const cronExpr = `${minute} ${hour} * * *`;

      logger.info(`Starting scheduler in DAILY mode: Exports every night at ${dailyTime} (8:00 PM)`);
      this.calculateNextDailyRun(hour, minute);

      this.cronJob = cron.schedule(cronExpr, async () => {
        logger.info(`Executing scheduled nightly export cycle at ${dailyTime}...`);
        await this.executeProtectedCycle('Daily Nightly Export');
        this.calculateNextDailyRun(hour, minute);
      });
    } else {
      logger.info(`Starting scheduler in INTERVAL mode (Interval: ${schedule.intervalMinutes} minutes)`);
      const intervalMs = Math.max(1, schedule.intervalMinutes) * 60 * 1000;
      this.calculateNextRun(intervalMs);

      this.intervalTimer = setInterval(async () => {
        this.calculateNextRun(intervalMs);
        await this.executeProtectedCycle('Scheduled Interval');
      }, intervalMs);
    }
  }

  private calculateNextRun(intervalMs: number): void {
    this.nextRunDate = new Date(Date.now() + intervalMs);
  }

  private calculateNextDailyRun(hour: number, minute: number): void {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1); // Tomorrow at specified hour:minute
    }
    this.nextRunDate = next;
  }

  /**
   * Executes a cycle with overlap prevention lock and active window verification
   */
  public async executeProtectedCycle(
    triggerSource: string,
    overrideOptions?: { recipients?: string[]; reportType?: string },
    isManual: boolean = false
  ): Promise<ExportCycleSummary | null> {
    if (this.isShuttingDown) {
      logger.info(`Skipping cycle (${triggerSource}) due to pending shutdown.`);
      return null;
    }

    if (this.orchestrator.getIsRunning()) {
      logger.warn(`Scheduler Lock: A cycle is already executing. Skipping trigger (${triggerSource}).`);
      return null;
    }

    if (!isManual && !this.isWithinActiveWindow()) {
      logger.info(
        `Current time is outside the active schedule window (${this.config.schedule.activeWindow?.start} - ${this.config.schedule.activeWindow?.end}). Skipping cycle.`
      );
      return null;
    }

    try {
      logger.info(`Executing export cycle triggered by: ${triggerSource}`);
      const summary = await this.orchestrator.runCycle(overrideOptions);
      this.lastSummary = summary;
      return summary;
    } catch (err: any) {
      logger.error(`Error in cycle triggered by ${triggerSource}: ${err.message}`);
      return null;
    }
  }

  /**
   * Manual trigger from Web UI ("Send Now" with optional custom recipient and report type)
   */
  public async triggerManualRun(overrideOptions?: { recipients?: string[]; reportType?: string }): Promise<ExportCycleSummary> {
    if (this.orchestrator.getIsRunning()) {
      throw new Error('An export cycle is currently running. Please wait for it to complete.');
    }
    const summary = await this.executeProtectedCycle('Manual Web UI Trigger', overrideOptions, true);
    if (!summary) {
      throw new Error('Cycle did not complete (check logs or active window).');
    }
    return summary;
  }

  /**
   * Stops the scheduler and waits for any ongoing cycle
   */
  public async stop(): Promise<void> {
    this.isShuttingDown = true;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    // Wait if cycle currently in progress (up to 15 seconds)
    let waitMs = 0;
    while (this.orchestrator.getIsRunning() && waitMs < 15000) {
      logger.info('Waiting for active export cycle to complete before stopping...');
      await new Promise((res) => setTimeout(res, 1000));
      waitMs += 1000;
    }

    this.nextRunDate = null;
    logger.info('Scheduler successfully stopped.');
  }

  public getLastSummary(): ExportCycleSummary | null {
    return this.lastSummary;
  }

  public getNextRunDate(): Date | null {
    return this.nextRunDate;
  }
}

