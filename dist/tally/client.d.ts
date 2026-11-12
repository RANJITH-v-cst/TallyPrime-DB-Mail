import { TallyConfig } from '../config/types';
export declare class TallyClient {
    private client;
    private host;
    private port;
    constructor(config: TallyConfig);
    /**
     * Checks if TallyPrime is reachable using the standard List of Companies collection.
     */
    ping(): Promise<boolean>;
    /**
     * Sends an XML request to Tally and returns string response.
     */
    sendXml(xmlPayload: string, customTimeout?: number): Promise<string>;
    /**
     * Sends an XML export request and returns response as raw Buffer (for binary Excel exports).
     */
    exportBinary(xmlPayload: string, customTimeout?: number): Promise<Buffer>;
    private handleError;
}
