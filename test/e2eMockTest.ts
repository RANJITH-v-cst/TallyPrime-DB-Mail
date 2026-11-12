import { startMockTallyServer, MOCK_COMPANIES } from '../src/mock/mockTallyServer';
import { TallyClient } from '../src/tally/client';
import { CompanyDiscoveryService } from '../src/tally/companyDiscovery';
import { NativeExcelExporter } from '../src/tally/exporters/nativeExporter';
import { XmlRebuildExporter } from '../src/tally/exporters/xmlRebuildExporter';
import { ExporterFactory } from '../src/tally/exporterFactory';
import { StateManager } from '../src/scheduler/stateManager';
import { ExportOrchestrator } from '../src/scheduler/orchestrator';
import { AppConfig } from '../src/config/types';
import * as path from 'path';
import * as fs from 'fs';

async function runEndToEndVerification() {
  console.log('\n============================================================');
  console.log('🚀 STARTING TALLYDAYBOOKMAILER END-TO-END MOCK SERVER TEST');
  console.log('============================================================\n');

  const PORT = 19000;
  const mockServer = await startMockTallyServer(PORT, 'native');

  try {
    // 1. Setup Client
    const tallyClient = new TallyClient({ host: '127.0.0.1', port: PORT, timeoutMs: 5000 });

    // Test Connectivity / Ping
    console.log('--- TEST 1: Ping Tally Server ---');
    const isUp = await tallyClient.ping();
    console.log(`Ping Result: ${isUp ? '✅ ONLINE' : '❌ OFFLINE'}`);
    if (!isUp) throw new Error('Mock Tally Server not reachable!');

    // Test Step 1: Discover Open Companies
    console.log('\n--- TEST 2: Step 1 - Discover 5 Open Companies via XML ---');
    const discovery = new CompanyDiscoveryService(tallyClient);
    const discResult = await discovery.discoverCompanies('auto');
    console.log(`Discovered Companies (${discResult.openCompanies.length}):`);
    discResult.openCompanies.forEach((c, idx) => console.log(`  ${idx + 1}. [TAB ${idx + 1}] ${c}`));

    if (discResult.openCompanies.length !== 5) {
      throw new Error(`Expected 5 open companies, got ${discResult.openCompanies.length}`);
    }
    console.log('✅ Company discovery verified.');

    // Test Step 2: Native Excel Export
    console.log('\n--- TEST 3: Step 2 - Native Excel Export for Acme Corp Ltd ---');
    const nativeExporter = new NativeExcelExporter(tallyClient);
    const nativeRes = await nativeExporter.exportDayBook({
      companyName: 'Acme Corp Ltd',
      config: {
        periodMode: 'today',
        voucherTypes: [],
        detailed: true,
        skipIfNoEntries: false,
        exporter: 'native',
      },
      fromDate: '20261112',
      toDate: '20261112',
    });

    console.log(`Native Export Success: ${nativeRes.success}`);
    console.log(`Response Size: ${nativeRes.fileBuffer?.length} bytes`);
    const isPk = nativeRes.fileBuffer ? NativeExcelExporter.isValidXlsxBuffer(nativeRes.fileBuffer) : false;
    console.log(`Valid PK/Zip XLSX Header: ${isPk ? '✅ YES (PK magic bytes verified)' : '❌ NO'}`);
    if (!nativeRes.success || !isPk) throw new Error('Native Excel export failed or invalid PK header');

    // Test Step 3: XML Rebuild Fallback Exporter
    console.log('\n--- TEST 4: Step 3 - XML Rebuild Fallback Exporter with ExcelJS ---');
    const xmlExporter = new XmlRebuildExporter(tallyClient);
    const xmlRes = await xmlExporter.exportDayBook({
      companyName: 'Starlight Industries Pvt Ltd',
      config: {
        periodMode: 'today',
        voucherTypes: [],
        detailed: true,
        skipIfNoEntries: false,
        exporter: 'xmlRebuild',
      },
      fromDate: '20261112',
      toDate: '20261112',
    });

    console.log(`XML Rebuild Success: ${xmlRes.success}`);
    console.log(`Parsed Vouchers: ${xmlRes.voucherCount}`);
    console.log(`Generated XLSX Size: ${xmlRes.fileBuffer?.length} bytes`);
    const isRebuildPk = xmlRes.fileBuffer ? NativeExcelExporter.isValidXlsxBuffer(xmlRes.fileBuffer) : false;
    console.log(`Valid ExcelJS XLSX Header: ${isRebuildPk ? '✅ YES' : '❌ NO'}`);
    if (!xmlRes.success || !isRebuildPk) throw new Error('XML Rebuild exporter failed');

    // Test Step 4: SinceLastRun Mode & ALTERID Tracking
    console.log('\n--- TEST 5: Step 4 - Since-Last-Run Incremental Mode ---');
    const testStateFile = path.resolve(process.cwd(), 'test_e2e_state.json');
    if (fs.existsSync(testStateFile)) fs.unlinkSync(testStateFile);
    const stateManager = new StateManager(testStateFile);

    // Initial run (exports all vouchers, records max ALTERID)
    stateManager.updateCompanyState('Acme Corp Ltd', {
      lastMaxAlterId: 10051, // Simulate previous seen ALTERID = 10051
      lastDate: '20261112',
    });

    const deltaRes = await xmlExporter.exportDayBook({
      companyName: 'Acme Corp Ltd',
      config: {
        periodMode: 'sinceLastRun',
        voucherTypes: [],
        detailed: true,
        skipIfNoEntries: false,
        exporter: 'xmlRebuild',
      },
      fromDate: '20261112',
      toDate: '20261112',
      sinceAlterId: 10051,
    });

    console.log(`Initial Max ALTERID filter: 10051`);
    console.log(`Vouchers returned after filter (ALTERID > 10051): ${deltaRes.voucherCount}`);
    console.log(`New/Altered Vouchers: ${deltaRes.newOrAlteredCount}`);
    // In our sample XML, ALTERIDs are 10051, 10052, 10053. With filter > 10051, exactly 2 vouchers are new/altered!
    if (deltaRes.newOrAlteredCount !== 2) {
      throw new Error(`Expected 2 new/altered vouchers, got ${deltaRes.newOrAlteredCount}`);
    }
    console.log('✅ Since-last-run incremental filter verified.');

    // Test Full Orchestration Cycle with 5 Companies
    console.log('\n--- TEST 6: Full Orchestrated Cycle for All 5 Companies ---');
    const testConfig: AppConfig = {
      tally: { host: '127.0.0.1', port: PORT, timeoutMs: 5000 },
      companies: 'auto',
      dayBook: {
        periodMode: 'today',
        voucherTypes: [],
        detailed: true,
        skipIfNoEntries: false,
        exporter: 'auto',
      },
      schedule: { intervalMinutes: 30 },
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'mailer@example.com',
        password: 'samplePassword',
        from: 'Tally DayBook <mailer@example.com>',
      },
      mail: {
        recipients: { to: ['accounts@example.com'] },
        subjectTemplate: 'Day Book - {CompanyCount} Companies - {dd-MMM-yyyy HH:mm}',
      },
      exportFolder: './exports_test',
      attachMode: 'separate',
      keepLocalCopies: {
        enabled: true,
        outputFolder: './exports_test',
        retentionDays: 30,
      },
      webUi: { enabled: false, port: 9095, host: '127.0.0.1' },
    };

    const orchestrator = new ExportOrchestrator(testConfig, stateManager);

    // Mock the mailer's actual SMTP dispatch so it doesn't fail trying to reach an external server
    const mailer = orchestrator.getMailer();
    let sentEmailOptions: any = null;
    (mailer as any).sendWithRetry = async (options: any) => {
      sentEmailOptions = options;
      console.log(`[MockSMTP] Dispatching email to: ${JSON.stringify(options.to)}`);
      console.log(`[MockSMTP] Subject: "${options.subject}"`);
      console.log(`[MockSMTP] Attachments Count: ${options.attachments?.length}`);
      options.attachments?.forEach((a: any, i: number) => {
        console.log(`  Attachment ${i + 1}: ${a.filename} (${a.content?.length} bytes)`);
      });
      return true;
    };

    const cycleSummary = await orchestrator.runCycle();

    console.log('\n--- SUMMARY OF EXPORT CYCLE ---');
    console.log(`Total Companies: ${cycleSummary.totalCompanies}`);
    console.log(`Successful: ${cycleSummary.successfulCompanies}`);
    console.log(`Failed: ${cycleSummary.failedCompanies}`);
    console.log(`Email Sent: ${cycleSummary.emailSent ? '✅ YES' : '❌ NO'}`);

    if (cycleSummary.successfulCompanies !== 5) {
      throw new Error(`Expected 5 successful companies, got ${cycleSummary.successfulCompanies}`);
    }

    if (!sentEmailOptions || sentEmailOptions.attachments.length !== 5) {
      throw new Error(`Expected 5 email attachments for the 5 companies, got ${sentEmailOptions?.attachments?.length}`);
    }

    // Verify local copies were saved in ./exports_test
    const testOutDir = path.resolve(process.cwd(), './exports_test');
    const savedFiles = fs.readdirSync(testOutDir);
    console.log(`Saved local files in ./exports_test: [${savedFiles.join(', ')}]`);
    if (savedFiles.length !== 5) {
      throw new Error(`Expected 5 saved files, found ${savedFiles.length}`);
    }

    // Clean test exports and state
    savedFiles.forEach((f) => fs.unlinkSync(path.join(testOutDir, f)));
    fs.rmdirSync(testOutDir);
    if (fs.existsSync(testStateFile)) fs.unlinkSync(testStateFile);

    console.log('\n============================================================');
    console.log('🎉 ALL END-TO-END MOCK SERVER TESTS PASSED PERFECTLY!');
    console.log('============================================================\n');
  } finally {
    mockServer.close();
  }
}

runEndToEndVerification().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
