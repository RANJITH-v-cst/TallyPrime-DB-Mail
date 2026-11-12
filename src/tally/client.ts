import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { TallyConfig } from '../config/types';
import { logger } from '../utils/logger';

export class TallyClient {
  private client: AxiosInstance;
  private host: string;
  private port: number;

  constructor(config: TallyConfig) {
    this.host = config.host || '127.0.0.1';
    this.port = config.port || 9000;
    this.client = axios.create({
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
  async ping(): Promise<boolean> {
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
    } catch (err: any) {
      logger.debug(`Tally ping failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Sends an XML request to Tally and returns string response.
   */
  async sendXml(xmlPayload: string, customTimeout?: number): Promise<string> {
    try {
      const response: AxiosResponse<string> = await this.client.post('/', xmlPayload, {
        headers: { 'Content-Type': 'text/xml;charset=utf-8' },
        responseType: 'text',
        timeout: customTimeout || this.client.defaults.timeout,
      });
      return response.data;
    } catch (err: any) {
      this.handleError(err, 'sendXml');
      throw err;
    }
  }

  /**
   * Sends an XML export request and returns response as raw Buffer (for binary Excel exports).
   */
  async exportBinary(xmlPayload: string, customTimeout?: number): Promise<Buffer> {
    try {
      const response: AxiosResponse<ArrayBuffer> = await this.client.post('/', xmlPayload, {
        headers: { 'Content-Type': 'text/xml;charset=utf-8' },
        responseType: 'arraybuffer',
        timeout: customTimeout || this.client.defaults.timeout,
      });
      return Buffer.from(response.data);
    } catch (err: any) {
      this.handleError(err, 'exportBinary');
      throw err;
    }
  }

  private handleError(err: any, context: string): void {
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      logger.warn(`TallyPrime connection failed at ${this.host}:${this.port} (${err.code}). Ensure TallyPrime is running with ODBC/HTTP enabled.`);
    } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
      logger.warn(`TallyPrime request timed out after ${this.client.defaults.timeout}ms during ${context}.`);
    } else {
      logger.error(`TallyPrime request error during ${context}: ${err.message}`);
    }
  }
}
