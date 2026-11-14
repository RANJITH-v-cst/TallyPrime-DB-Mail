import express, { Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { AddressInfo } from 'net';
import { exec } from 'child_process';
import { AppConfig } from '../config/types';
import { loadConfig, saveConfig, validateConfig, mergeConfig } from '../config/config';
import { parseEmailList, validateEmailList } from '../utils/emailValidator';
import { resolveAndEnsureFolder } from '../utils/folderHelper';
import { getLogsDir } from '../utils/appPaths';
import { MailerService } from '../mailer/mailer';
import { AppScheduler } from '../scheduler/scheduler';
import { ExportOrchestrator, CycleOverrideOptions } from '../scheduler/orchestrator';
import { StateManager } from '../scheduler/stateManager';
import { logger } from '../utils/logger';

const packageJson = require('../../package.json');

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

  public getPort(): number {
    return this.port;
  }

  private setupRoutes(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Serve static files from public/ (works in dev ts-node, compiled dist, and packaged Electron)
    const candidateDirs = [
      path.resolve(__dirname, 'public'),
      path.resolve(__dirname, '..', 'ui', 'public'),
      path.resolve(process.cwd(), 'src', 'ui', 'public'),
      path.resolve(process.cwd(), 'dist', 'ui', 'public'),
    ];
    const publicDir = candidateDirs.find((d) => fs.existsSync(path.join(d, 'index.html'))) || path.resolve(__dirname, 'public');
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
        version: packageJson.version || '1.0.0',
        nextRun: nextRun ? nextRun.toISOString() : null,
        companyStates: rawState.companies,
        lastCycleTimestamp: rawState.lastCycleTimestamp,
        tallyConfig: {
          host: this.config.tally.host,
          port: this.config.tally.port,
          timeoutMs: this.config.tally.timeoutMs || 60000,
        },
        intervalMinutes: this.config.schedule.intervalMinutes,
        schedule: this.config.schedule,
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

    // API: Save Config (validates, merges into existing config, and writes config.json atomically)
    this.app.post('/api/config', (req: Request, res: Response) => {
      try {
        const incoming = req.body as Partial<AppConfig>;

        // Merge incoming into existing config without overwriting unmodified keys or wiping password
        const merged = mergeConfig(this.config, incoming);

        // Validate merged config
        const validation = validateConfig(merged);
        if (!validation.valid) {
          return res.status(400).json({ success: false, errors: validation.errors });
        }

        // Save atomically (saveConfig writes to temp file and renames)
        saveConfig(merged);
        this.config = merged;

        // Propagate updated config to scheduler and orchestrator immediately
        this.onConfigUpdate(merged);
        this.orchestrator.updateConfig(merged);

        const toCount = merged.mail.recipients.to.length;
        const ccCount = merged.mail.recipients.cc?.length || 0;
        const bccCount = merged.mail.recipients.bcc?.length || 0;
        logger.info(`Configuration updated via Web UI. Recipients configured: ${toCount} (CC: ${ccCount}, BCC: ${bccCount})`);

        res.json({ success: true, message: 'Settings saved and applied successfully!' });
      } catch (err: any) {
        logger.error(`Error saving config from UI: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Trigger "Send Now" (Manual Run with optional custom recipient and report type)
    this.app.post('/api/run-now', async (req: Request, res: Response) => {
      try {
        if (this.orchestrator.getIsRunning()) {
          return res.status(409).json({ success: false, message: 'An export cycle is already running' });
        }

        let receiverEmails: string[] | undefined = undefined;
        if (req.body.receiverEmail) {
          const parsed = parseEmailList(req.body.receiverEmail);
          const validation = validateEmailList(parsed, 'To', { requireAtLeastOne: true, rejectPlaceholders: true });
          if (!validation.valid) {
            return res.status(400).json({ success: false, message: validation.error });
          }
          receiverEmails = validation.emails;
        }

        const reportType = req.body.reportType || this.config.dayBook.reportType || 'Day Book';

        const overrideOptions: CycleOverrideOptions = {
          reportType,
        };

        if (req.body.fromDate) {
          overrideOptions.fromDate = req.body.fromDate;
          overrideOptions.periodMode = 'customRange';
        }
        if (req.body.toDate) {
          overrideOptions.toDate = req.body.toDate;
        }
        if (req.body.periodMode) {
          overrideOptions.periodMode = req.body.periodMode;
        }

        if (receiverEmails && receiverEmails.length > 0) {
          overrideOptions.recipients = receiverEmails;
          // Merge and persist into active config
          this.config = mergeConfig(this.config, {
            mail: {
              ...this.config.mail,
              recipients: {
                ...this.config.mail.recipients,
                to: receiverEmails,
              },
            },
          });
          try {
            saveConfig(this.config);
          } catch (e: any) {
            logger.warn(`Could not persist receiver email: ${e.message}`);
          }
        }

        const toCount = overrideOptions.recipients ? overrideOptions.recipients.length : this.config.mail.recipients.to.length;
        logger.info(`Manual run requested for ${reportType} to ${toCount} recipient(s)...`);

        // Run asynchronously so UI gets immediate feedback or wait
        this.scheduler.triggerManualRun(overrideOptions)
          .then((summary) => {
            logger.info(`Manual run initiated from Web UI completed successfully. Dispatched to ${toCount} recipient(s).`);
          })
          .catch((err) => {
            logger.error(`Manual run from Web UI failed: ${err.message}`);
          });

        res.json({
          success: true,
          message: `Export triggered for ${reportType}! Sending to ${toCount} recipient(s). Monitor live progress in the Status tab.`,
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Test SMTP Connection & Send Test Email (Sends to currently entered To addresses even if unsaved)
    this.app.post('/api/test-mail', async (req: Request, res: Response) => {
      try {
        const rawTo = req.body.to || this.config.mail.recipients.to;
        const toList = parseEmailList(rawTo);

        // Validate To addresses (require at least 1, reject placeholder domains)
        const toValidation = validateEmailList(toList, 'To', { requireAtLeastOne: true, rejectPlaceholders: true });
        if (!toValidation.valid) {
          return res.status(400).json({ success: false, message: toValidation.error });
        }

        // Build temporary test configuration merging any unsaved form fields
        const testConfig: AppConfig = mergeConfig(this.config, {
          smtp: {
            host: req.body.host || this.config.smtp.host,
            port: req.body.port ? parseInt(req.body.port, 10) : this.config.smtp.port,
            secure: req.body.secure !== undefined ? !!req.body.secure : this.config.smtp.secure,
            user: req.body.user || this.config.smtp.user,
            password: req.body.password || this.config.smtp.password,
            from: req.body.from || this.config.smtp.from,
          },
          mail: {
            ...this.config.mail,
            recipients: {
              ...this.config.mail.recipients,
              to: toList,
            },
          },
        });

        // Initialize mailer with this config and dispatch real test email
        const mailer = new MailerService(testConfig);
        const testRes = await mailer.sendTestEmail(toList);
        res.json(testRes);
      } catch (err: any) {
        res.status(500).json({ success: false, message: `SMTP check failed: ${err.message}` });
      }
    });

    // API: Test Tally Connection & Discover Companies (also verifies common export folder)
    this.app.get('/api/test-tally', async (req: Request, res: Response) => {
      try {
        const discovery = this.orchestrator.getDiscoveryService();
        const result = await discovery.discoverCompanies(this.config.companies);
        const folderInfo = resolveAndEnsureFolder(this.config.exportFolder);
        res.json({
          success: true,
          openCompanies: result.openCompanies,
          missingCompanies: result.missingCompanies,
          configuredCompanies: result.configuredCompanies,
          isMatch: result.isMatch,
          exportFolder: folderInfo.folderPath,
          isFolderWritable: folderInfo.isWritable,
          isFolderFallback: folderInfo.isFallback,
        });
      } catch (err: any) {
        const folderInfo = resolveAndEnsureFolder(this.config.exportFolder);
        res.status(500).json({
          success: false,
          error: `Could not connect to TallyPrime at ${this.config.tally.host}:${this.config.tally.port}: ${err.message}`,
          exportFolder: folderInfo.folderPath,
          isFolderWritable: folderInfo.isWritable,
        });
      }
    });

    // API: Open Common Export Folder in Windows File Explorer
    this.app.post('/api/open-folder', (req: Request, res: Response) => {
      try {
        const folderInfo = resolveAndEnsureFolder(this.config.exportFolder);
        const folderPath = folderInfo.folderPath;
        if (process.platform === 'win32') {
          exec(`explorer.exe "${folderPath}"`);
        }
        res.json({ success: true, folderPath });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Read Recent Logs
    this.app.get('/api/logs', (req: Request, res: Response) => {
      try {
        const logsDir = getLogsDir();
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

  public start(customPort?: number): Promise<number> {
    const desiredPort = customPort || this.port;

    return new Promise((resolve, reject) => {
      const tryListen = (portToTry: number) => {
        const srv = this.app.listen(portToTry, this.host, () => {
          this.server = srv;
          this.port = (srv.address() as AddressInfo).port;
          logger.info(`Web UI is running securely at http://${this.host}:${this.port}`);
          resolve(this.port);
        });

        srv.on('error', (err: any) => {
          if (err.code === 'EADDRINUSE' && portToTry !== 0) {
            logger.warn(`Port ${portToTry} is in use on ${this.host}. Picking a free port...`);
            tryListen(0); // Let OS assign an available free port
          } else {
            logger.error(`Failed to start Web UI server: ${err.message}`);
            reject(err);
          }
        });
      };

      tryListen(desiredPort);
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
