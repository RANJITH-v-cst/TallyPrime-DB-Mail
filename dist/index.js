"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config/config");
const stateManager_1 = require("./scheduler/stateManager");
const orchestrator_1 = require("./scheduler/orchestrator");
const scheduler_1 = require("./scheduler/scheduler");
const server_1 = require("./ui/server");
const logger_1 = require("./utils/logger");
async function main() {
    logger_1.logger.info('=====================================================');
    logger_1.logger.info('Starting TallyDayBookMailer Middleware Service');
    logger_1.logger.info('=====================================================');
    const config = (0, config_1.loadConfig)();
    const stateManager = new stateManager_1.StateManager();
    const orchestrator = new orchestrator_1.ExportOrchestrator(config, stateManager);
    const scheduler = new scheduler_1.AppScheduler(config, orchestrator);
    const args = process.argv.slice(2);
    const isRunOnce = args.includes('--run-once');
    if (isRunOnce) {
        logger_1.logger.info('Running in one-shot mode (--run-once)...');
        try {
            await orchestrator.runCycle();
            logger_1.logger.info('One-shot run finished. Exiting.');
            process.exit(0);
        }
        catch (err) {
            logger_1.logger.error(`One-shot run failed: ${err.message}`);
            process.exit(1);
        }
    }
    // Web UI Server
    let webUi = null;
    if (config.webUi?.enabled !== false && !args.includes('--no-ui')) {
        webUi = new server_1.WebUiServer(config, scheduler, orchestrator, stateManager, (newConfig) => {
            scheduler.updateConfig(newConfig);
        });
        try {
            await webUi.start();
        }
        catch (err) {
            logger_1.logger.error(`Could not start Web UI server: ${err.message}`);
        }
    }
    // Start Scheduler
    await scheduler.start();
    // Handle graceful shutdown
    const shutdown = async (signal) => {
        logger_1.logger.info(`Received ${signal}. Performing graceful shutdown...`);
        try {
            if (webUi) {
                await webUi.stop();
            }
            await scheduler.stop();
            logger_1.logger.info('TallyDayBookMailer shut down gracefully.');
            process.exit(0);
        }
        catch (err) {
            logger_1.logger.error(`Error during shutdown: ${err.message}`);
            process.exit(1);
        }
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    // Windows service shutdown event
    process.on('message', (msg) => {
        if (msg === 'shutdown') {
            shutdown('Windows Service Stop');
        }
    });
}
main().catch((err) => {
    logger_1.logger.error(`Fatal application startup error: ${err.message}`, { stack: err.stack });
    process.exit(1);
});
//# sourceMappingURL=index.js.map