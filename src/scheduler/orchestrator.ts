import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, CompanyExportResult, ExportCycleSummary } from '../config/types';
import { loadConfig } from '../config/config';
import { parseEmailList } from '../utils/emailValidator';
import { resolveAndEnsureFolder, saveFileWithLockProtection, cleanOldExports } from '../utils/folderHelper';
import { TallyClient } from '../tally/client';
import { TallyLicenseGuard, LicenseState } from '../license/tallyLicense';
import { CompanyDiscoveryService } from '../tally/companyDiscovery';
import { ExporterFactory } from '../tally/exporterFactory';
import { StateManager } from './stateManager';
import { MailerService } from '../mailer/mailer';
import { buildExportFileName } from '../utils/sanitizer';
import { formatDateTime } from '../mailer/templates';
import { logger } from '../utils/logger';
import { getExportsDir } from '../utils/appPaths';

export interface CycleOverrideOptions {
  recipients?: string[];
  reportType?: string;
  periodMode?: 'today' | 'sinceLastRun' | 'customRange';
  fromDate?: string;
  toDate?: string;
  companyDeadlineMs?: number;
}

export interface ExportCycleProgress {
  isRunning: boolean;
  currentCompany?: string;
  currentStep?: string;
  startedAt?: string;
  elapsedSeconds: number;
  completedCompanies: number;
  totalCompanies: number;
  isCancelled: boolean;
}

export class ExportOrchestrator {
  private tallyClient: TallyClient;
  private discoveryService: CompanyDiscoveryService;
  private exporterFactory: ExporterFactory;
  private mailer: MailerService;
  private licenseGuard: TallyLicenseGuard;
  private isCycleRunning: boolean = false;
  private cycleStartTime: number | null = null;
  private cycleAbortController: AbortController | null = null;
  private isCancelled: boolean = false;
  private watchdogTriggered: boolean = false;
  private currentCompany: string = '';
  private currentStep: string = 'idle';
  private completedCompaniesCount: number = 0;
  private totalCompaniesCount: number = 0;

  constructor(
    private config: AppConfig,
    private stateManager: StateManager
  ) {
    this.tallyClient = new TallyClient(config.tally);
    this.discoveryService = new CompanyDiscoveryService(this.tallyClient);
    this.exporterFactory = new ExporterFactory(this.tallyClient);
    this.mailer = new MailerService(config);
    // The guard always uses the current client (it is replaced on config updates) and caches its result.
    this.licenseGuard = new TallyLicenseGuard(() => this.tallyClient);
  }

  /** Current licence state (for the UI / status API). */
  public getLicenseState(): LicenseState {
    return this.licenseGuard.getState();
  }

  /** Forces a fresh licence check against the running TallyPrime (Test Tally button). */
  public async recheckLicense(): Promise<LicenseState> {
    this.licenseGuard.reset();
    return this.licenseGuard.verify();
  }

