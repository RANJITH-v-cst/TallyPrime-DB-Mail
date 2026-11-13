process.env.NODE_ENV = 'test';

import {
  startMockTallyServer,
  MOCK_COMPANIES,
  recordedRequests,
  clearRecordedRequests,
  setMockFailingCompany,
} from '../src/mock/mockTallyServer';
import { TallyClient } from '../src/tally/client';
import { CompanyDiscoveryService } from '../src/tally/companyDiscovery';
import { NativeExcelExporter } from '../src/tally/exporters/nativeExporter';
import { XmlRebuildExporter } from '../src/tally/exporters/xmlRebuildExporter';
import { StateManager } from '../src/scheduler/stateManager';
import { ExportOrchestrator } from '../src/scheduler/orchestrator';
import { AppConfig } from '../src/config/types';
import { validateConfig, mergeConfig, DEFAULT_CONFIG } from '../src/config/config';
import { encryptPassword } from '../src/utils/crypto';
import * as path from 'path';
import * as fs from 'fs';

async function runEndToEndVerification() {
  console.log('\n============================================================');
  console.log('🚀 STARTING TALLYDAYBOOKMAILER END-TO-END ACCEPTANCE TESTS');
  console.log('============================================================\n');

  const PORT = 19000;
  const mockServer = await startMockTallyServer(PORT, 'native');

  const testStateFile = path.resolve(process.cwd(), 'test_e2e_state.json');
  const testOutDir = path.resolve(process.cwd(), 'exports_test');

  const cleanTempFiles = () => {
    if (fs.existsSync(testOutDir)) {
      const files = fs.readdirSync(testOutDir);
      files.forEach((f) => {
        try { fs.unlinkSync(path.join(testOutDir, f)); } catch {}
      });
      try { fs.rmdirSync(testOutDir); } catch {}
    }
    if (fs.existsSync(testStateFile)) {
      try { fs.unlinkSync(testStateFile); } catch {}
    }
  };

  cleanTempFiles();

  try {
    const tallyClient = new TallyClient({ host: '127.0.0.1', port: PORT, timeoutMs: 5000 });

    // -------------------------------------------------------------
    // BASE CONNECTIVITY & DISCOVERY
    // -------------------------------------------------------------
    console.log('--- TEST 1: Ping Tally & Discover 5 Companies (including "A & B Traders") ---');
    const isUp = await tallyClient.ping();
    if (!isUp) throw new Error('Mock Tally Server not reachable!');
    console.log('  Ping Result: ✅ ONLINE');

    const discovery = new CompanyDiscoveryService(tallyClient);
    const discResult = await discovery.discoverCompanies('auto');
    console.log(`  Discovered ${discResult.openCompanies.length} Companies: [${discResult.openCompanies.join(', ')}]`);

    if (discResult.openCompanies.length !== 5) {
      throw new Error(`Expected 5 open companies, got ${discResult.openCompanies.length}`);
    }
    const hasSpecialCharCompany = discResult.openCompanies.some((c) => c === 'A & B Traders');
    if (!hasSpecialCharCompany) {
      throw new Error('Expected "A & B Traders" among discovered companies');
    }
    console.log('  ✅ 5 Companies discovered including "A & B Traders".');

    // -------------------------------------------------------------
    // ACCEPTANCE TEST 1:
    // 5 open companies (one "A & B Traders"), Date Range 20261101 to 20261112.
    // Expect 5 .xlsx files, each requested with SVFROMDATE=20261101 and SVTODATE=20261112,
    // and exactly 1 email with 5 attachments.
    // -------------------------------------------------------------
    console.log('\n--- ACCEPTANCE TEST 1: Date Range 20261101 to 20261112 with 5 Companies ---');
    cleanTempFiles();
    clearRecordedRequests();

    const stateManager = new StateManager(testStateFile);

    const baseConfig: AppConfig = {
      tally: { host: '127.0.0.1', port: PORT, timeoutMs: 5000 },
      companies: 'auto',
      dayBook: {
        reportType: 'Day Book',
        periodMode: 'customRange',
        fromDate: '20261101',
        toDate: '20261112',
        voucherTypes: [],
        detailed: true,
        skipIfNoEntries: false,
        exporter: 'auto',
      },
      exportFolder: testOutDir,
      schedule: { mode: 'daily', dailyTime: '20:00', intervalMinutes: 30 },
      smtp: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        user: 'ranjithsvhpc1234@gmail.com',
        password: encryptPassword('sample_password'),
        from: 'Tally DayBook <ranjithsvhpc1234@gmail.com>',
      },
      mail: {
        recipients: {
          to: ['adventsystems.sales6@gmail.com'],
          cc: [],
          bcc: [],
        },
        subjectTemplate: 'Day Book - {CompanyCount} Companies - {dd-MMM-yyyy HH:mm}',
      },
      attachMode: 'separate',
      keepLocalCopies: { enabled: true, outputFolder: testOutDir, retentionDays: 30 },
      webUi: { enabled: false, port: 9095, host: '127.0.0.1' },
    };

    const orchestrator1 = new ExportOrchestrator(baseConfig, stateManager);

    let sentEmails: any[] = [];
    (orchestrator1.getMailer() as any).sendWithRetry = async (options: any) => {
      sentEmails.push(options);
      return true;
    };

    const cycleSummary1 = await orchestrator1.runCycle();
    console.log(`  Cycle summary: ${cycleSummary1.successfulCompanies}/${cycleSummary1.totalCompanies} companies exported successfully.`);
    console.log(`  Email sent: ${cycleSummary1.emailSent ? 'YES' : 'NO'}`);

    if (cycleSummary1.successfulCompanies !== 5) {
      throw new Error(`Expected 5 successful companies, got ${cycleSummary1.successfulCompanies}`);
    }

    // Verify SVFROMDATE=20261101 and SVTODATE=20261112 were requested for every company
    const exportRequests = recordedRequests.filter((r) => r.body.includes('<ID>Day Book</ID>') || r.body.includes('ADV DayBook Coll'));
    if (exportRequests.length < 5) {
      throw new Error(`Expected at least 5 export requests to Tally, found ${exportRequests.length}`);
    }
    for (const req of exportRequests) {
      if (req.svFromDate !== '20261101' || req.svToDate !== '20261112') {
        throw new Error(
          `Request for "${req.companyName}" had incorrect dates: SVFROMDATE=${req.svFromDate}, SVTODATE=${req.svToDate}`
        );
      }
    }
    console.log('  ✅ Every company request included SVFROMDATE=20261101 and SVTODATE=20261112.');

    // Verify 5 .xlsx files saved
    const filesSaved = fs.readdirSync(testOutDir).filter((f) => f.endsWith('.xlsx'));
    console.log(`  Files saved in folder (${filesSaved.length}): [${filesSaved.join(', ')}]`);
    if (filesSaved.length !== 5) {
      throw new Error(`Expected 5 .xlsx files saved, found ${filesSaved.length}`);
    }

    // Verify exactly 1 email with 5 attachments
    if (sentEmails.length !== 1) {
      throw new Error(`Expected exactly 1 email dispatched, got ${sentEmails.length}`);
    }
    const email1 = sentEmails[0];
    if (!email1.attachments || email1.attachments.length !== 5) {
      throw new Error(`Expected 5 email attachments, got ${email1.attachments?.length}`);
    }
    console.log(`  Email Subject: "${email1.subject}"`);
    console.log(`  ✅ Exactly 1 email sent with 5 attachments for all 5 companies.`);

    // -------------------------------------------------------------
    // ACCEPTANCE TEST 2:
    // Date Range saved but old periodMode "today" in config -> still exports the range.
    // -------------------------------------------------------------
    console.log('\n--- ACCEPTANCE TEST 2: Date Range saved in config with old periodMode "today" ---');
    cleanTempFiles();
    clearRecordedRequests();
    sentEmails = [];

    const configWithOldToday: AppConfig = {
      ...baseConfig,
      dayBook: {
        ...baseConfig.dayBook,
        periodMode: 'today', // Old legacy setting in config
        fromDate: '20261101',
        toDate: '20261112',
      },
    };

    const orchestrator2 = new ExportOrchestrator(configWithOldToday, stateManager);
    (orchestrator2.getMailer() as any).sendWithRetry = async (options: any) => {
      sentEmails.push(options);
      return true;
    };

    const cycleSummary2 = await orchestrator2.runCycle();
    if (cycleSummary2.successfulCompanies !== 5) {
      throw new Error(`Expected 5 successful companies, got ${cycleSummary2.successfulCompanies}`);
    }

    const test2Requests = recordedRequests.filter((r) => r.body.includes('<ID>Day Book</ID>') || r.body.includes('ADV DayBook Coll'));
    for (const req of test2Requests) {
      if (req.svFromDate !== '20261101' || req.svToDate !== '20261112') {
        throw new Error(
          `Legacy today config was not overridden by saved date range! Got SVFROMDATE=${req.svFromDate}, SVTODATE=${req.svToDate}`
        );
      }
    }
    console.log('  ✅ Saved Date Range was exported despite old periodMode "today" in config.');

    // -------------------------------------------------------------
    // ACCEPTANCE TEST 3:
    // fromDate > toDate, bad date format -> save rejected with a readable message.
    // -------------------------------------------------------------
    console.log('\n--- ACCEPTANCE TEST 3: Validation of Date Order and Format ---');

    // Case A: fromDate > toDate
    const invalidOrderConfig: Partial<AppConfig> = {
      ...baseConfig,
      dayBook: {
        ...baseConfig.dayBook,
        periodMode: 'customRange',
        fromDate: '20261115',
        toDate: '20261110',
      },
    };
    const orderValidation = validateConfig(invalidOrderConfig);
    console.log(`  fromDate > toDate valid: ${orderValidation.valid}, Errors: ${JSON.stringify(orderValidation.errors)}`);
    if (orderValidation.valid || !orderValidation.errors.some((e) => e.includes('cannot be after To Date'))) {
      throw new Error('Expected validation error for fromDate > toDate');
    }

    // Case B: Bad date format (non-calendar date or bad format)
    const badFormatConfig: Partial<AppConfig> = {
      ...baseConfig,
      dayBook: {
        ...baseConfig.dayBook,
        periodMode: 'customRange',
        fromDate: '2026-11-01', // hyphenated instead of YYYYMMDD
        toDate: '20261112',
      },
    };
    const formatValidation = validateConfig(badFormatConfig);
    console.log(`  Bad format valid: ${formatValidation.valid}, Errors: ${JSON.stringify(formatValidation.errors)}`);
    if (formatValidation.valid || !formatValidation.errors.some((e) => e.includes('not a valid calendar date'))) {
      throw new Error('Expected validation error for bad date format');
    }

    // Case C: Real impossible calendar date e.g. Feb 31
    const impossibleDateConfig: Partial<AppConfig> = {
      ...baseConfig,
      dayBook: {
        ...baseConfig.dayBook,
        periodMode: 'customRange',
        fromDate: '20260231', // Feb 31 does not exist
        toDate: '20261112',
      },
    };
    const impValidation = validateConfig(impossibleDateConfig);
    console.log(`  Impossible date valid: ${impValidation.valid}, Errors: ${JSON.stringify(impValidation.errors)}`);
    if (impValidation.valid || !impValidation.errors.some((e) => e.includes('not a valid calendar date'))) {
      throw new Error('Expected validation error for impossible calendar date 20260231');
    }
    console.log('  ✅ fromDate > toDate and bad date formats rejected with clear readable messages.');

    // -------------------------------------------------------------
    // ACCEPTANCE TEST 4:
    // Multiple voucher types -> all selected types present, none missing.
    // -------------------------------------------------------------
    console.log('\n--- ACCEPTANCE TEST 4: Multiple Voucher Types Filter ---');
    const xmlExporter = new XmlRebuildExporter(tallyClient);
    const multiTypeRes = await xmlExporter.exportDayBook({
      companyName: 'Acme Corp Ltd',
      config: {
        periodMode: 'customRange',
        voucherTypes: ['Sales', 'Payment', 'Contra'],
        detailed: true,
        skipIfNoEntries: false,
        exporter: 'xmlRebuild',
      },
      fromDate: '20261101',
      toDate: '20261112',
    });

    if (!multiTypeRes.success || !multiTypeRes.vouchers) {
      throw new Error('Multi-type export failed');
    }
    const returnedTypes = multiTypeRes.vouchers.map((v) => v.voucherType);
    console.log(`  Returned voucher types: [${returnedTypes.join(', ')}]`);

    // Must contain Sales, Payment, Contra
    if (!returnedTypes.includes('Sales')) throw new Error('Missing "Sales" voucher');
    if (!returnedTypes.includes('Payment')) throw new Error('Missing "Payment" voucher');
    if (!returnedTypes.includes('Contra')) throw new Error('Missing "Contra" voucher');
    // Must NOT contain Receipt or Journal
    if (returnedTypes.includes('Receipt')) throw new Error('Unselected "Receipt" voucher was included');
    if (returnedTypes.includes('Journal')) throw new Error('Unselected "Journal" voucher was included');
    console.log('  ✅ All selected voucher types present (Sales, Payment, Contra), unselected excluded.');

    // -------------------------------------------------------------
    // ACCEPTANCE TEST 5:
    // One company fails -> other 4 files still emailed, failed one listed as FAILED.
    // -------------------------------------------------------------
    console.log('\n--- ACCEPTANCE TEST 5: One Company Fails (Partial Resilience) ---');
    cleanTempFiles();
    clearRecordedRequests();
    sentEmails = [];

    // Make 'Nova Global Trading' fail in mock server
    setMockFailingCompany('Nova Global Trading');

    const orchestrator5 = new ExportOrchestrator(baseConfig, stateManager);
    (orchestrator5.getMailer() as any).sendWithRetry = async (options: any) => {
      sentEmails.push(options);
      return true;
    };

    const cycleSummary5 = await orchestrator5.runCycle();
    console.log(`  Cycle result: Total=${cycleSummary5.totalCompanies}, Successful=${cycleSummary5.successfulCompanies}, Failed=${cycleSummary5.failedCompanies}`);

    if (cycleSummary5.successfulCompanies !== 4) {
      throw new Error(`Expected 4 successful companies, got ${cycleSummary5.successfulCompanies}`);
    }
    if (cycleSummary5.failedCompanies !== 1) {
      throw new Error(`Expected 1 failed company, got ${cycleSummary5.failedCompanies}`);
    }

    const failedRow = cycleSummary5.results.find((r) => r.status === 'FAILED');
    if (!failedRow || !failedRow.companyName.includes('Nova Global Trading')) {
      throw new Error('Expected "Nova Global Trading" to be recorded with status FAILED');
    }
    console.log(`  Failed row properly recorded: "${failedRow.companyName}" -> status: ${failedRow.status}, error: "${failedRow.error}"`);

    // Verify email was still sent with the 4 successful files
    if (sentEmails.length !== 1) {
      throw new Error(`Expected 1 email sent with successful companies, got ${sentEmails.length}`);
    }
    if (sentEmails[0].attachments?.length !== 4) {
      throw new Error(`Expected 4 attachments in email, got ${sentEmails[0].attachments?.length}`);
    }
    console.log('  ✅ Other 4 files still emailed, failed company listed as FAILED in summary.');

    // Reset failing company
    setMockFailingCompany(null);

    // -------------------------------------------------------------
    // ACCEPTANCE TEST 6:
    // Send Now with its own dates overrides saved dates for that run only.
    // -------------------------------------------------------------
    console.log('\n--- ACCEPTANCE TEST 6: Send Now Date Override (Single-Run) ---');
    cleanTempFiles();
    clearRecordedRequests();
    sentEmails = [];

    const orchestrator6 = new ExportOrchestrator(baseConfig, stateManager);
    (orchestrator6.getMailer() as any).sendWithRetry = async (options: any) => {
      sentEmails.push(options);
      return true;
    };

    // Run 1: Send Now with override dates 20261105 to 20261108
    console.log('  Triggering Send Now with override: 20261105 to 20261108...');
    await orchestrator6.runCycle({
      fromDate: '20261105',
      toDate: '20261108',
      periodMode: 'customRange',
    });

    const run1Requests = recordedRequests.filter((r) => r.body.includes('<ID>Day Book</ID>') || r.body.includes('ADV DayBook Coll'));
    for (const req of run1Requests) {
      if (req.svFromDate !== '20261105' || req.svToDate !== '20261108') {
        throw new Error(
          `Override dates not applied! Expected 20261105 to 20261108, got ${req.svFromDate} to ${req.svToDate}`
        );
      }
    }
    console.log('  ✅ Run 1 applied override dates: 20261105 to 20261108.');

    // Run 2: Normal run without overrides (should revert back to saved dates: 20261101 to 20261112)
    clearRecordedRequests();
    console.log('  Triggering normal run without overrides...');
    await orchestrator6.runCycle();

    const run2Requests = recordedRequests.filter((r) => r.body.includes('<ID>Day Book</ID>') || r.body.includes('ADV DayBook Coll'));
    for (const req of run2Requests) {
      if (req.svFromDate !== '20261101' || req.svToDate !== '20261112') {
        throw new Error(
          `Subsequent run did not revert to saved dates! Expected 20261101 to 20261112, got ${req.svFromDate} to ${req.svToDate}`
        );
      }
    }
    console.log('  ✅ Run 2 reverted back to saved dates: 20261101 to 20261112.');

    // Clean up
    cleanTempFiles();

    console.log('\n============================================================');
    console.log('🎉 ALL 6 ACCEPTANCE TESTS PASSED ACCURATELY & FLAWLESSLY!');
    console.log('============================================================\n');
  } finally {
    mockServer.close();
  }
}

runEndToEndVerification().catch((err) => {
  console.error('\n❌ ACCEPTANCE TEST FAILED:', err);
  process.exit(1);
});
