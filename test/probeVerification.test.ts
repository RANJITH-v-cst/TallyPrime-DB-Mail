import * as fs from 'fs';
import * as path from 'path';
import { startMockTallyServer } from '../src/mock/mockTallyServer';
import { TallyClient } from '../src/tally/client';
import { NativeExcelExporter } from '../src/tally/exporters/nativeExporter';
import { verifyExportedExcel } from '../src/cli/probe';
import { sanitizeCompanyForFilename } from '../src/tally/exporters/nativeExporter';

describe('Tally Day Book Native Probe Verification', () => {
  let server: any;
  const PORT = 19001;
  const debugDir = path.resolve(process.cwd(), 'debug');

  beforeAll(async () => {
    server = await startMockTallyServer(PORT, 'native');
    process.env.DEBUG_TALLY_REQUEST = 'true';
  });

  afterAll((done) => {
    delete process.env.DEBUG_TALLY_REQUEST;
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  test('Native Day Book request generates exact XML matching Tally Export button', () => {
    const tallyClient = new TallyClient({ host: '127.0.0.1', port: PORT });
    const exporter = new NativeExcelExporter(tallyClient);

    const xml = exporter.buildExportXml({
      companyName: '`Ranjith Enterprices',
      config: {
        detailed: true,
        periodMode: 'customRange',
        voucherTypes: [],
        skipIfNoEntries: false,
        exporter: 'native',
      },
      fromDate: '20260401',
      toDate: '20260410',
      reportId: 'Day Book',
    });

    expect(xml).toContain('<ID>Day Book</ID>');
    expect(xml).toContain('<TYPE>Data</TYPE>');
    expect(xml).toContain('<TALLYREQUEST>Export</TALLYREQUEST>');
    expect(xml).toContain('<SVCURRENTCOMPANY>`Ranjith Enterprices</SVCURRENTCOMPANY>');
    expect(xml).toContain('<SVFROMDATE TYPE="Date">1-Apr-2026</SVFROMDATE>');
    expect(xml).toContain('<SVTODATE TYPE="Date">10-Apr-2026</SVTODATE>');
    expect(xml).toContain('<SVEXPORTFORMAT>$$SysName:Excel</SVEXPORTFORMAT>');
    expect(xml).toContain('<EXPLODEFLAG>Yes</EXPLODEFLAG>');
    expect(xml).toContain('<EXPLODEVNUM>Yes</EXPLODEVNUM>');
    expect(xml).toContain('<VOUCHERTYPENAME>$$SysName:AllItems</VOUCHERTYPENAME>');
  });

  test('Optional TDL injection inserts <TDL><TDLMESSAGE> into <DESC>', () => {
    const tallyClient = new TallyClient({ host: '127.0.0.1', port: PORT });
    const exporter = new NativeExcelExporter(tallyClient);

    // Create a temporary sample TDL file
    const sampleTdlPath = path.resolve(process.cwd(), 'debug', 'sample_test.tdl');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    fs.writeFileSync(sampleTdlPath, '[#Line: DB Body]\n  Add: Fields: CreatedBy, CreatedTime', 'utf8');

    try {
      const xml = exporter.buildExportXml({
        companyName: '`Ranjith Enterprices',
        config: {
          detailed: true,
          periodMode: 'today',
          voucherTypes: [],
          skipIfNoEntries: false,
          exporter: 'native',
          tdlFilePath: sampleTdlPath,
          tdlEnabled: true,
        },
        fromDate: '20260401',
        toDate: '20260401',
      });

      expect(xml).toContain('<TDL>');
      expect(xml).toContain('<TDLMESSAGE><![CDATA[[#Line: DB Body]');
      expect(xml).toContain('Add: Fields: CreatedBy, CreatedTime');
      expect(xml).toContain(']]></TDLMESSAGE>');
    } finally {
      if (fs.existsSync(sampleTdlPath)) fs.unlinkSync(sampleTdlPath);
    }
  });

  test('Probe saves request XML, raw response XLSX, and verifies Created By / Created Time columns', async () => {
    const tallyClient = new TallyClient({ host: '127.0.0.1', port: PORT });
    const exporter = new NativeExcelExporter(tallyClient);

    const result = await exporter.exportDayBook({
      companyName: '`Ranjith Enterprices',
      config: {
        detailed: true,
        periodMode: 'customRange',
        voucherTypes: [],
        skipIfNoEntries: false,
        exporter: 'native',
      },
      fromDate: '20260401',
      toDate: '20260410',
      reportId: 'Day Book',
    });

    expect(result.success).toBe(true);
    expect(result.fileBuffer).toBeDefined();

    // Verify debug files were written
    const cleanName = sanitizeCompanyForFilename('`Ranjith Enterprices');
    const requestFile = path.join(debugDir, `${cleanName}_request.xml`);
    const responseFile = path.join(debugDir, `${cleanName}_response.xlsx`);

    expect(fs.existsSync(requestFile)).toBe(true);
    expect(fs.existsSync(responseFile)).toBe(true);

    const savedBuf = fs.readFileSync(responseFile);
    expect(savedBuf[0]).toBe(0x50); // 'P'
    expect(savedBuf[1]).toBe(0x4b); // 'K'

    // STEP 4 Verification
    const verification = await verifyExportedExcel(responseFile);
    expect(verification.headerPass).toBe(true);
    expect(verification.vouchersPass).toBe(true);
    expect(verification.totalAlignedPass).toBe(true);
  });
});