  /** One-time licence check against the running TallyPrime, used when the application opens. */
  public async verifyLicense(): Promise<LicenseState> {
    return this.licenseGuard.verify();
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

  public getProgress(): ExportCycleProgress {
    const elapsedSeconds = this.cycleStartTime
      ? Math.max(0, Math.floor((Date.now() - this.cycleStartTime) / 1000))
      : 0;
    return {
      isRunning: this.isCycleRunning,
      currentCompany: this.currentCompany || undefined,
      currentStep: this.currentStep || 'idle',
      startedAt: this.cycleStartTime ? new Date(this.cycleStartTime).toISOString() : undefined,
      elapsedSeconds,
      completedCompanies: this.completedCompaniesCount,
      totalCompanies: this.totalCompaniesCount,
      isCancelled: this.isCancelled,
    };
  }

  public cancelCycle(): boolean {
    if (!this.isCycleRunning) return false;
    logger.warn('Export cycle cancellation requested by user or API.');
    this.isCancelled = true;
    this.currentStep = 'Cancelling cycle...';
    if (this.cycleAbortController) {
      this.cycleAbortController.abort();
    }
    return true;
  }

  public checkWatchdog(): boolean {
    if (this.isCycleRunning && this.cycleStartTime) {
      const cycleDeadlineMs = this.config.tally.cycleDeadlineMs || 900000;
      const maxAllowedMs = 2 * cycleDeadlineMs;
      const elapsed = Date.now() - this.cycleStartTime;
      if (elapsed > maxAllowedMs) {
        logger.error(
          `[WATCHDOG] Export cycle has been running for ${Math.floor(elapsed / 1000)}s (exceeds 2x deadline ${maxAllowedMs / 1000}s). Force-releasing cycle lock!`
        );
        this.isCycleRunning = false;
        this.watchdogTriggered = true;
        this.currentStep = 'Watchdog force-released lock';
        if (this.cycleAbortController) {
          try {
            this.cycleAbortController.abort();
          } catch {}
        }
        return true;
      }
    }
    return false;
  }

  public isWatchdogTriggered(): boolean {
    return this.watchdogTriggered;
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
      this.checkWatchdog();
      if (this.isCycleRunning) {
        logger.warn('Previous export cycle is still running. Skipping current trigger.');
        throw new Error('An export cycle is already in progress');
      }
    }

    this.isCycleRunning = true;
    this.cycleStartTime = Date.now();
    this.isCancelled = false;
    this.watchdogTriggered = false;

    try {
      return await this.runCycleInternal(overrideOptions, false);
    } finally {
      this.isCycleRunning = false;
      this.cycleStartTime = null;
      this.currentCompany = '';
      this.currentStep = 'idle';
      this.cycleAbortController = null;
    }
  }

