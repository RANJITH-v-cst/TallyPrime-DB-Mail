const { loadConfig } = require('../dist/config/config');
const { StateManager } = require('../dist/scheduler/stateManager');
const { ExportOrchestrator } = require('../dist/scheduler/orchestrator');

async function run() {
  console.log('========================================================');
  console.log('STARTING DIRECT DAY BOOK EXPORT & DISPATCH');
  console.log('========================================================');
  
  const config = loadConfig();
  console.log('Tally Host:', config.tally.host, 'Port:', config.tally.port);
  console.log('Export Folder:', config.exportFolder);
  console.log('Recipients:', config.mail.recipients.to);
  
  const stateManager = new StateManager();
  const orchestrator = new ExportOrchestrator(config, stateManager);

  const summary = await orchestrator.runCycle();
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
