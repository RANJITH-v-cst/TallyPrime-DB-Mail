const { TallyClient } = require('../dist/tally/client');
const { CompanyDiscoveryService } = require('../dist/tally/companyDiscovery');

async function test() {
  const client = new TallyClient({ host: '127.0.0.1', port: 9000 });
  const discovery = new CompanyDiscoveryService(client);
  const result = await discovery.discoverCompanies('auto');
  console.log('Open companies:', result.openCompanies);
}
test();
