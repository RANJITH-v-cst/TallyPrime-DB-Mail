import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { TallyConfig } from '../config/types';
import { logger } from '../utils/logger';

export class TallyTimeoutError extends Error {
  public readonly isTimeout = true;
  public readonly code = 'ETIMEDOUT';
  constructor(message: string = 'TallyPrime request timed out') {
    super(message);
    this.name = 'TallyTimeoutError';
    Object.setPrototypeOf(this, TallyTimeoutError.prototype);
  }
}

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

  public getHost(): string {
    return this.host;
  }

  public getPort(): number {
    return this.port;
  }

  /**
   * Checks if TallyPrime is reachable using an isolated Company collection with FETCH.
   * Completely avoids Form:Company "No PARTS" UI errors.
   */
  async ping(signal?: AbortSignal): Promise<boolean> {
    try {
      const pingXml = `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>ADV Company Coll</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="ADV Company Coll" ISMODIFY="No" ISFIXED="No">
      <TYPE>Company</TYPE>
      <FETCH>Name</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
      await this.sendXml(pingXml, 5000, signal);
      return true;
    } catch (err: any) {
      logger.debug(`Tally ping failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Sends an XML request to Tally and returns string response.
   */
  async sendXml(xmlPayload: string, customTimeout?: number, signal?: AbortSignal): Promise<string> {
    try {
      const response: AxiosResponse<string> = await this.client.post('/', xmlPayload, {
        headers: { 'Content-Type': 'text/xml;charset=utf-8' },
        responseType: 'text',
        timeout: customTimeout || this.client.defaults.timeout,
        signal,
      });
      return response.data;
    } catch (err: any) {
      this.handleError(err, 'sendXml');
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || /timeout/i.test(err.message || '')) {
        throw new TallyTimeoutError(err.message || `TallyPrime request timed out after ${this.client.defaults.timeout}ms`);
      }
      throw err;
    }
  }

  /**
   * Sends an XML export request and returns response as raw Buffer (for binary Excel exports).
   */
  async exportBinary(xmlPayload: string, customTimeout?: number, signal?: AbortSignal): Promise<Buffer> {
    try {
      const response: AxiosResponse<ArrayBuffer> = await this.client.post('/', xmlPayload, {
        headers: { 'Content-Type': 'text/xml;charset=utf-8' },
        responseType: 'arraybuffer',
        timeout: customTimeout || this.client.defaults.timeout,
        signal,
      });
      return Buffer.from(response.data);
    } catch (err: any) {
      this.handleError(err, 'exportBinary');
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || /timeout/i.test(err.message || '')) {
        throw new TallyTimeoutError(err.message || `TallyPrime request timed out after ${this.client.defaults.timeout}ms`);
      }
      throw err;
    }
  }

  private handleError(err: any, context: string): void {
    if (axios.isCancel(err) || err.code === 'ERR_CANCELED' || err.name === 'CanceledError') {
      logger.warn(`TallyPrime request was canceled / aborted during ${context}.`);
      return;
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      logger.warn(`TallyPrime connection failed at ${this.host}:${this.port} (${err.code}). Ensure TallyPrime is running with ODBC/HTTP enabled.`);
    } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
      logger.warn(`TallyPrime request timed out after ${this.client.defaults.timeout}ms during ${context}.`);
    } else {
      logger.error(`TallyPrime request error during ${context}: ${err.message}`);
    }
  }
}
