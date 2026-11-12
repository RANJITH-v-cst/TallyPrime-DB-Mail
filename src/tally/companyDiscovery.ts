import { XMLParser } from 'fast-xml-parser';
import { TallyClient } from './client';
import { logger } from '../utils/logger';

export interface CompanyDiscoveryResult {
  openCompanies: string[];
  configuredCompanies: string[] | 'auto';
  missingCompanies: string[];
  isMatch: boolean;
}

export class CompanyDiscoveryService {
  private parser: XMLParser;

  constructor(private tallyClient: TallyClient) {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      trimValues: true,
      parseTagValue: true,
    });
  }

  /**
   * Builds Step 1 Tally XML request for open companies collection
   */
  public buildDiscoveryXml(): string {
    return `<ENVELOPE>
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
  }

  /**
   * Parses company names from Tally's XML response.
   */
  public parseCompanyNames(xmlContent: string): string[] {
    if (!xmlContent || typeof xmlContent !== 'string') {
      return [];
    }

    try {
      const parsed = this.parser.parse(xmlContent);
      const companies: string[] = [];

      // Recursive search for company nodes or names
      const extractNames = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;

        // Check if current node represents a Company object
        if (obj.COMPANY) {
          const list = Array.isArray(obj.COMPANY) ? obj.COMPANY : [obj.COMPANY];
          for (const item of list) {
            const name = item.NAME || item['@_NAME'] || item['$Name'] || (typeof item === 'string' ? item : null);
            if (name && typeof name === 'string' && !companies.includes(name.trim())) {
              companies.push(name.trim());
            }
          }
        }

        // Check if current node is a company item directly
        if (obj.NAME && typeof obj.NAME === 'string' && !companies.includes(obj.NAME.trim())) {
          // If this parent object looks like a company entry
          companies.push(obj.NAME.trim());
        }

        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === 'object') {
            extractNames(obj[key]);
          }
        }
      };

      extractNames(parsed);

      // If XML is flat or regex-friendly, also fallback to regex in case of non-standard schema
      if (companies.length === 0) {
        const regex = /<NAME(?: [^>]*)?>([^<]+)<\/NAME>/gi;
        let match;
        while ((match = regex.exec(xmlContent)) !== null) {
          const val = match[1].trim();
          if (val && !companies.includes(val) && !val.includes('$$SysName')) {
            companies.push(val);
          }
        }
      }

      return companies;
    } catch (err: any) {
      logger.error(`Failed to parse List of Companies XML: ${err.message}`);
      return [];
    }
  }

  /**
   * Fetches open companies from Tally and compares with configured companies.
   */
  public async discoverCompanies(configuredCompanies: string[] | 'auto'): Promise<CompanyDiscoveryResult> {
    const xml = this.buildDiscoveryXml();
    const responseXml = await this.tallyClient.sendXml(xml);
    const openCompanies = this.parseCompanyNames(responseXml);

    logger.info(`Discovered ${openCompanies.length} open company tabs in TallyPrime: [${openCompanies.join(', ')}]`);

    let missingCompanies: string[] = [];
    if (Array.isArray(configuredCompanies)) {
      missingCompanies = configuredCompanies.filter(
        (cfg) => !openCompanies.some((open) => open.toLowerCase() === cfg.toLowerCase())
      );

      if (missingCompanies.length > 0) {
        logger.warn(
          `WARNING: The following ${missingCompanies.length} configured companies are NOT open in TallyPrime: [${missingCompanies.join(', ')}]`
        );
      }
    }

    return {
      openCompanies,
      configuredCompanies,
      missingCompanies,
      isMatch: missingCompanies.length === 0,
    };
  }
}

