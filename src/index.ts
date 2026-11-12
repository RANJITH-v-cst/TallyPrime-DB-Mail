import { loadConfig } from './config/config';
import { StateManager } from './scheduler/stateManager';
import { ExportOrchestrator } from './scheduler/orchestrator';
import { AppScheduler } from './scheduler/scheduler';
import { WebUiServer } from './ui/server';
import { logger } from './utils/logger';

async function main() {
  logger.info('=====================================================');
  logger.info('Starting TallyDayBookMailer Middleware Service');
  logger.info('=====================================================');

  const config = loadConfig();
  const stateManager = new StateManager();
  const orchestrator = new ExportOrchestrator(config, stateManager);
  const scheduler = new AppScheduler(config, orchestrator);

  const args = process.argv.slice(2);
  const isRunOnce = args.includes('--run-once');

  if (isRunOnce) {
    logger.info('Running in one-shot mode (--run-once)...');
    try {
      await orchestrator.runCycle();
      logger.info('One-shot run finished. Exiting.');
      process.exit(0);
    } catch (err: any) {
      logger.error(`One-shot run failed: ${err.message}`);
      process.exit(1);
    }
  }

  // Web UI Server
  let webUi: WebUiServer | null = null;
  if (config.webUi?.enabled !== false && !args.includes('--no-ui')) {
    webUi = new WebUiServer(
      config,
      scheduler,
      orchestrator,
      stateManager,
      (newConfig) => {
        scheduler.updateConfig(newConfig);
      }
    );
    try {
      await webUi.start();
    } catch (err: any) {
      logger.error(`Could not start Web UI server: ${err.message}`);
    }
  }

  // Start Scheduler
  await scheduler.start();

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Performing graceful shutdown...`);
    try {
      if (webUi) {
        await webUi.stop();
      }
      await scheduler.stop();
      logger.info('TallyDayBookMailer shut down gracefully.');
      process.exit(0);
    } catch (err: any) {
      logger.error(`Error during shutdown: ${err.message}`);
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
  logger.error(`Fatal application startup error: ${err.message}`, { stack: err.stack });
  process.exit(1);
});

