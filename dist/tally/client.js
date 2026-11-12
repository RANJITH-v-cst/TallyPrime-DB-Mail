"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TallyClient = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
class TallyClient {
    client;
    host;
    port;
    constructor(config) {
        this.host = config.host || '127.0.0.1';
        this.port = config.port || 9000;
        this.client = axios_1.default.create({
            baseURL: `http://${this.host}:${this.port}`,
            timeout: config.timeoutMs || 60000, // 60s per-company timeout
            headers: {
                'Content-Type': 'text/xml;charset=utf-8',
                'Accept': '*/*',
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        });
    }
    /**
     * Checks if TallyPrime is reachable using the standard List of Companies collection.
     */
    async ping() {
        try {
            const pingXml = `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>List of Companies</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
  </DESC>
 </BODY>
</ENVELOPE>`;
            await this.sendXml(pingXml, 5000);
            return true;
        }
        catch (err) {
            logger_1.logger.debug(`Tally ping failed: ${err.message}`);
            return false;
        }
    }
    /**
     * Sends an XML request to Tally and returns string response.
     */
    async sendXml(xmlPayload, customTimeout) {
        try {
            const response = await this.client.post('/', xmlPayload, {
                headers: { 'Content-Type': 'text/xml;charset=utf-8' },
                responseType: 'text',
                timeout: customTimeout || this.client.defaults.timeout,
            });
            return response.data;
        }
        catch (err) {
            this.handleError(err, 'sendXml');
            throw err;
        }
    }
    /**
     * Sends an XML export request and returns response as raw Buffer (for binary Excel exports).
     */
    async exportBinary(xmlPayload, customTimeout) {
        try {
            const response = await this.client.post('/', xmlPayload, {
                headers: { 'Content-Type': 'text/xml;charset=utf-8' },
                responseType: 'arraybuffer',
                timeout: customTimeout || this.client.defaults.timeout,
            });
            return Buffer.from(response.data);
        }
        catch (err) {
            this.handleError(err, 'exportBinary');
            throw err;
        }
    }
    handleError(err, context) {
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
            logger_1.logger.warn(`TallyPrime connection failed at ${this.host}:${this.port} (${err.code}). Ensure TallyPrime is running with ODBC/HTTP enabled.`);
        }
        else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
            logger_1.logger.warn(`TallyPrime request timed out after ${this.client.defaults.timeout}ms during ${context}.`);
        }
        else {
            logger_1.logger.error(`TallyPrime request error during ${context}: ${err.message}`);
        }
    }
}
exports.TallyClient = TallyClient;
//# sourceMappingURL=client.js.map