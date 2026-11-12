"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExporterFactory = void 0;
const nativeExporter_1 = require("./exporters/nativeExporter");
const xmlRebuildExporter_1 = require("./exporters/xmlRebuildExporter");
const logger_1 = require("../utils/logger");
class ExporterFactory {
    tallyClient;
    nativeExporter;
    xmlRebuildExporter;
    constructor(tallyClient) {
        this.tallyClient = tallyClient;
        this.nativeExporter = new nativeExporter_1.NativeExcelExporter(tallyClient);
        this.xmlRebuildExporter = new xmlRebuildExporter_1.XmlRebuildExporter(tallyClient);
    }
    /**
     * Executes the export based on configured preference ('auto' | 'native' | 'xmlRebuild')
     * with seamless automatic fallback.
     */
    async export(options) {
        const preference = options.config.exporter || 'auto';
        if (preference === 'native') {
            const res = await this.nativeExporter.exportDayBook(options);
            return { ...res, methodUsed: 'native' };
        }
        if (preference === 'xmlRebuild') {
            const res = await this.xmlRebuildExporter.exportDayBook(options);
            return { ...res, methodUsed: 'xmlRebuild' };
        }
        // Default: 'auto' (Try Native first, fallback to XmlRebuild)
        logger_1.logger.info(`[Auto-Mode] Trying NativeExcelExporter for "${options.companyName}"...`);
        const nativeRes = await this.nativeExporter.exportDayBook(options);
        if (nativeRes.success && nativeRes.fileBuffer) {
            return { ...nativeRes, methodUsed: 'native' };
        }
        logger_1.logger.warn(`Native export did not return valid Excel for "${options.companyName}". Activating fallback XmlRebuildExporter...`);
        const rebuildRes = await this.xmlRebuildExporter.exportDayBook(options);
        return { ...rebuildRes, methodUsed: 'xmlRebuild' };
    }
    getNativeExporter() {
        return this.nativeExporter;
    }
    getXmlRebuildExporter() {
        return this.xmlRebuildExporter;
    }
}
exports.ExporterFactory = ExporterFactory;
//# sourceMappingURL=exporterFactory.js.map