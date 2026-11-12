"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportOrchestrator = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const client_1 = require("../tally/client");
const companyDiscovery_1 = require("../tally/companyDiscovery");
const exporterFactory_1 = require("../tally/exporterFactory");
const mailer_1 = require("../mailer/mailer");
const sanitizer_1 = require("../utils/sanitizer");
const templates_1 = require("../mailer/templates");
const logger_1 = require("../utils/logger");
class ExportOrchestrator {
    config;
    stateManager;
    tallyClient;
    discoveryService;
    exporterFactory;
    mailer;
    isCycleRunning = false;
    constructor(config, stateManager) {
        this.config = config;
        this.stateManager = stateManager;
        this.tallyClient = new client_1.TallyClient(config.tally);
        this.discoveryService = new companyDiscovery_1.CompanyDiscoveryService(this.tallyClient);
        this.exporterFactory = new exporterFactory_1.ExporterFactory(this.tallyClient);
        this.mailer = new mailer_1.MailerService(config);
    }
    updateConfig(newConfig) {
        this.config = newConfig;
        this.tallyClient = new client_1.TallyClient(newConfig.tally);
        this.discoveryService = new companyDiscovery_1.CompanyDiscoveryService(this.tallyClient);
        this.exporterFactory = new exporterFactory_1.ExporterFactory(this.tallyClient);
        this.mailer.initTransporter(newConfig);
    }
    getIsRunning() {
        return this.isCycleRunning;
    }
    /**
     * Helper to format Date into YYYYMMDD
     */
    toYyyyMmDd(d = new Date()) {
        const pad = (n) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    }
    /**
     * Runs a complete export cycle across all open/configured companies sequentially.
     */
    async runCycle() {
        if (this.isCycleRunning) {
            logger_1.logger.warn('Previous export cycle is still running. Skipping current trigger.');
            throw new Error('An export cycle is already in progress');
        }
        this.isCycleRunning = true;
        const startTime = new Date();
        const cycleDateStr = this.toYyyyMmDd(startTime);
        logger_1.logger.info('=====================================================');
        logger_1.logger.info(`Starting TallyDayBook export cycle at ${(0, templates_1.formatDateTime)(startTime)}`);
        logger_1.logger.info('=====================================================');
        const results = [];
        try {
            // Step 1: Check Tally connection & discover open companies
            const isReachable = await this.tallyClient.ping();
            if (!isReachable) {
                const errorMsg = `TallyPrime is unreachable at ${this.config.tally.host}:${this.config.tally.port}. Check if Tally is running.`;
                logger_1.logger.error(errorMsg);
                if (this.stateManager.shouldSendTallyDownAlert()) {
                    logger_1.logger.warn('Sending hourly Tally-down alert email...');
                    await this.mailer.sendAlert('TallyPrime Disconnected Alert', errorMsg, 'Ensure TallyPrime is open, company is loaded, and Settings > Connectivity has HTTP/ODBC enabled.');
                    this.stateManager.recordTallyDownAlertSent();
                }
                const failureSummary = {
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
                logger_1.logger.warn('No open companies found in TallyPrime. Nothing to export.');
            }
            // Sequential export for each company (60s timeout per company)
            for (const company of targetCompanies) {
                const isCompanyOpen = discovery.openCompanies.some((c) => c.toLowerCase() === company.toLowerCase());
                if (!isCompanyOpen) {
                    logger_1.logger.warn(`Configured company "${company}" is NOT open in TallyPrime. Marking FAILED.`);
                    results.push({
                        companyName: company,
                        status: 'FAILED',
                        voucherCount: 0,
                        periodText: 'Company Not Loaded',
                        generatedAt: (0, templates_1.formatDateTime)(new Date()),
                        error: 'Company is not open in TallyPrime tabs',
                    });
                    continue;
                }
                // Export this company
                const result = await this.exportSingleCompany(company, cycleDateStr);
                results.push(result);
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
            const summary = {
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
            logger_1.logger.info(`Dispatching export summary email for ${results.length} companies...`);
            const emailSent = await this.mailer.sendDayBookEmail({
                summary,
                config: this.config,
                date: startTime,
            });
            summary.emailSent = emailSent;
            this.stateManager.setLastCycleTime(completedTime.toISOString());
            logger_1.logger.info('=====================================================');
            logger_1.logger.info(`Export cycle finished in ${((completedTime.getTime() - startTime.getTime()) / 1000).toFixed(1)}s (Success: ${successCount}, Failed: ${failedCount}, Skipped: ${skippedCount})`);
            logger_1.logger.info('=====================================================');
            return summary;
        }
        finally {
            this.isCycleRunning = false;
        }
    }
    /**
     * Exports Day Book for a single company with period and state handling
     */
    async exportSingleCompany(companyName, todayStr) {
        const compState = this.stateManager.getCompanyState(companyName);
        const periodMode = this.config.dayBook.periodMode;
        let fromDate = todayStr;
        let toDate = todayStr;
        let sinceAlterId = undefined;
        if (periodMode === 'customRange') {
            fromDate = this.config.dayBook.fromDate || todayStr;
            toDate = this.config.dayBook.toDate || todayStr;
        }
        else if (periodMode === 'sinceLastRun') {
            // Midnight rollover check
            const isNewDay = this.stateManager.isMidnightRollover(companyName, todayStr);
            if (isNewDay) {
                logger_1.logger.info(`Midnight rollover detected for "${companyName}". Resetting incremental state.`);
                sinceAlterId = undefined;
            }
            else {
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
            });
            if (!exportRes.success || !exportRes.fileBuffer) {
                this.stateManager.updateCompanyState(companyName, {
                    lastStatus: 'FAILED',
                    lastError: exportRes.error || 'Failed to export',
                    lastDate: todayStr,
                });
                return {
                    companyName,
                    status: 'FAILED',
                    voucherCount: exportRes.voucherCount,
                    periodText,
                    generatedAt: (0, templates_1.formatDateTime)(new Date()),
                    error: exportRes.error || 'Export failed',
                    methodUsed: exportRes.methodUsed,
                };
            }
            // Check if skipIfNoEntries is enabled and voucher count is 0
            if (this.config.dayBook.skipIfNoEntries && exportRes.voucherCount === 0) {
                logger_1.logger.info(`Skipping file attachment for "${companyName}" because voucher count is 0.`);
                this.stateManager.updateCompanyState(companyName, {
                    lastStatus: 'NO ENTRIES',
                    lastVoucherCount: 0,
                    lastDate: todayStr,
                    lastRunTimestamp: new Date().toISOString(),
                });
                return {
                    companyName,
                    status: 'NO ENTRIES',
                    voucherCount: 0,
                    periodText,
                    generatedAt: (0, templates_1.formatDateTime)(new Date()),
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
            const fileName = (0, sanitizer_1.buildExportFileName)(companyName, new Date());
            return {
                companyName,
                status: 'OK',
                fileName,
                fileBuffer: exportRes.fileBuffer,
                voucherCount: exportRes.voucherCount,
                newOrAlteredCount: exportRes.newOrAlteredCount,
                periodText,
                generatedAt: (0, templates_1.formatDateTime)(new Date()),
                methodUsed: exportRes.methodUsed,
            };
        }
        catch (err) {
            logger_1.logger.error(`Unexpected error during export of "${companyName}": ${err.message}`);
            return {
                companyName,
                status: 'FAILED',
                voucherCount: 0,
                periodText,
                generatedAt: (0, templates_1.formatDateTime)(new Date()),
                error: err.message,
            };
        }
    }
    /**
     * Saves copies of exported .xlsx files to the configured local folder
     */
    saveLocalCopies(results) {
        const outDir = path.resolve(process.cwd(), this.config.keepLocalCopies.outputFolder || './exports');
        if (!fs.existsSync(outDir)) {
            try {
                fs.mkdirSync(outDir, { recursive: true });
            }
            catch (err) {
                logger_1.logger.error(`Failed to create export folder ${outDir}: ${err.message}`);
                return;
            }
        }
        for (const res of results) {
            if (res.status === 'OK' && res.fileBuffer && res.fileName) {
                try {
                    const filePath = path.join(outDir, res.fileName);
                    fs.writeFileSync(filePath, res.fileBuffer);
                    res.filePath = filePath;
                    logger_1.logger.info(`Saved local copy: ${filePath}`);
                }
                catch (err) {
                    logger_1.logger.error(`Error saving local copy for "${res.companyName}": ${err.message}`);
                }
            }
        }
    }
    /**
     * Cleans up local copies older than retentionDays
     */
    cleanOldLocalCopies() {
        const retentionDays = this.config.keepLocalCopies.retentionDays || 30;
        const outDir = path.resolve(process.cwd(), this.config.keepLocalCopies.outputFolder || './exports');
        if (!fs.existsSync(outDir))
            return;
        try {
            const files = fs.readdirSync(outDir);
            const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
            for (const file of files) {
                if (!file.endsWith('.xlsx') && !file.endsWith('.zip'))
                    continue;
                const filePath = path.join(outDir, file);
                const stats = fs.statSync(filePath);
                if (stats.mtimeMs < cutoffTime) {
                    fs.unlinkSync(filePath);
                    logger_1.logger.info(`Removed expired local export file: ${file}`);
                }
            }
        }
        catch (err) {
            logger_1.logger.warn(`Error during local copies retention cleanup: ${err.message}`);
        }
    }
    getDiscoveryService() {
        return this.discoveryService;
    }
    getMailer() {
        return this.mailer;
    }
}
exports.ExportOrchestrator = ExportOrchestrator;
//# sourceMappingURL=orchestrator.js.map