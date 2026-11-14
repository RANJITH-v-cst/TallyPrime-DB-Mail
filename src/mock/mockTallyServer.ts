import http from 'http';
import ExcelJS from 'exceljs';

const PORT = 9000;

export const MOCK_COMPANIES = [
  'Acme Corp Ltd',
  'Starlight Industries Pvt Ltd',
  'A & B Traders',
  'Nova Global Trading',
  'Zenith Enterprises',
];

export interface MockRecordedRequest {
  companyName: string;
  svFromDate?: string;
  svToDate?: string;
  voucherTypeName?: string;
  body: string;
}

export const recordedRequests: MockRecordedRequest[] = [];
export function clearRecordedRequests(): void {
  recordedRequests.length = 0;
}

let mockFailingCompany: string | null = null;
export function setMockFailingCompany(comp: string | null): void {
  mockFailingCompany = comp;
}

/**
 * Creates a sample XLSX buffer with PK magic header
 */
async function generateSampleExcel(companyName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Day Book');

  ws.mergeCells('A1:H1');
  ws.getCell('A1').value = companyName;
  ws.getCell('A1').font = { bold: true, size: 14 };

  ws.mergeCells('A2:H2');
  ws.getCell('A2').value = 'Day Book - TallyPrime Native Export Simulation';

  ws.getRow(4).values = [
    'Date',
    'Particulars',
    'Created By',
    'Created Time',
    'Vch Type',
    'Vch No.',
    'Debit Amount',
    'Credit Amount',
  ];
  ws.getRow(4).font = { bold: true };

  ws.addRow(['12-Nov-26', 'Customer Alpha', 'admin', '10:30 AM', 'Sales', 'INV-001', 54200.00, '']);
  ws.addRow(['12-Nov-26', 'Vendor Beta', 'ranjith', '11:15 AM', 'Payment', 'PV-042', '', 18500.00]);
  ws.addRow(['12-Nov-26', 'Cash Account', 'operator1', '02:45 PM', 'Receipt', 'RV-108', 25000.00, '']);

  const totalRow = ws.addRow(['', 'Total', '', '', '', '', 79200.00, 18500.00]);
  totalRow.font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * Generates sample Tally XML response for Day Book vouchers
 */
function generateSampleVouchersXml(companyName: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <STATUS>1</STATUS>
 </HEADER>
 <BODY>
  <DATA>
   <COLLECTION>
    <!-- Voucher 1: Sales -->
    <VOUCHER>
     <DATE>20261112</DATE>
     <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
     <VOUCHERNUMBER>SAL-1001</VOUCHERNUMBER>
     <PARTYLEDGERNAME>Acme Retail Buyers</PARTYLEDGERNAME>
     <NARRATION>Being goods sold on 30 days credit</NARRATION>
     <AMOUNT>150000.00</AMOUNT>
     <ALTERID>10051</ALTERID>
     <MASTERID>5001</MASTERID>
     <ADVCREATEDBY>admin</ADVCREATEDBY>
     <ADVCREATEDTIME>10:30 AM</ADVCREATEDTIME>
     <CREATEDUSERNAME>admin</CREATEDUSERNAME>
     <CREATEDUSERTIME>10:30 AM</CREATEDUSERTIME>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>Acme Retail Buyers</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>-150000.00</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>Sales GST 18%</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>127118.64</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>Output IGST 18%</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>22881.36</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
    </VOUCHER>

    <!-- Voucher 2: Payment -->
    <VOUCHER>
     <DATE>20261112</DATE>
     <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
     <VOUCHERNUMBER>PMT-204</VOUCHERNUMBER>
     <PARTYLEDGERNAME>Global Raw Materials Ltd</PARTYLEDGERNAME>
     <NARRATION>Supplier invoice clearance via NEFT</NARRATION>
     <AMOUNT>85000.00</AMOUNT>
     <ALTERID>10052</ALTERID>
     <MASTERID>5002</MASTERID>
     <ADVCREATEDBY>ranjith</ADVCREATEDBY>
     <ADVCREATEDTIME>11:15 AM</ADVCREATEDTIME>
     <CREATEDUSERNAME>ranjith</CREATEDUSERNAME>
     <CREATEDUSERTIME>11:15 AM</CREATEDUSERTIME>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>Global Raw Materials Ltd</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>-85000.00</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>HDFC Bank Current A/c</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>85000.00</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
    </VOUCHER>

    <!-- Voucher 3: Receipt -->
    <VOUCHER>
     <DATE>20261112</DATE>
     <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
     <VOUCHERNUMBER>RCP-508</VOUCHERNUMBER>
     <PARTYLEDGERNAME>Sunshine Enterprises</PARTYLEDGERNAME>
     <NARRATION>Advance received against PO #442</NARRATION>
     <AMOUNT>42500.00</AMOUNT>
     <ALTERID>10053</ALTERID>
     <MASTERID>5003</MASTERID>
     <ADVCREATEDBY>operator1</ADVCREATEDBY>
     <ADVCREATEDTIME>02:45 PM</ADVCREATEDTIME>
     <CREATEDUSERNAME>operator1</CREATEDUSERNAME>
     <CREATEDUSERTIME>02:45 PM</CREATEDUSERTIME>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>ICICI Bank Current A/c</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>-42500.00</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>Sunshine Enterprises</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>42500.00</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
    </VOUCHER>

    <!-- Voucher 4: Contra -->
    <VOUCHER>
     <DATE>20261112</DATE>
     <VOUCHERTYPENAME>Contra</VOUCHERTYPENAME>
     <VOUCHERNUMBER>CNT-101</VOUCHERNUMBER>
     <PARTYLEDGERNAME>Cash Account</PARTYLEDGERNAME>
     <NARRATION>Cash deposited into HDFC Bank</NARRATION>
     <AMOUNT>15000.00</AMOUNT>
     <ALTERID>10054</ALTERID>
     <MASTERID>5004</MASTERID>
     <ADVCREATEDBY>admin</ADVCREATEDBY>
     <ADVCREATEDTIME>03:10 PM</ADVCREATEDTIME>
     <CREATEDUSERNAME>admin</CREATEDUSERNAME>
     <CREATEDUSERTIME>03:10 PM</CREATEDUSERTIME>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>HDFC Bank Current A/c</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>-15000.00</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>Cash Account</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>15000.00</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
    </VOUCHER>

    <!-- Voucher 5: Journal -->
    <VOUCHER>
     <DATE>20261112</DATE>
     <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
     <VOUCHERNUMBER>JRN-099</VOUCHERNUMBER>
     <PARTYLEDGERNAME>Audit Expense</PARTYLEDGERNAME>
     <NARRATION>Provision for audit fees</NARRATION>
     <AMOUNT>20000.00</AMOUNT>
     <ALTERID>10055</ALTERID>
     <MASTERID>5005</MASTERID>
     <ADVCREATEDBY>auditor</ADVCREATEDBY>
     <ADVCREATEDTIME>04:00 PM</ADVCREATEDTIME>
     <CREATEDUSERNAME>auditor</CREATEDUSERNAME>
     <CREATEDUSERTIME>04:00 PM</CREATEDUSERTIME>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>Audit Expense</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>-20000.00</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>Audit Fees Payable</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>20000.00</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
    </VOUCHER>
   </COLLECTION>
  </DATA>
 </BODY>
</ENVELOPE>`;
}

export function startMockTallyServer(port = PORT, mode: 'native' | 'fallback_xml' | 'mixed' = 'native'): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        // 1. Step 1: Open Companies Collection
        if (body.includes('List of Companies') || body.includes('ADV Company Coll') || body.includes('<TYPE>Company</TYPE>')) {
          const companiesXml = `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
 <HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER>
 <BODY>
  <DATA>
   <COLLECTION>
    ${MOCK_COMPANIES.map((c) => `<COMPANY NAME="${c.replace(/&/g, '&amp;')}"><NAME>${c.replace(/&/g, '&amp;')}</NAME></COMPANY>`).join('\n    ')}
   </COLLECTION>
  </DATA>
 </BODY>
</ENVELOPE>`;
          res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-8' });
          return res.end(companiesXml);
        }

        // Extract requested company and dates
        const compMatch = body.match(/<SVCURRENTCOMPANY>([^<]+)<\/SVCURRENTCOMPANY>/i);
        const rawCompany = compMatch ? compMatch[1].trim() : 'Company';
        const companyName = rawCompany.replace(/&amp;/g, '&');

        const fromMatch = body.match(/<SVFROMDATE[^>]*>([^<]+)<\/SVFROMDATE>/i);
        const toMatch = body.match(/<SVTODATE[^>]*>([^<]+)<\/SVTODATE>/i);
        const vchTypeMatch = body.match(/<VOUCHERTYPENAME[^>]*>([^<]+)<\/VOUCHERTYPENAME>/i);

        const svFromDate = fromMatch ? fromMatch[1].trim() : undefined;
        const svToDate = toMatch ? toMatch[1].trim() : undefined;
        const voucherTypeName = vchTypeMatch ? vchTypeMatch[1].trim() : undefined;

        recordedRequests.push({
          companyName,
          svFromDate,
          svToDate,
          voucherTypeName,
          body,
        });

        // Simulate company failure if configured
        if (mockFailingCompany && companyName.toLowerCase() === mockFailingCompany.toLowerCase()) {
          res.writeHead(500, { 'Content-Type': 'text/xml;charset=utf-8' });
          return res.end('<RESPONSE><STATUS>0</STATUS><LINEERROR>Simulated Company Export Failure</LINEERROR></RESPONSE>');
        }

        // 2. Day Book Vouchers XML collection query (XmlRebuildExporter)
        if (body.includes('DayBookVoucherColl') || body.includes('ADV DayBook Coll') || body.includes('<TYPE>Voucher</TYPE>')) {
          const xml = generateSampleVouchersXml(companyName);
          res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-8' });
          return res.end(xml);
        }

        // 3. Step 2: Native Excel Export request OR Day Book XML report export
        if (body.includes('<ID>Day Book</ID>')) {
          if (mode === 'fallback_xml') {
            // Simulate Tally returning XML or LINEERROR when Excel export fails
            const errXml = `<RESPONSE><STATUS>0</STATUS><LINEERROR>Native Excel export not supported</LINEERROR></RESPONSE>`;
            res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-8' });
            return res.end(errXml);
          }

          if (body.includes('$$SysName:XML')) {
            const xml = generateSampleVouchersXml(companyName);
            res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-8' });
            return res.end(xml);
          }

          // Return real XLSX buffer
          try {
            const excelBuf = await generateSampleExcel(companyName);
            res.writeHead(200, {
              'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'Content-Length': excelBuf.length,
            });
            return res.end(excelBuf);
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            return res.end(err.message);
          }
        }

        // Default ping / fallback response
        const defaultXml = `<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DATA></DATA></BODY></ENVELOPE>`;
        res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-8' });
        res.end(defaultXml);
      });
    });

    server.listen(port, '127.0.0.1', () => {
      console.log(`[MockTallyServer] Listening on http://127.0.0.1:${port}`);
      console.log(`[MockTallyServer] Serving 5 open company tabs: ${MOCK_COMPANIES.join(', ')}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startMockTallyServer(PORT, 'native');
}
