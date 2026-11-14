import ExcelJS from 'exceljs';
import { TallyClient } from '../src/tally/client';
import { XmlRebuildExporter } from '../src/tally/exporters/xmlRebuildExporter';
import { ExporterFactory } from '../src/tally/exporterFactory';
import { NativeExcelExporter } from '../src/tally/exporters/nativeExporter';
import { VoucherEntry } from '../src/config/types';

describe('Task 5: Created By / Created Time Comprehensive Tests', () => {
  const dummyClient = new TallyClient({ host: '127.0.0.1', port: 9000 });
  const xmlExporter = new XmlRebuildExporter(dummyClient);

  // 1. The collection request contains the FETCH and COMPUTE lines
  test('1. Collection request XML contains the FETCH and COMPUTE lines for createdusername and createdusertime', () => {
    const xml = xmlExporter.buildVoucherFetchXml({
      companyName: 'Test Enterprises',
      fromDate: '20260401',
      toDate: '20260401',
      config: {
        periodMode: 'today',
        detailed: true,
        voucherTypes: [],
        skipIfNoEntries: false,
        exporter: 'xmlRebuild',
      },
    });

    expect(xml).toContain('createdusername, createdusertime');
    expect(xml).toContain('<COMPUTE>ADVCreatedBy : $createdusername</COMPUTE>');
    expect(xml).toContain('<COMPUTE>ADVCreatedTime : $createdusertime</COMPUTE>');
  });

  // 2. parseVouchers reads both ADVCREATEDBY and UDF:CREATEDUSERNAME.LIST and gives undefined when absent
  test('2. parseVouchers reads ADVCREATEDBY and UDF:CREATEDUSERNAME.LIST, and gives undefined when absent', () => {
    // Form A: ADVCREATEDBY / ADVCREATEDTIME (from collection compute)
    const xmlFormA = `
      <ENVELOPE>
        <BODY>
          <DATA>
            <TALLYMESSAGE>
              <VOUCHER>
                <DATE>20260401</DATE>
                <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
                <VOUCHERNUMBER>101</VOUCHERNUMBER>
                <PARTYLEDGERNAME>Vendor A</PARTYLEDGERNAME>
                <AMOUNT>-5000</AMOUNT>
                <ADVCREATEDBY>admin</ADVCREATEDBY>
                <ADVCREATEDTIME>10:05 AM</ADVCREATEDTIME>
                <ALLLEDGERENTRIES.LIST>
                  <LEDGERNAME>Vendor A</LEDGERNAME>
                  <AMOUNT>-5000</AMOUNT>
                  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                </ALLLEDGERENTRIES.LIST>
              </VOUCHER>
            </TALLYMESSAGE>
          </DATA>
        </BODY>
      </ENVELOPE>
    `;

    const parsedA = xmlExporter.parseVouchers(xmlFormA);
    expect(parsedA).toHaveLength(1);
    expect(parsedA[0].createdBy).toBe('admin');
    expect(parsedA[0].createdTime).toBe('10:05 AM');

    // Form B: UDF:CREATEDUSERNAME.LIST native Tally XML form
    const xmlFormB = `
      <ENVELOPE>
        <BODY>
          <DATA>
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
              <VOUCHER>
                <DATE>20260401</DATE>
                <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
                <VOUCHERNUMBER>202</VOUCHERNUMBER>
                <PARTYLEDGERNAME>Customer B</PARTYLEDGERNAME>
                <AMOUNT>15000</AMOUNT>
                <UDF:CREATEDUSERNAME.LIST DESC="\`createdusername\`">
                  <UDF:CREATEDUSERNAME>ranjith</UDF:CREATEDUSERNAME>
                </UDF:CREATEDUSERNAME.LIST>
                <UDF:CREATEDUSERTIME.LIST DESC="\`createdusertime\`">
                  <UDF:CREATEDUSERTIME>03:45 PM</UDF:CREATEDUSERTIME>
                </UDF:CREATEDUSERTIME.LIST>
                <ALLLEDGERENTRIES.LIST>
                  <LEDGERNAME>Customer B</LEDGERNAME>
                  <AMOUNT>-15000</AMOUNT>
                  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                </ALLLEDGERENTRIES.LIST>
              </VOUCHER>
            </TALLYMESSAGE>
          </DATA>
        </BODY>
      </ENVELOPE>
    `;

    const parsedB = xmlExporter.parseVouchers(xmlFormB);
    expect(parsedB).toHaveLength(1);
    expect(parsedB[0].createdBy).toBe('ranjith');
    expect(parsedB[0].createdTime).toBe('03:45 PM');

    // Form C: Absent created by / time -> returns undefined
    const xmlFormC = `
      <ENVELOPE>
        <BODY>
          <DATA>
            <TALLYMESSAGE>
              <VOUCHER>
                <DATE>20260401</DATE>
                <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
                <VOUCHERNUMBER>303</VOUCHERNUMBER>
                <PARTYLEDGERNAME>Customer C</PARTYLEDGERNAME>
                <AMOUNT>2000</AMOUNT>
                <ALLLEDGERENTRIES.LIST>
                  <LEDGERNAME>Customer C</LEDGERNAME>
                  <AMOUNT>2000</AMOUNT>
                  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                </ALLLEDGERENTRIES.LIST>
              </VOUCHER>
            </TALLYMESSAGE>
          </DATA>
        </BODY>
      </ENVELOPE>
    `;

    const parsedC = xmlExporter.parseVouchers(xmlFormC);
    expect(parsedC).toHaveLength(1);
    expect(parsedC[0].createdBy).toBeUndefined();
    expect(parsedC[0].createdTime).toBeUndefined();
  });

  // 3. The workbook has "Created By"/"Created Time" in G5/H5, values in G6/H6, and Total row debit in column E with G/H empty
  test('3. The workbook has Created By / Created Time in G5/H5, values in G6/H6, and Total row debit in col E with G/H empty', async () => {
    const vouchers: VoucherEntry[] = [
      {
        date: '20260401',
        voucherType: 'Payment',
        voucherNumber: 'PAY-1',
        partyLedgerName: 'Alpha Supplies',
        amount: 10000,
        createdBy: 'admin',
        createdTime: '10:05 AM',
        ledgerEntries: [
          { ledgerName: 'Alpha Supplies', amount: 10000, isDeemedPositive: true },
          { ledgerName: 'Bank', amount: 10000, isDeemedPositive: false },
        ],
      },
    ];

    const buffer = await xmlExporter.buildExcelWorkbook(
      {
        companyName: 'Test Corp',
        fromDate: '20260401',
        toDate: '20260401',
        config: {
          periodMode: 'today',
          detailed: false,
          voucherTypes: [],
          skipIfNoEntries: false,
          exporter: 'xmlRebuild',
        },
      },
      vouchers
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];

    // Row 5: Column Headers
    const row5 = sheet.getRow(5);
    expect(row5.getCell(1).value).toBe('Date');
    expect(row5.getCell(2).value).toBe('Particulars');
    expect(row5.getCell(3).value).toBe('Vch Type');
    expect(row5.getCell(4).value).toBe('Vch No.');
    expect(row5.getCell(5).value).toBe('Debit Amount');
    expect(row5.getCell(6).value).toBe('Credit Amount');
    expect(row5.getCell(7).value).toBe('Created By');
    expect(row5.getCell(8).value).toBe('Created Time');

    // Row 6: First voucher
    const row6 = sheet.getRow(6);
    expect(row6.getCell(2).value).toBe('Alpha Supplies');
    expect(row6.getCell(3).value).toBe('Payment');
    expect(row6.getCell(4).value).toBe('PAY-1');
    expect(row6.getCell(5).value).toBe(10000); // Debit in column E
    expect(row6.getCell(7).value).toBe('admin'); // Created By in column G
    expect(row6.getCell(8).value).toBe('10:05 AM'); // Created Time in column H

    // Row 7: Grand Total Row
    const row7 = sheet.getRow(7);
    expect(row7.getCell(2).value).toBe('Total');
    expect(row7.getCell(5).value).toBe(10000); // Grand total debit stays in column E
    expect(row7.getCell(7).value).toBeFalsy(); // Column G empty
    expect(row7.getCell(8).value).toBeFalsy(); // Column H empty
  });

  // 4. The native-export-missing-columns case falls back to the rebuild
  test('4. Native export without Created By / Created Time columns falls back to XmlRebuildExporter', async () => {
    // Create a mock workbook missing Created By / Created Time (traditional 6 columns)
    const mockWb = new ExcelJS.Workbook();
    const ws = mockWb.addWorksheet('Day Book');
    ws.addRow(['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit Amount', 'Credit Amount']);
    ws.addRow(['01-Apr-2026', 'Vendor X', 'Payment', '1', 5000, null]);
    const mockNativeBuffer = Buffer.from(await mockWb.xlsx.writeBuffer());

    const factory = new ExporterFactory(dummyClient);

    // Mock native exporter to return the workbook missing the columns
    jest.spyOn(factory.getNativeExporter(), 'exportDayBook').mockResolvedValue({
      success: true,
      voucherCount: 1,
      fileBuffer: mockNativeBuffer,
      fileName: 'Test_DayBook.xlsx',
      filePath: './exports/Test_DayBook.xlsx',
    });

    // Mock rebuild exporter to return a rebuilt workbook
    const rebuildSpy = jest.spyOn(factory.getXmlRebuildExporter(), 'exportDayBook').mockResolvedValue({
      success: true,
      voucherCount: 1,
      fileBuffer: Buffer.from('mock-rebuilt-buffer'),
      fileName: 'Test_DayBook_rebuilt.xlsx',
      filePath: './exports/Test_DayBook_rebuilt.xlsx',
    });

    const result = await factory.export({
      companyName: 'Acme Corp',
      fromDate: '20260401',
      toDate: '20260401',
      config: {
        periodMode: 'today',
        detailed: true,
        voucherTypes: [],
        skipIfNoEntries: false,
        exporter: 'auto',
      },
    });

    // Should have detected missing columns and fallen back to xmlRebuild
    expect(rebuildSpy).toHaveBeenCalledTimes(1);
    expect(result.methodUsed).toBe('xmlRebuild');
    expect(result.isFallback).toBe(true);
  });
});
