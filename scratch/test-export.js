const { TallyClient } = require('../dist/tally/client');
const { ExporterFactory } = require('../dist/tally/exporterFactory');

async function test(date) {
  console.log('Testing export for date:', date);
  const client = new TallyClient({ host: '127.0.0.1', port: 9000 });
  const factory = new ExporterFactory(client);
  const startTime = Date.now();
  const res = await factory.export({
    companyName: 'Surya Elct',
    config: {
      reportType: 'Day Book',
      periodMode: 'today',
      voucherTypes: [],
      detailed: true,
      skipIfNoEntries: false,
      exporter: 'auto',
      tdlEnabled: false
    },
    fromDate: date,
    toDate: date,
    reportId: 'Day Book',
    exportFolder: './exports'
  });
  console.log(`Date ${date} took ${((Date.now() - startTime)/1000).toFixed(1)}s:`, res.success, 'vouchers:', res.voucherCount, 'error:', res.error, 'method:', res.methodUsed);
}

test('20261116');
