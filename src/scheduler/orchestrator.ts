import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, CompanyExportResult, ExportCycleSummary } from '../config/types';
import { TallyClient } from '../tally/client';
import { CompanyDiscoveryService } from '../tally/companyDiscovery';
import { ExporterFactory } from '../tally/exporterFactory';
import { StateManager } from './stateManager';
import { MailerService } from '../mailer/mailer';
import { buildExportFileName } from '../utils/sanitizer';
import { formatDateTime } from '../mailer/templates';
import { logger } from '../utils/logger';

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
   */
  public async runCycle(overrideOptions?: { recipients?: string[]; reportType?: string }): Promise<ExportCycleSummary> {
    if (this.isCycleRunning) {
      logger.warn('Previous export cycle is still running. Skipping current trigger.');
      throw new Error('An export cycle is already in progress');
    }

    this.isCycleRunning = true;
    const startTime = new Date();
    const cycleDateStr = this.toYyyyMmDd(startTime);
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
      this.stateManager.clearTallyDownAlert();

      // Step 1: Discover open companies
      const discovery = await this.discoveryService.discoverCompanies(this.config.companies);
      const targetCompanies = this.config.companies === 'auto'
        ? discovery.openCompanies
        : this.config.companies;

      if (targetCompanies.length === 0) {
        logger.warn('No open companies found in TallyPrime. Nothing to export.');
      }

      // Determine reports to export: 'Day Book', 'Balance Sheet', or both
      const reportsToExport = activeReportType === 'Both' ? ['Day Book', 'Balance Sheet'] : [activeReportType];

      // Sequential export for each company (60s timeout per company)
      for (const company of targetCompanies) {
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

        // Export each requested report for this company
        for (const rep of reportsToExport) {
          const result = await this.exportSingleCompany(company, cycleDateStr, rep);
          results.push(result);
        }
      }

      // Save local copies and retention cleanup
      if (this.config.keepLocalCopies.enabled) {
        this.saveLocalCopies(results);
        this.cleanOldLocalCopies();
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

      // Step 5: Send Email
      logger.info(`Dispatching export summary email for ${results.length} exports...`);
      const effectiveConfig: AppConfig = {
        ...this.config,
        mail: {
          ...this.config.mail,
          recipients: {
            ...this.config.mail.recipients,
            to: overrideOptions?.recipients && overrideOptions.recipients.length > 0
              ? overrideOptions.recipients
              : this.config.mail.recipients.to,
          },
        },
      };

      const emailSent = await this.mailer.sendDayBookEmail({
        summary,
        config: effectiveConfig,
        date: startTime,
      });

      summary.emailSent = emailSent;
      this.stateManager.setLastCycleTime(completedTime.toISOString());

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
   */
  private async exportSingleCompany(companyName: string, todayStr: string, reportName: string = 'Day Book'): Promise<CompanyExportResult> {
    const compState = this.stateManager.getCompanyState(companyName);
    const periodMode = this.config.dayBook.periodMode;

    let fromDate = todayStr;
    let toDate = todayStr;
    let sinceAlterId: number | undefined = undefined;

    if (periodMode === 'customRange') {
      fromDate = this.config.dayBook.fromDate || todayStr;
      toDate = this.config.dayBook.toDate || todayStr;
    } else if (periodMode === 'sinceLastRun' && reportName === 'Day Book') {
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

      // Determine new max Alter ID for sinceLastRun
      let maxAlterId = compState.lastMaxAlterId || 0;
      if (exportRes.vouchers && exportRes.vouchers.length > 0) {
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

      const fileName = buildExportFileName(companyName, new Date(), reportName);

      return {
        companyName: displayName,
        status: 'OK',
        fileName,
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
   