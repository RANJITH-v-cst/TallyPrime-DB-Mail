import { IExporter, ExportOptions, ExporterResult } from './types';
import { TallyClient } from '../client';
export declare class NativeExcelExporter implements IExporter {
    private tallyClient;
    readonly name = "NativeExcelExporter";
    constructor(tallyClient: TallyClient);
    /**
     * Validates if a buffer is a valid Excel / Zip file (magic bytes: "PK" = 0x50, 0x4B)
     */
    static isValidXlsxBuffer(buffer: Buffer): boolean;
    /**
     * Builds Tally XML request for exporting Day Book report
     */
    buildExportXml(options: ExportOptions, exportFormat: string): string;
    exportDayBook(options: ExportOptions): Promise<ExporterResult>;
}
