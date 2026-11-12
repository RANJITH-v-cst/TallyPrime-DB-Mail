"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOCK_COMPANIES = void 0;
exports.startMockTallyServer = startMockTallyServer;
const http_1 = __importDefault(require("http"));
const exceljs_1 = __importDefault(require("exceljs"));
const PORT = 9000;
exports.MOCK_COMPANIES = [
    'Acme Corp Ltd',
    'Starlight Industries Pvt Ltd',
    'Apex Logistics',
    'Nova Global Trading',
    'Zenith Enterprises',
];
/**
 * Creates a sample XLSX buffer with PK magic header
 */
async function generateSampleExcel(companyName) {
    const wb = new exceljs_1.default.Workbook();
    const ws = wb.addWorksheet('Day Book');
    ws.mergeCells('A1:F1');
    ws.getCell('A1').value = companyName;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.mergeCells('A2:F2');
    ws.getCell('A2').value = 'Day Book - TallyPrime Native Export Simulation';
    ws.getRow(4).values = ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit Amount', 'Credit Amount'];
    ws.getRow(4).font = { bold: true };
    ws.addRow(['12-Nov-26', 'Customer Alpha', 'Sales', 'INV-001', 54200.00, '']);
    ws.addRow(['12-Nov-26', 'Vendor Beta', 'Payment', 'PV-042', '', 18500.00]);
    ws.addRow(['12-Nov-26', 'Cash Account', 'Receipt', 'RV-108', 25000.00, '']);
    const totalRow = ws.addRow(['', 'Total', '', '', 79200.00, 18500.00]);
    totalRow.font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
}
/**
 * Generates sample Tally XML response for Day Book vouchers
 */
function generateSampleVouchersXml(companyName) {
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
   </COLLECTION>
  </DATA>
 </BODY>
</ENVELOPE>`;
}
function startMockTallyServer(port = PORT, mode = 'native') {
    return new Promise((resolve) => {
        const server = http_1.default.createServer(async (req, res) => {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk.toString();
            });
            req.on('end', async () => {
                // 1. Step 1: List of Companies Collection
                if (body.includes('List of Companies')) {
                    const companiesXml = `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
 <HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER>
 <BODY>
  <DATA>
   <COLLECTION>
    ${exports.MOCK_COMPANIES.map((c) => `<COMPANY NAME="${c}"><NAME>${c}</NAME></COMPANY>`).join('\n    ')}
   </COLLECTION>
  </DATA>
 </BODY>
</ENVELOPE>`;
                    res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-8' });
                    return res.end(companiesXml);
                }
                // Extract requested company
                const compMatch = body.match(/<SVCURRENTCOMPANY>([^<]+)<\/SVCURRENTCOMPANY>/i);
                const companyName = compMatch ? compMatch[1].trim() : 'Company';
                // 2. Day Book Vouchers XML collection query (XmlRebuildExporter)
                if (body.includes('DayBookVoucherColl') || body.includes('<TYPE>Voucher</TYPE>')) {
                    const xml = generateSampleVouchersXml(companyName);
                    res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-8' });
                    return res.end(xml);
                }
                // 3. Step 2: Native Excel Export request
                if (body.includes('<ID>Day Book</ID>')) {
                    if (mode === 'fallback_xml') {
                        // Simulate Tally returning XML or LINEERROR when Excel export fails
                        const errXml = `<RESPONSE><STATUS>0</STATUS><LINEERROR>Native Excel export not supported</LINEERROR></RESPONSE>`;
                        res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-8' });
                        return res.end(errXml);
                    }
                    // Return real XLSX buffer
                    try {
                        const excelBuf = await generateSampleExcel(companyName);
                        res.writeHead(200, {
                            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                            'Content-Length': excelBuf.length,
                        });
                        return res.end(excelBuf);
                    }
                    catch (err) {
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
            console.log(`[MockTallyServer] Serving 5 open company tabs: ${exports.MOCK_COMPANIES.join(', ')}`);
            resolve(server);
        });
    });
}
if (require.main === module) {
    startMockTallyServer(PORT, 'native');
}
//# sourceMappingURL=mockTallyServer.js.map