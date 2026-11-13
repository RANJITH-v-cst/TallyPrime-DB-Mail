import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, CompanyExportResult, ExportCycleSummary } from '../config/types';
import { loadConfig } from '../config/config';
import { parseEmailList } from '../utils/emailValidator';
import { resolveAndEnsureFolder, saveFileWithLockProtection, cleanOldExports } from '../utils/folderHelper';
import { TallyClient } from '../tally/client';
import { CompanyDiscoveryService } from '../tally/companyDiscovery';
import { ExporterFactory } from '../tally/exporterFactory';
import { StateManager } from './stateManager';
import { MailerService } from '../mailer/mailer';
import { buildExportFileName } from '../utils/sanitizer';
import { formatDateTime } from '../mailer/templates';
import { logger } from '../utils/logger';

export interface CycleOverrideOptions {
  recipients?: string[];
  reportType?: string;
  periodMode?: 'today' | 'sinceLastRun' | 'customRange';
  fromDate?: string;
  toDate?: string;
}

export class ExportOrchestrator {
  private tallyClient: TallyClient;
  private discoveryService: CompanyDiscoveryService;
  private exporterFactory: ExporterFactory;
  private mailer: MailerService;
  private isCycleRunning: boolean = false;

  constructor(
    private config: AppConfig,
    private stateManager: StateManager
  ) {
    this.tallyClient = new TallyClient(config.tally);
    this.discoveryService = new CompanyDiscoveryService(this.tallyClient);
    this.exporterFactory = new ExporterFactory(this.tallyClient);
    this.mailer = new MailerService(config);
  }

  public updateConfig(newConfig: AppConfig): void {
    this.config = newConfig;
    this.tallyClient = new TallyClient(newConfig.tally);
    this.discoveryService = new CompanyDiscoveryService(this.tallyClient);
    this.exporterFactory = new ExporterFactory(this.tallyClient);
    this.mailer.initTransporter(newConfig);
  }

  public getConfig(): AppConfig {
    return this.config;
  }

  public getIsRunning(): boolean {
    return this.isCycleRunning;
  }

