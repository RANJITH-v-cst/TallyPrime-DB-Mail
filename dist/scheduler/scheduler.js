"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppScheduler = void 0;
const logger_1 = require("../utils/logger");
class AppScheduler {
    config;
    orchestrator;
    cronJob = null;
    intervalTimer = null;
    isShuttingDown = false;
    lastSummary = null;
    nextRunDate = null;
    constructor(config, orchestrator) {
        this.config = config;
        this.orchestrator = orchestrator;
    }
    updateConfig(newConfig) {
        const intervalChanged = this.config.schedule.intervalMinutes !== newConfig.schedule.intervalMinutes;
        this.config = newConfig;
        this.orchestrator.updateConfig(newConfig);
        if (intervalChanged) {
            logger_1.logger.info(`Scheduler interval changed to ${newConfig.schedule.intervalMinutes} minutes. Reconfiguring...`);
            this.stop();
            this.start();
        }
    }
    /**
     * Evaluates if current time falls within the configured active window (e.g. "09:00-20:00")
     */
    isWithinActiveWindow(now = new Date()) {
        const window = this.config.schedule.activeWindow;
        if (!window || !window.enabled)
            return true;
        const [startH, startM] = window.start.split(':').map((v) => parseInt(v, 10));
        const [endH, endM] = window.end.split(':').map((v) => parseInt(v, 10));
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;
        if (startMinutes <= endMinutes) {
            return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
        }
        else {
            // Over midnight window
            return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
        }
    }
    /**
     * Starts the scheduler: runs first cycle immediately, then schedules recurring cycles
     */
    async start() {
        if (this.isShuttingDown)
            return;
        logger_1.logger.info(`Starting scheduler (Interval: ${this.config.schedule.intervalMinutes} minutes)`);
        // 1. Run first cycle at startup
        this.executeProtectedCycle('Startup Cycle');
        // 2. Setup safe interval execution
        const intervalMs = Math.max(1, this.config.schedule.intervalMinutes) * 60 * 1000;
        this.calculateNextRun(intervalMs);
        this.intervalTimer = setInterval(async () => {
            this.calculateNextRun(intervalMs);
            await this.executeProtectedCycle('Scheduled Interval');
        }, intervalMs);
    }
    calculateNextRun(intervalMs) {
        this.nextRunDate = new Date(Date.now() + intervalMs);
    }
    /**
     * Executes a cycle with overlap prevention lock and active window verification
     */
    async executeProtectedCycle(triggerSource) {
        if (this.isShuttingDown) {
            logger_1.logger.info(`Skipping cycle (${triggerSource}) due to pending shutdown.`);
            return null;
        }
        if (this.orchestrator.getIsRunning()) {
            logger_1.logger.warn(`Scheduler Lock: A cycle is already executing. Skipping trigger (${triggerSource}).`);
            return null;
        }
        if (!this.isWithinActiveWindow()) {
            logger_1.logger.info(`Current time is outside the active schedule window (${this.config.schedule.activeWindow?.start} - ${this.config.schedule.activeWindow?.end}). Skipping cycle.`);
            return null;
        }
        try {
            logger_1.logger.info(`Executing export cycle triggered by: ${triggerSource}`);
            const summary = await this.orchestrator.runCycle();
            this.lastSummary = summary;
            return summary;
        }
        catch (err) {
            logger_1.logger.error(`Error in cycle triggered by ${triggerSource}: ${err.message}`);
            return null;
        }
    }
    /**
     * Manual trigger from Web UI ("Send Now")
     */
    async triggerManualRun() {
        if (this.orchestrator.getIsRunning()) {
            throw new Error('An export cycle is currently running. Please wait for it to complete.');
        }
        const summary = await this.executeProtectedCycle('Manual Web UI Trigger');
        if (!summary) {
            throw new Error('Cycle did not complete (check logs or active window).');
        }
        return summary;
    }
    /**
     * Stops the scheduler and waits for any ongoing cycle
     */
    async stop() {
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
            logger_1.logger.info('Waiting for active export cycle to complete before stopping...');
            await new Promise((res) => setTimeout(res, 1000));
            waitMs += 1000;
        }
        this.nextRunDate = null;
        logger_1.logger.info('Scheduler successfully stopped.');
    }
    getLastSummary() {
        return this.lastSummary;
    }
    getNextRunDate() {
        return this.nextRunDate;
    }
}
exports.AppScheduler = AppScheduler;
//# sourceMappingURL=scheduler.js.map