  private async runCycleInternal(
    overrideOptions?: CycleOverrideOptions,
    isRetry: boolean = false
  ): Promise<ExportCycleSummary> {
    // Requirement 2: Reset native-skip cycle state at the start of each cycle
    this.exporterFactory.resetCycleState();

    this.cycleAbortController = new AbortController();
    this.completedCompaniesCount = 0;
    this.totalCompaniesCount = 0;
    this.currentStep = isRetry ? 'Retrying export cycle...' : 'Initializing export cycle...';
    this.currentCompany = '';

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

    // Requirement 4: Set default companyDeadlineMs to 240000 (4m)
    const companyDeadlineMs = overrideOptions?.companyDeadlineMs || this.config.tally.companyDeadlineMs || 240000;

    // Initial cycle deadline before discovery
    let cycleDeadlineMs = this.config.tally.cycleDeadlineMs || 900000;
    let cycleTimer = setTimeout(() => {
      logger.warn(`Per-cycle deadline (${cycleDeadlineMs / 1000}s) reached! Aborting cycle requests.`);
      if (this.cycleAbortController) {
        this.cycleAbortController.abort();
      }
    }, cycleDeadlineMs);

    // If periodMode is explicitly specified as today, ensure fromDate and toDate do not force customRange
    if (overrideOptions?.periodMode === 'today') {
      overrideOptions.fromDate = undefined;
      overrideOptions.toDate = undefined;
    } else if (overrideOptions?.fromDate && overrideOptions?.toDate) {
      overrideOptions.periodMode = 'customRange';
    } else if (!overrideOptions?.periodMode && overrideOptions?.fromDate) {
      overrideOptions.periodMode = 'customRange';
    }

    const activeReportType = overrideOptions?.reportType || this.config.dayBook.reportType || 'Day Book';

    logger.info('=====================================================');
    logger.info(`Starting Tally export cycle (${activeReportType})${isRetry ? ' [RETRY ATTEMPT]' : ''} at ${formatDateTime(startTime)}`);
    logger.info('=====================================================');

    const results: CompanyExportResult[] = [];

    try {
      this.currentStep = 'Testing Tally connection...';
      // Step 1: Check Tally connection & discover open companies
      const isReachable = await this.tallyClient.ping(this.cycleAbortController.signal, 'GLOBAL');
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

      // Licence gate: the TallyPrime serial number must match the licensed serial (checked once, then cached)
      this.currentStep = 'Verifying licence...';
      const license = await this.licenseGuard.verify(this.cycleAbortController.signal);
      if (license.status !== 'valid') {
        logger.error(`Export cycle blocked: ${license.message}`);
        throw new Error(license.message);
      }

      // Step 1: Discover open companies
      this.currentStep = 'Discovering open companies...';
      const discovery = await this.discoveryService.discoverCompanies(
        this.config.companies,
        this.cycleAbortController.signal
      );
      const targetCompanies = this.config.companies === 'auto'
        ? discovery.openCompanies
        : this.config.companies;

      this.totalCompaniesCount = targetCompanies.length;

      // Requirement 4: cycleDeadlineMs = companies * companyDeadlineMs + 60000
      cycleDeadlineMs = (targetCompanies.length || 1) * companyDeadlineMs + 60000;
      clearTimeout(cycleTimer);
      cycleTimer = setTimeout(() => {
        logger.warn(`Per-cycle deadline (${cycleDeadlineMs / 1000}s) reached! Aborting cycle requests.`);
        if (this.cycleAbortController) {
          this.cycleAbortController.abort();
        }
      }, cycleDeadlineMs);

      if (targetCompanies.length === 0) {
        logger.warn('No open companies found in TallyPrime. Nothing to export.');
      }

      // Ensure common export folder exists and is writable
      const folderInfo = resolveAndEnsureFolder(this.config.exportFolder);
      const exportFolder = folderInfo.folderPath;
      logger.info(`Common export folder: "${exportFolder}" (Writable: ${folderInfo.isWritable}, Fallback: ${folderInfo.isFallback})`);

      // Determine reports to export: 'Day Book', 'Balance Sheet', or both
      const reportsToExport = activeReportType === 'Both' ? ['Day Book', 'Balance Sheet'] : [activeReportType];

      let consecutiveTimeouts = 0;

      // Sequential export for each company (strictly one at a time, 2s pause between companies)
      for (let i = 0; i < targetCompanies.length; i++) {
        const company = targetCompanies[i];
        this.currentCompany = company;

        // Check if user cancelled
        if (this.isCancelled) {
          logger.warn(`Cycle stopping due to user cancellation. Skipping remaining company "${company}".`);
          results.push({
            companyName: company,
            status: 'FAILED',
            voucherCount: 0,
            periodText: '--',
            generatedAt: formatDateTime(new Date()),
            error: 'Cycle cancelled by user',
          });
          continue;
        }

        // Check if cycle deadline exceeded
        if (this.cycleAbortController?.signal.aborted || (Date.now() - startTime.getTime() >= cycleDeadlineMs)) {
          logger.warn(`Cycle stopping due to cycle deadline. Skipping remaining company "${company}".`);
          results.push({
            companyName: company,
            status: 'FAILED',
            voucherCount: 0,
            periodText: '--',
            generatedAt: formatDateTime(new Date()),
            error: 'Timed out - Tally may be busy',
          });
          continue;
        }

        // Circuit breaker: if two companies in a row time out, abort the rest of the cycle
        if (consecutiveTimeouts >= 2) {
          logger.warn(`Circuit breaker active: 2 companies in a row timed out. Skipping "${company}".`);
          results.push({
            companyName: company,
            status: 'FAILED',
            voucherCount: 0,
            periodText: '--',
            generatedAt: formatDateTime(new Date()),
            error: 'Tally not responding (circuit breaker)',
          });
          continue;
        }

        if (i > 0) {
          this.currentStep = 'Pausing between companies...';
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
          this.completedCompaniesCount++;
          continue;
        }

        // Requirement 3: Before each company export, call tallyClient.ping() (5s timeout).
        // If Tally does not answer, poll every 5s for up to 90s.
        // If it still does not answer, mark that company FAILED with "Tally busy / not responding" and send no more heavy requests.
        this.currentStep = `Checking Tally responsiveness for "${company}"...`;
        let pingOk = await this.tallyClient.ping(this.cycleAbortController?.signal, company);
        if (!pingOk) {
          logger.warn(`Tally did not answer initial ping for "${company}". Polling every 5s for up to 90s...`);
          const pollStart = Date.now();
          while (Date.now() - pollStart < 90000 && !this.cycleAbortController?.signal.aborted && !this.isCancelled) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            if (this.cycleAbortController?.signal.aborted || this.isCancelled) break;
            pingOk = await this.tallyClient.ping(this.cycleAbortController?.signal, company);
            if (pingOk) {
              logger.info(`Tally became responsive for "${company}" after ${Math.round((Date.now() - pollStart) / 1000)}s.`);
              break;
            }
          }
        }

        if (!pingOk) {
          logger.error(`Tally did not answer within 90s for "${company}". Marking FAILED with "Tally busy / not responding" and skipping heavy requests.`);
          for (const rep of reportsToExport) {
            results.push({
              companyName: rep === 'Day Book' ? company : `${company} (${rep})`,
              status: 'FAILED',
              voucherCount: 0,
              periodText: '--',
              generatedAt: formatDateTime(new Date()),
              error: 'Tally busy / not responding',
            });
          }
          consecutiveTimeouts++;
          this.completedCompaniesCount++;
          continue;
        }

        // Per-company deadline (default 240000ms = 4m)
        const companyAbort = new AbortController();

        const onCycleAbort = () => companyAbort.abort();
        if (this.cycleAbortController) {
          this.cycleAbortController.signal.addEventListener('abort', onCycleAbort, { once: true });
        }

        let companyTimeoutOccurred = false;
        const companyTimer = setTimeout(() => {
          logger.warn(`Per-company deadline (${companyDeadlineMs / 1000}s) reached for "${company}". Aborting requests.`);
          companyTimeoutOccurred = true;
          companyAbort.abort();
        }, companyDeadlineMs);

        let hadTimeout = false;

        try {
          for (const rep of reportsToExport) {
            this.currentStep = `Exporting ${rep} (${this.config.dayBook.exporter || 'auto'})...`;
            const result = await this.exportWithRetry(
              company,
              cycleDateStr,
              rep,
              exportFolder,
              overrideOptions,
              companyAbort.signal,
              companyTimeoutOccurred
            );
            results.push(result);

            if (
              result.status === 'FAILED' &&
              result.error &&
              /Timed out|timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ECONNABORTED|busy|not responding/i.test(result.error)
            ) {
              hadTimeout = true;
            }
          }
        } finally {
          clearTimeout(companyTimer);
          if (this.cycleAbortController) {
            this.cycleAbortController.signal.removeEventListener('abort', onCycleAbort);
          }
          this.completedCompaniesCount++;
        }

        if (hadTimeout) {
          consecutiveTimeouts++;
        } else {
          consecutiveTimeouts = 0;
        }
      }

      // Requirement 5: If every company failed with a timeout/busy error, wait 3 minutes and run the whole cycle once more
      // before sending the "All Companies Failed" alert. Respect the existing cycle lock.
      const isAllFailedTimeoutOrBusy =
        results.length > 0 &&
        results.every(
          (r) =>
            r.status === 'FAILED' &&
            r.error &&
            /Timed out|timeout|busy|not responding|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ECONNABORTED/i.test(r.error)
        );

      if (isAllFailedTimeoutOrBusy && !isRetry && !this.isCancelled) {
        logger.warn(
          'All companies failed with timeout/busy error. Waiting 3 minutes before retrying the entire export cycle once...'
        );
        this.currentStep = 'All companies timed out. Waiting 3m before cycle retry...';
        clearTimeout(cycleTimer);

        const waitDurationMs = 180000;
        const waitStart = Date.now();
        while (Date.now() - waitStart < waitDurationMs && !this.isCancelled) {
          const sleepChunk = Math.min(1000, waitDurationMs - (Date.now() - waitStart));
          await new Promise((resolve) => setTimeout(resolve, sleepChunk));
        }

        if (!this.isCancelled) {
          logger.info('3-minute wait finished. Re-running the whole export cycle now...');
          return await this.runCycleInternal(overrideOptions, true);
        }
      }

      this.currentStep = 'Gathering attachments...';
      this.currentCompany = '';

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

      this.currentStep = 'Sending email summary...';

      // Step 5: Send Email with clean de-duplicated recipients
      const effectiveRecipients = overrideOptions?.recipients && overrideOptions.recipients.length > 0
        ? parseEmailList(overrideOptions.recipients)
        : parseEmailList(this.config.mail.recipients.to);

      // Block sending if no valid, non-placeholder recipients
      const PLACEHOLDER_RE = /@(?:[a-zA-Z0-9-]+\.)*example\.(?:com|org|net)$/i;
      const realRecipients = effectiveRecipients.filter((r) => !PLACEHOLDER_RE.test(r));
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

      const sendResult = await this.mailer.sendDayBookEmail({
        summary,
        config: effectiveConfig,
        date: startTime,
      });

      summary.emailSent = sendResult.success;
      if (!sendResult.success) {
        summary.emailError = sendResult.error || 'SMTP dispatch failed. Please check your SMTP settings and Google App Password.';
        logger.error(`Scheduled email dispatch failed: ${summary.emailError}`);
      }
      this.stateManager.setLastCycleTime(completedTime.toISOString());

      // Retention cleanup strictly inside common export folder
      cleanOldExports(exportFolder, this.config.keepLocalCopies?.retentionDays || 30);

      logger.info('=====================================================');
      logger.info(`Export cycle finished in ${((completedTime.getTime() - startTime.getTime()) / 1000).toFixed(1)}s (Success: ${successCount}, Failed: ${failedCount}, Skipped: ${skippedCount})`);
      logger.info('=====================================================');

      return summary;
    } finally {
      clearTimeout(cycleTimer);
    }
  }

  /**
   * Exports a single company with automatic retries on ECONNRESET / ECONNREFUSED / ETIMEDOUT (Task 1).
   * Up to 3 attempts (delays 5s, 15s, 30s).
   */
  public async exportWithRetry(
    company: string,
    cycleDateStr: string,
    rep: string,
    exportFolder: string,
    overrideOptions?: CycleOverrideOptions,
    signal?: AbortSignal,
    companyTimeoutOccurred: boolean = false
  ): Promise<CompanyExportResult> {
    // Retry a timed-out company ONCE after a 10-second wait
    const retryDelays = [10000];
    let lastError = '';

    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      if (signal?.aborted) {
        lastError = this.isCancelled ? 'Cycle cancelled by user' : 'Timed out - Tally may be busy';
        break;
      }

      try {
        const result = await this.exportSingleCompany(
          company,
          cycleDateStr,
          rep,
          exportFolder,
          overrideOptions,
          signal
        );

        if (
          result.status === 'FAILED' &&
          result.error &&
          /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ECONNABORTED|timeout|socket hang up|busy|not responding/i.test(result.error)
        ) {
          throw new Error(result.error);
        }
        return result;
      } catch (compErr: any) {
        lastError = compErr.message || 'Export failed';
        if (signal?.aborted || /ERR_CANCELED|CanceledError|canceled|aborted/i.test(lastError)) {
          lastError = this.isCancelled ? 'Cycle cancelled by user' : 'Timed out - Tally may be busy';
          break;
        }

        const isConnOrTimeout =
          compErr.isTimeout ||
          compErr.name === 'TallyTimeoutError' ||
          /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ECONNABORTED|timeout|socket hang up|busy|not responding/i.test(lastError);

        if (isConnOrTimeout && attempt < retryDelays.length && !signal?.aborted && !this.isCancelled) {
          const delayMs = retryDelays[attempt];
          logger.warn(
            `[Retry ${attempt + 1}/${retryDelays.length}] Export for "${company}" timed out/failed (${lastError}). Waiting ${delayMs / 1000}s before single retry...`
          );

          // Cancellable sleep
          const sleepStart = Date.now();
          while (Date.now() - sleepStart < delayMs) {
            if (signal?.aborted || this.isCancelled) {
              lastError = this.isCancelled ? 'Cycle cancelled by user' : 'Timed out - Tally may be busy';
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
          if (signal?.aborted || this.isCancelled) break;
        } else {
          break;
        }
      }
    }

    let formattedError = lastError;
    if (this.isCancelled) {
      formattedError = 'Cycle cancelled by user';
    } else if (
      companyTimeoutOccurred ||
      signal?.aborted ||
      /Timed out|timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ECONNABORTED|busy|not responding/i.test(lastError)
    ) {
      formattedError = 'Timed out - Tally may be busy';
    }

    return {
      companyName: rep === 'Day Book' ? company : `${company} (${rep})`,
      status: 'FAILED',
      voucherCount: 0,
      periodText: '--',
      generatedAt: formatDateTime(new Date()),
      error: formattedError,
    };
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
    overrideOptions?: CycleOverrideOptions,
    signal?: AbortSignal
  ): Promise<CompanyExportResult> {
    const compState = this.stateManager.getCompanyState(companyName);

    // Requirement 1: Scheduled runs (no overrideOptions) must use this.config.dayBook.periodMode (default 'today').
    // Use saved fromDate/toDate only when periodMode === 'customRange'; otherwise export today's date (calculated at run time).
    // Remove the branch that forces customRange just because fromDate/toDate are saved.
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
        fromDate = overrideOptions.fromDate || (this.config.dayBook.periodMode === 'customRange' ? this.config.dayBook.fromDate : undefined) || todayStr;
        toDate = overrideOptions.toDate || (this.config.dayBook.periodMode === 'customRange' ? this.config.dayBook.toDate : undefined) || todayStr;
      }
    } else {
      effectivePeriodMode = this.config.dayBook.periodMode || 'today';
      if (effectivePeriodMode === 'customRange') {
        fromDate = this.config.dayBook.fromDate || todayStr;
        toDate = this.config.dayBook.toDate || todayStr;
      } else {
        fromDate = todayStr;
        toDate = todayStr;
      }
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
        exportFolder,
        signal,
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

      // Save file with unique lock protection if not already written to expected path
      let finalFilePath = exportRes.filePath;
      let finalFileName = exportRes.fileName;
      if (!finalFilePath || !fs.existsSync(finalFilePath)) {
        const fileName = buildExportFileName(
          companyName,
          new Date(),
          reportName,
          effectivePeriodMode === 'customRange' ? fromDate : undefined,
          effectivePeriodMode === 'customRange' ? toDate : undefined
        );
        const savedInfo = saveFileWithLockProtection(exportFolder, fileName, exportRes.fileBuffer);
        finalFilePath = savedInfo.filePath;
        finalFileName = savedInfo.fileName;
      }

      const isDayBook = reportName === 'Day Book';
      const createdStatus: 'included' | 'missing (fallback used)' =
        isDayBook ? (exportRes.isFallback ? 'missing (fallback used)' : 'included') : 'included';

      return {
        companyName: displayName,
        status: 'OK',
        fileName: finalFileName,
        filePath: finalFilePath,
        fileBuffer: exportRes.fileBuffer,
        voucherCount: exportRes.voucherCount,
        newOrAlteredCount: exportRes.newOrAlteredCount,
        periodText,
        generatedAt: formatDateTime(new Date()),
        methodUsed: exportRes.methodUsed,
        createdColumnsStatus: createdStatus,
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
    const outDir = this.config?.keepLocalCopies?.outputFolder ? path.resolve(this.config.keepLocalCopies.outputFolder) : getExportsDir();
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
    const retentionDays = this.config?.keepLocalCopies?.retentionDays || 30;
    const outDir = this.config?.keepLocalCopies?.outputFolder ? path.resolve(this.config.keepLocalCopies.outputFolder) : getExportsDir();
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