  /**
   * Helper to format Date into YYYYMMDD
   */
  public toYyyyMmDd(d: Date = new Date()): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  /**
   * Runs a complete export cycle across all open/configured companies sequentially.
   * Reloads freshest config at the start of every cycle.
   */
  public async runCycle(overrideOptions?: CycleOverrideOptions): Promise<ExportCycleSummary> {
    if (this.isCycleRunning) {
      logger.warn('Previous export cycle is still running. Skipping current trigger.');
      throw new Error('An export cycle is already in progress');
    }

    this.isCycleRunning = true;
    const startTime = new Date();
    const cycleDateStr = this.toYyyyMmDd(startTime);

    // Always reload latest configuration from disk so edits/recipient updates are picked up without restart
    // (Skip in test environments so custom mock test configurations aren't overwritten)
    if (process.env.NODE_ENV !== 'test') {
      try {
        const freshConfig = loadConfig();
        this.updateConfig(freshConfig);
      } catch (e: any) {
        logger.warn(`Could not reload config from disk, using in-memory config: ${e.message}`);
      }
    }

    // Bug 1 fix: if overrideOptions has fromDate+toDate, force periodMode to customRange
    // so that a saved config with periodMode "today" does NOT silently wipe the override.
    if (overrideOptions?.fromDate && overrideOptions?.toDate) {
      overrideOptions.periodMode = 'customRange';
    } else if (!overrideOptions?.periodMode && overrideOptions?.fromDate) {
      overrideOptions.periodMode = 'customRange';
    }

    const activeReportType = overrideOptions?.reportType || this.config.dayBook.reportType || 'Day Book';

    logger.info('=====================================================');
    logger.info(`Starting Tally export cycle (${activeReportType}) at ${formatDateTime(startTime)}`);
    logger.info('=====================================================');

    const results: CompanyExportResult[] = [];

    try {
      // Step 1: Check Tally connection & discover open companies
      const isReachable = await this.tallyClient.ping();
      if (!isReachable) {
        const errorMsg = `TallyPrime is unreachable at ${this.config.tally.host}:${this.config.tally.port}. Check if Tally is running.`;
        logger.error(errorMsg);

        if (this.stateManager.shouldSendTallyDownAlert()) {
          logger.warn('Sending hourly Tally-down alert email...');
          await this.mailer.sendAlert(
            'TallyPrime Disconnected Alert',
            errorMsg,
            'Ensure TallyPrime is open, company is loaded, and Settings > Connectivity has HTTP/ODBC enabled.'
          );
          this.stateManager.recordTallyDownAlertSent();
        }

        const failureSummary: ExportCycleSummary = {
          startedAt: startTime.toISOString(),
          completedAt: new Date().toISOString(),
          totalCompanies: 0,
          successfulCompanies: 0,
          failedCompanies: 0,
          skippedCompanies: 0,
          results: [],
          emailSent: false,
          emailError: errorMsg,
        };
        return failureSummary;
      }

      // Tally is up: clear any down alert state
      logger.info(`[Test Tally connection] Port ${this.config.tally.port} reachability check: ONLINE`);
      this.stateManager.clearTallyDownAlert();

      // Step 1: Discover open companies
      const discovery = await this.discoveryService.discoverCompanies(this.config.companies);
      const targetCompanies = this.config.companies === 'auto'
        ? discovery.openCompanies
        : this.config.companies;

      if (targetCompanies.length === 0) {
        logger.warn('No open companies found in TallyPrime. Nothing to export.');
      }

      // Ensure common export folder exists and is writable
      const folderInfo = resolveAndEnsureFolder(this.config.exportFolder);
      const exportFolder = folderInfo.folderPath;
      logger.info(`Common export folder: "${exportFolder}" (Writable: ${folderInfo.isWritable}, Fallback: ${folderInfo.isFallback})`);

      // Determine reports to export: 'Day Book', 'Balance Sheet', or both
      const reportsToExport = activeReportType === 'Both' ? ['Day Book', 'Balance Sheet'] : [activeReportType];

      // Sequential export for each company (strictly one at a time, 2s pause between companies)
      for (let i = 0; i < targetCompanies.length; i++) {
        const company = targetCompanies[i];
        if (i > 0) {
          logger.info(`Pausing 2 seconds before next company...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        const isCompanyOpen = discovery.openCompanies.some(
          (c) => c.toLowerCase() === company.toLowerCase()
        );

        if (!isCompanyOpen) {
          logger.warn(`Configured company "${company}" is NOT open in TallyPrime. Marking FAILED.`);
          results.push({
            companyName: company,
            status: 'FAILED',
            voucherCount: 0,
            periodText: 'Company Not Loaded',
            generatedAt: formatDateTime(new Date()),
            error: 'Company is not open in TallyPrime tabs',
          });
          continue;
        }

        // Export each requested report for this company with retry on ECONNRESET / ECONNREFUSED
        for (const rep of reportsToExport) {
          const result = await this.exportWithRetry(company, cycleDateStr, rep, exportFolder, overrideOptions);
          results.push(result);
        }
      }

      // Collect files created in THIS cycle directly from the folder
      for (const r of results) {
        if (r.status === 'OK' && r.filePath && fs.existsSync(r.filePath)) {
          try {
            r.fileBuffer = fs.readFileSync(r.filePath);
          } catch (e: any) {
            logger.warn(`Could not read file from folder for attachment "${r.filePath}": ${e.message}`);
          }
        }
      }

      // Build summary
      const completedTime = new Date();
      const successCount = results.filter((r) => r.status === 'OK').length;
      const failedCount = results.filter((r) => r.status === 'FAILED').length;
      const skippedCount = results.filter((r) => r.status === 'NO ENTRIES' || r.status === 'SKIPPED').length;

      const summary: ExportCycleSummary = {
        startedAt: startTime.toISOString(),
        completedAt: completedTime.toISOString(),
        totalCompanies: results.length,
        successfulCompanies: successCount,
        failedCompanies: failedCount,
        skippedCompanies: skippedCount,
        results,
        emailSent: false,
      };

      // Step 5: Send Email with clean de-duplicated recipients
      const effectiveRecipients = overrideOptions?.recipients && overrideOptions.recipients.length > 0
        ? parseEmailList(overrideOptions.recipients)
        : parseEmailList(this.config.mail.recipients.to);

      // Bug 8: Block sending if no valid, non-placeholder recipients
      const PLACEHOLDER_RE = /@(?:[a-zA-Z0-9-]+\.)*example\.(?:com|org|net)$/i;
      const realRecipients = effectiveRecipients.filter(r => !PLACEHOLDER_RE.test(r));
      if (realRecipients.length === 0) {
        const recipientError = effectiveRecipients.length === 0
          ? 'No To recipients configured. Please set a real email address in Settings.'
          : 'All To recipients use placeholder domain (example.com). Please set real email addresses in Settings.';
        logger.error(recipientError);
        summary.emailSent = false;
        summary.emailError = recipientError;
        this.stateManager.setLastCycleTime(new Date().toISOString());
        return summary;
      }

      const effectiveConfig: AppConfig = {
        ...this.config,
        mail: {
          ...this.config.mail,
          recipients: {
            ...this.config.mail.recipients,
            to: realRecipients,
            cc: parseEmailList(this.config.mail.recipients.cc),
            bcc: parseEmailList(this.config.mail.recipients.bcc),
          },
        },
      };

      const toCount = realRecipients.length;
      const ccCount = effectiveConfig.mail.recipients.cc?.length || 0;
      const bccCount = effectiveConfig.mail.recipients.bcc?.length || 0;
      logger.info(`Dispatching export summary email for ${results.length} export(s) to ${toCount} recipient(s) (CC: ${ccCount}, BCC: ${bccCount})...`);

      const emailSent = await this.mailer.sendDayBookEmail({
        summary,
        config: effectiveConfig,
        date: startTime,
      });

      summary.emailSent = emailSent;
      this.stateManager.setLastCycleTime(completedTime.toISOString());

      // Retention cleanup strictly inside common export folder
      cleanOldExports(exportFolder, this.config.keepLocalCopies?.retentionDays || 30);

      logger.info('=====================================================');
      logger.info(`Export cycle finished in ${((completedTime.getTime() - startTime.getTime()) / 1000).toFixed(1)}s (Success: ${successCount}, Failed: ${failedCount}, Skipped: ${skippedCount})`);
      logger.info('=====================================================');

      return summary;
    } finally {
      this.isCycleRunning = false;
    }
  }

  /**
   * Exports Day Book / Balance Sheet for a single company with period and state handling
   * and saves the file atomically to the common export folder with lock protection.
   */
  private async exportSingleCompany(
    companyName: string,
    todayStr: string,
    reportName: string = 'Day Book',
    exportFolder: string = './exports',
    overrideOptions?: CycleOverrideOptions
  ): Promise<CompanyExportResult> {
    const compState = this.stateManager.getCompanyState(companyName);

    // Bug 1: Determine effective periodMode and dates.
    // 1. If overrideOptions has fromDate/toDate, use them (overrides saved dates for this run only)
    // 2. If overrideOptions explicitly sets periodMode (e.g. 'today'), respect it
    // 3. If config has saved fromDate & toDate, export the range even if old periodMode was "today"
    let effectivePeriodMode: 'today' | 'sinceLastRun' | 'customRange';
    let fromDate = todayStr;
    let toDate = todayStr;
    let sinceAlterId: number | undefined = undefined;

    if (overrideOptions?.fromDate && overrideOptions?.toDate) {
      effectivePeriodMode = 'customRange';
      fromDate = overrideOptions.fromDate;
      toDate = overrideOptions.toDate;
    } else if (overrideOptions?.periodMode) {
      effectivePeriodMode = overrideOptions.periodMode;
      if (effectivePeriodMode === 'customRange') {
        fromDate = overrideOptions.fromDate || this.config.dayBook.fromDate || todayStr;
        toDate = overrideOptions.toDate || this.config.dayBook.toDate || todayStr;
      }
    } else if (this.config.dayBook.fromDate && this.config.dayBook.toDate) {
      effectivePeriodMode = 'customRange';
      fromDate = this.config.dayBook.fromDate;
      toDate = this.config.dayBook.toDate;
    } else {
      effectivePeriodMode = this.config.dayBook.periodMode;
    }

    if (effectivePeriodMode === 'sinceLastRun' && reportName === 'Day Book') {
      // Midnight rollover check
      const isNewDay = this.stateManager.isMidnightRollover(companyName, todayStr);
      if (isNewDay) {
        logger.info(`Midnight rollover detected for "${companyName}". Resetting incremental state.`);
        sinceAlterId = undefined;
      } else {
        sinceAlterId = compState.lastMaxAlterId;
      }
    }

    const periodText = fromDate === toDate ? fromDate : `${fromDate} to ${toDate}`;

    try {
      const exportRes = await this.exporterFactory.export({
        companyName,
        config: this.config.dayBook,
        fromDate,
        toDate,
        sinceAlterId,
        reportId: reportName,
      });

      const displayName = reportName === 'Day Book' ? companyName : `${companyName} (${reportName})`;

      if (!exportRes.success || !exportRes.fileBuffer) {
        this.stateManager.updateCompanyState(companyName, {
          lastStatus: 'FAILED',
          lastError: exportRes.error || 'Failed to export',
          lastDate: todayStr,
        });

        return {
          companyName: displayName,
          status: 'FAILED',
          voucherCount: exportRes.voucherCount,
          periodText,
          generatedAt: formatDateTime(new Date()),
          error: exportRes.error || 'Export failed',
          methodUsed: exportRes.methodUsed,
        };
      }

      // Check if skipIfNoEntries is enabled and voucher count is 0
      if (this.config.dayBook.skipIfNoEntries && exportRes.voucherCount === 0 && reportName === 'Day Book') {
        logger.info(`Skipping file attachment for "${companyName}" because voucher count is 0.`);
        this.stateManager.updateCompanyState(companyName, {
          lastStatus: 'NO ENTRIES',
          lastVoucherCount: 0,
          lastDate: todayStr,
          lastRunTimestamp: new Date().toISOString(),
        });

        return {
          companyName: displayName,
          status: 'NO ENTRIES',
          voucherCount: 0,
          periodText,
          generatedAt: formatDateTime(new Date()),
          methodUsed: exportRes.methodUsed,
        };
      }

      // Bug 7: Only update lastMaxAlterId for sinceLastRun mode.
      // For customRange and today, preserve the existing alterId so sinceLastRun isn't polluted.
      let maxAlterId = compState.lastMaxAlterId || 0;
      if (effectivePeriodMode === 'sinceLastRun' && exportRes.vouchers && exportRes.vouchers.length > 0) {
        for (const v of exportRes.vouchers) {
          if (v.alterId && v.alterId > maxAlterId) {
            maxAlterId = v.alterId;
          }
        }
      }

      this.stateManager.updateCompanyState(companyName, {
        lastStatus: 'OK',
        lastVoucherCount: exportRes.voucherCount,
        lastMaxAlterId: maxAlterId,
        lastDate: todayStr,
        lastRunTimestamp: new Date().toISOString(),
        lastError: undefined,
      });

      // Bug 6: Use date-range filename for customRange exports
      const fileName = buildExportFileName(
        companyName,
        new Date(),
        reportName,
        effectivePeriodMode === 'customRange' ? fromDate : undefined,
        effectivePeriodMode === 'customRange' ? toDate : undefined
      );
      const savedInfo = saveFileWithLockProtection(exportFolder, fileName, exportRes.fileBuffer);

      return {
        companyName: displayName,
        status: 'OK',
        fileName: savedInfo.fileName,
        filePath: savedInfo.filePath,
        fileBuffer: exportRes.fileBuffer,
        voucherCount: exportRes.voucherCount,
        newOrAlteredCount: exportRes.newOrAlteredCount,
        periodText,
        generatedAt: formatDateTime(new Date()),
        methodUsed: exportRes.methodUsed,
      };
    } catch (err: any) {
      logger.error(`Unexpected error during export of "${companyName}": ${err.message}`);
      return {
        companyName: reportName === 'Day Book' ? companyName : `${companyName} (${reportName})`,
        status: 'FAILED',
        voucherCount: 0,
        periodText,
        generatedAt: formatDateTime(new Date()),
        error: err.message,
      };
    }
  }

  /**
   * Saves copies of exported .xlsx files to the configured local folder
   */
  private saveLocalCopies(results: CompanyExportResult[]): void {
    const outDir = path.resolve(process.cwd(), this.config.keepLocalCopies.outputFolder || './exports');
    if (!fs.existsSync(outDir)) {
      try {
        fs.mkdirSync(outDir, { recursive: true });
      } catch (err: any) {
        logger.error(`Failed to create export folder ${outDir}: ${err.message}`);
        return;
      }
    }

    for (const res of results) {
      if (res.status === 'OK' && res.fileBuffer && res.fileName) {
        try {
          const filePath = path.join(outDir, res.fileName);
          fs.writeFileSync(filePath, res.fileBuffer);
          res.filePath = filePath;
          logger.info(`Saved local copy: ${filePath}`);
        } catch (err: any) {
          logger.error(`Error saving local copy for "${res.companyName}": ${err.message}`);
        }
      }
    }
  }

  /**
   * Cleans up local copies older than retentionDays
   */
  private cleanOldLocalCopies(): void {
    const retentionDays = this.config.keepLocalCopies.retentionDays || 30;
    const outDir = path.resolve(process.cwd(), this.config.keepLocalCopies.outputFolder || './exports');
    if (!fs.existsSync(outDir)) return;

    try {
      const files = fs.readdirSync(outDir);
      const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.endsWith('.xlsx') && !file.endsWith('.zip')) continue;
        const filePath = path.join(outDir, file);
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs < cutoffTime) {
          fs.unlinkSync(filePath);
          logger.info(`Removed expired local export file: ${file}`);
        }
      }
    } catch (err: any) {
      logger.warn(`Error during local copies retention cleanup: ${err.message}`);
    }
  }

  public getDiscoveryService(): CompanyDiscoveryService {
    return this.discoveryService;
  }

  public getMailer(): MailerService {
    return this.mailer;
  }
}

