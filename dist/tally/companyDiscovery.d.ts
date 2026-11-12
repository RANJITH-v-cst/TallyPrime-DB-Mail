import { TallyClient } from './client';
export interface CompanyDiscoveryResult {
    openCompanies: string[];
    configuredCompanies: string[] | 'auto';
    missingCompanies: string[];
    isMatch: boolean;
}
export declare class CompanyDiscoveryService {
    private tallyClient;
    private parser;
    constructor(tallyClient: TallyClient);
    /**
     * Builds Step 1 Tally XML request for open companies collection
     */
    buildDiscoveryXml(): string;
    /**
     * Parses company names from Tally's XML response.
     */
    parseCompanyNames(xmlContent: string): string[];
    /**
     * Fetches open companies from Tally and compares with configured companies.
     */
    discoverCompanies(configuredCompanies: string[] | 'auto'): Promise<CompanyDiscoveryResult>;
}
