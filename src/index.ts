import { AppConfig } from './config/types';
import { loadConfig } from './config/config';
import { StateManager } from './scheduler/stateManager';
import { ExportOrchestrator } from './scheduler/orchestrator';
import { AppScheduler } from './scheduler/scheduler';
import { WebUiServer } from './ui/server';
import { logger } from './utils/logger';

export interface AppInstance {
  config: AppConfig;
  stateManager: StateManager;
  orchestrator: ExportOrchestrator;
  scheduler: AppScheduler;
  webUi: WebUiServer | null;
  port?: number;
  shutdown: (signal?: string) => Promise<void>;
}

export interface StartAppOptions {
  runOnce?: boolean;
  noUi?: boolean;
  preferredPort?: number;
}

export async function startApp(options: StartAppOptions = {}): Promise<AppInstance> {
  logger.info('=====================================================');
  logger.info('Starting TallyDayBookMailer Middleware Service');
  logger.info('=====================================================');

  const config = loadConfig();
  const stateManager = new StateManager();
  const orchestrator = new ExportOrchestrator(config, stateManager);
  const scheduler = new AppScheduler(config, orchestrator);

  const args = process.argv.slice(2);
  const isRunOnce = options.runOnce ?? args.includes('--run-once');

  if (isRunOnce) {
    logger.info('Running in one-shot mode (--run-once)...');
    try {
      await orchestrator.runCycle();
      logger.info('One-shot run finished.');
    } catch (err: any) {
      logger.error(`One-shot run failed: ${err.message}`);
      throw err;
    }
  }

  // Web UI Server
  let webUi: WebUiServer | null = null;
  let runningPort: number | undefined;

  const noUi = options.noUi ?? args.includes('--no-ui');
  if (config.webUi?.enabled !== false && !noUi && !isRunOnce) {
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
      const portToUse = options.preferredPort ?? config.webUi?.port ?? 9095;
      runningPort = await webUi.start(portToUse);
    } catch (err: any) {
      logger.error(`Could not start Web UI server: ${err.message}`);
    }
  }

  // Start Scheduler if not one-shot
  if (!isRunOnce) {
    await scheduler.start();
  }

  const shutdown = async (signal: string = 'Quit') => {
    logger.info(`Received ${signal}. Performing graceful shutdown...`);
    try {
      if (webUi) {
        await webUi.stop();
      }
      await scheduler.stop();
      logger.info('TallyDayBookMailer shut down gracefully.');
    } catch (err: any) {
      logger.error(`Error during shutdown: ${err.message}`);
    }
  };

  return {
    config,
    stateManager,
    orchestrator,
    scheduler,
    webUi,
    port: runningPort,
    shutdown,
  };
}

if (require.main === module) {
  const isRunOnce = process.argv.includes('--run-once');
  startApp().then((app) => {
    if (isRunOnce) {
      process.exit(0);
    }

    const handleSignal = async (sig: string) => {
      await app.shutdown(sig);
      process.exit(0);
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));

    // Windows service shutdown event
    process.on('message', (msg) => {
      if (msg === 'shutdown') {
        handleSignal('Windows Service Stop');
      }
    });
  }).catch((err) => {
    logger.error(`Fatal application startup error: ${err.message}`, { stack: err.stack });
    process.exit(1);
  });
}
