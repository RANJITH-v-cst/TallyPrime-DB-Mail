import express, { Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { AppConfig } from '../config/types';
import { loadConfig, saveConfig, validateConfig } from '../config/config';
import { AppScheduler } from '../scheduler/scheduler';
import { ExportOrchestrator } from '../scheduler/orchestrator';
import { StateManager } from '../scheduler/stateManager';
import { logger } from '../utils/logger';

export class WebUiServer {
  private app: express.Express;
  private server: any = null;
  private host: string;
  private port: number;

  constructor(
    private config: AppConfig,
    private scheduler: AppScheduler,
    private orchestrator: ExportOrchestrator,
    private stateManager: StateManager,
    private onConfigUpdate: (newConfig: AppConfig) => void
  ) {
    this.app = express();
    this.host = '127.0.0.1'; // Strictly localhost only
    this.port = config.webUi?.port || 9095;
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Serve static files from public/ (works in both dev ts-node and compiled dist)
    let publicDir = path.resolve(__dirname, 'public');
    if (!fs.existsSync(publicDir)) {
      const srcPublic = path.resolve(process.cwd(), 'src', 'ui', 'public');
      if (fs.existsSync(srcPublic)) {
        publicDir = srcPublic;
      }
    }
    this.app.use(express.static(publicDir));

    // API: Current Status
    this.app.get('/api/status', (req: Request, res: Response) => {
      const isRunning = this.orchestrator.getIsRunning();
      const lastSummary = this.scheduler.getLastSummary();
      const nextRun = this.scheduler.getNextRunDate();
      const rawState = this.stateManager.getRawState();

      res.json({
        isRunning,
        lastSummary,
        nextRun: nextRun ? nextRun.toISOString() : null,
        companyStates: rawState.companies,
        lastCycleTimestamp: rawState.lastCycleTimestamp,
        tallyConfig: {
          host: this.config.tally.host,
          port: this.config.tally.port,
        },
        intervalMinutes: this.config.schedule.intervalMinutes,
      });
    });

    // API: Get Config (with password masked)
    this.app.get('/api/config', (req: Request, res: Response) => {
      const cfg = JSON.parse(JSON.stringify(this.config)) as AppConfig;
      // Mask password for UI
      if (cfg.smtp.password) {
        cfg.smtp.password = '********';
      }
      res.json(cfg);
    });

    // API: Save Config
    this.app.post('/api/config', (req: Request, res: Response) => {
      try {
        const incoming = req.body as AppConfig;

        // If password was left masked, retain previous encrypted password
        if (incoming.smtp.password === '********') {
          incoming.smtp.password = this.config.smtp.password;
        }

        const validation = validateConfig(incoming);
        if (!validation.valid) {
          return res.status(400).json({ success: false, errors: validation.errors });
        }

        saveConfig(incoming);
        this.config = incoming;
        this.onConfigUpdate(incoming);
        logger.info('Configuration updated via Web UI.');

        res.json({ success: true, message: 'Settings saved and applied successfully!' });
      } catch (err: any) {
        logger.error(`Error saving config from UI: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Trigger "Send Now" (Manual Run)
    this.app.post('/api/run-now', async (req: Request, res: Response) => {
      try {
        if (this.orchestrator.getIsRunning()) {
          return res.status(409).json({ success: false, message: 'An export cycle is already running' });
        }

        // Run asynchronously so UI gets immediate feedback or wait
        this.scheduler.triggerManualRun()
          .then((summary) => {
            logger.info('Manual run initiated from Web UI completed successfully.');
          })
          .catch((err) => {
            logger.error(`Manual run from Web UI failed: ${err.message}`);
          });

        res.json({ success: true, message: 'Export cycle triggered! Monitor live progress in the Status tab.' });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Test SMTP Connection
    this.app.post('/api/test-mail', async (req: Request, res: Response) => {
      try {
        const mailer = this.orchestrator.getMailer();
        const testRes = await mailer.verifyConnection();
        res.json(testRes);
      } catch (err: any) {
        res.status(500).json({ success: false, message: `SMTP check failed: ${err.message}` });
      }
    });

    // API: Test Tally Connection & Discover Companies
    this.app.get('/api/test-tally', async (req: Request, res: Response) => {
      try {
        const discovery = this.orchestrator.getDiscoveryService();
        const result = await discovery.discoverCompanies(this.config.companies);
        res.json({
          success: true,
          openCompanies: result.openCompanies,
          missingCompanies: result.missingCompanies,
          configuredCompanies: result.configuredCompanies,
          isMatch: result.isMatch,
        });
      } catch (err: any) {
        res.status(500).json({
          success: false,
          error: `Could not connect to TallyPrime at ${this.config.tally.host}:${this.config.tally.port}: ${err.message}`,
        });
      }
    });

    // API: Read Recent Logs
    this.app.get('/api/logs', (req: Request, res: Response) => {
      try {
        const logsDir = path.resolve(process.cwd(), 'logs');
        if (!fs.existsSync(logsDir)) {
          return res.json({ logs: [] });
        }

        const files = fs.readdirSync(logsDir)
          .filter((f) => f.endsWith('.log') && !f.includes('error'))
          .sort()
          .reverse();

        if (files.length === 0) {
          return res.json({ logs: ['No logs generated yet.'] });
        }

        const latestLog = path.join(logsDir, files[0]);
        const content = fs.readFileSync(latestLog, 'utf8');
        const lines = content.split('\n').filter((l) => l.trim().length > 0);
        const last100 = lines.slice(-100);

        res.json({ logs: last100 });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Fallback to index.html
    this.app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(publicDir, 'index.html'));
    });
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, this.host, () => {
          logger.info(`Web UI is running securely at http://${this.host}:${this.port}`);
          resolve();
        });
        this.server.on('error', (err: any) => {
          logger.error(`Failed to start Web UI server: ${err.message}`);
          reject(err);
        });
      } catch (err: any) {
        reject(err);
      }
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Web UI server stopped.');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
