import { IExporter, ExportOptions, ExporterResult } from './types';
import { TallyClient } from '../client';
import { VoucherEntry } from '../../config/types';
export declare class XmlRebuildExporter implements IExporter {
    private tallyClient;
    readonly name = "XmlRebuildExporter";
    private parser;
    constructor(tallyClient: TallyClient);
    /**
     * Builds Tally Collection XML to fetch Vouchers with all required fields
     */
    buildVoucherFetchXml(options: ExportOptions): string;
    /**
     * Parses XML response from Tally into structured VoucherEntry objects
     */
    parseVouchers(xmlContent: string): VoucherEntry[];
    private extractVoucherNodes;
    /**
     * Formats raw Tally date (e.g. YYYYMMDD or YYYY-MM-DD) into standard dd-MMM-yy
     */
    formatDate(rawDate: string): string;
    /**
     * Generates formatted Excel workbook mimicking Tally's Day Book export
     */
    buildExcelWorkbook(options: ExportOptions, vouchers: VoucherEntry[]): Promise<Buffer>;
    exportDayBook(options: ExportOptions): Promise<ExporterResult>;
}
