const { loadConfig } = require('../dist/config/config');
const { StateManager } = require('../dist/scheduler/stateManager');
const { ExportOrchestrator } = require('../dist/scheduler/orchestrator');

async function run() {
  const args = process.argv.slice(2);
  const fromDate = args[0]; // e.g. 20260401
  const toDate = args[1] || fromDate; // if only 1 date passed, use it as single-day period
  const reportType = args[2] || 'Day Book';

  console.log('========================================================');
  console.log('TALLY AUTOMATIC EXPORT & DISPATCH');
  if (fromDate) {
    console.log(`Period: ${fromDate} to ${toDate}`);
  } else {
    console.log('Period: Configured Mode (Today)');
  }
  console.log('========================================================');
  
  const config = loadConfig();
  console.log('Tally Host:', config.tally.host, 'Port:', config.tally.port);
  console.log('Export Folder:', config.exportFolder);
  console.log('Recipients:', config.mail.recipients.to);
  
  const stateManager = new StateManager();
  const orchestrator = new ExportOrchestrator(config, stateManager);

  const overrideOptions = {
    reportType,
  };

  if (fromDate) {
    overrideOptions.periodMode = 'customRange';
    overrideOptions.fromDate = fromDate;
    overrideOptions.toDate = toDate;
  }

  const summary = await orchestrator.runCycle(overrideOptions);
  console.log('\n========================================================');
  console.log('CYCLE EXECUTION SUMMARY:');
  console.log('Success Count:', summary.successfulCompanies);
  console.log('Failed Count:', summary.failedCompanies);
  console.log('Email Sent:', summary.emailSent);
  if (summary.emailError) {
    console.log('Email Error:', summary.emailError);
  }
  summary.results.forEach((r, idx) => {
    console.log(`\nResult #${idx + 1} for "${r.companyName}":`);
    console.log(`  Status: ${r.status}`);
    console.log(`  Period: ${r.periodText}`);
    console.log(`  Voucher Count: ${r.voucherCount}`);
    console.log(`  File Name: ${r.fileName || 'N/A'}`);
    console.log(`  File Path: ${r.filePath || 'N/A'}`);
    if (r.error) console.log(`  Error: ${r.error}`);
  });
  console.log('========================================================\n');
}

run().catch((err) => {
  console.error('Fatal Direct Export Failure:', err);
  process.exit(1);
});
