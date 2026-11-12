import { ExportOptions, ExporterResult } from './exporters/types';
import { NativeExcelExporter } from './exporters/nativeExporter';
import { XmlRebuildExporter } from './exporters/xmlRebuildExporter';
import { TallyClient } from './client';
export declare class ExporterFactory {
    private tallyClient;
    private nativeExporter;
    private xmlRebuildExporter;
    constructor(tallyClient: TallyClient);
    /**
     * Executes the export based on configured preference ('auto' | 'native' | 'xmlRebuild')
     * with seamless automatic fallback.
     */
    export(options: ExportOptions): Promise<ExporterResult & {
        methodUsed: 'native' | 'xmlRebuild';
    }>;
    getNativeExporter(): NativeExcelExporter;
    getXmlRebuildExporter(): XmlRebuildExporter;
}
