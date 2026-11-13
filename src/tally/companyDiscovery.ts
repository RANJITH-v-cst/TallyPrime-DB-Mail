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
   * Builds Step 1 Tally XML request for open companies collection.
   * Uses uniquely prefixed collection name "ADV Company Coll" with FETCH Name
   * to guarantee no collision with Form:Company or default Tally UI reports.
   */
  public buildDiscoveryXml(): string {
    return `<ENVELOPE>
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
  }

  /**
   * Parses company names from Tally's XML response.
   * Only reads COMPANY nodes (by tag or attribute) returned from "ADV Company Coll" (Type: Company).
   * De-duplicates case-insensitively so "Acme" and "acme" count once.
   */
  public parseCompanyNames(xmlContent: string): string[] {
    if (!xmlContent || typeof xmlContent !== 'string') {
      return [];
    }

    try {
      const parsed = this.parser.parse(xmlContent);
      const companies: string[] = [];
      const seenLower = new Set<string>();

      const addName = (name: string) => {
        if (!name || typeof name !== 'string') return;
        const trimmed = name.trim();
        if (!trimmed) return;
        const lower = trimmed.toLowerCase();
        if (!seenLower.has(lower)) {
          seenLower.add(lower);
          companies.push(trimmed);
        }
      };

      // The ADV Company Coll response contains COMPANY elements under COLLECTION/TALLYMESSAGE.
      // Walk only COMPANY nodes; do NOT pick up every NAME in the tree.
      const extractCompanyNodes = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;

        if (obj.COMPANY) {
          const list = Array.isArray(obj.COMPANY) ? obj.COMPANY : [obj.COMPANY];
          for (const item of list) {
            if (typeof item === 'string') {
              addName(item);
            } else if (item && typeof item === 'object') {
              // Priority: attribute NAME, then child NAME element, then $Name
              const name =
                item['@_NAME'] ||
                (typeof item.NAME === 'string' ? item.NAME : null) ||
                item['$Name'] ||
                null;
              addName(name);
            }
          }
          return; // Don't descend into COMPANY children
        }

        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === 'object') {
            extractCompanyNodes(obj[key]);
          }
        }
      };

      extractCompanyNodes(parsed);

      // Regex fallback: if XML parser returned nothing, extract from <COMPANY NAME="..."> attributes
      if (companies.length === 0) {
        const attrRegex = /<COMPANY[^>]+NAME="([^"]+)"/gi;
        let m;
        while ((m = attrRegex.exec(xmlContent)) !== null) {
          addName(m[1]);
        }
      }

      // Second fallback: <NAME> inside a <COMPANY> block (not everywhere in the doc)
      if (companies.length === 0) {
        const companyBlockRegex = /<COMPANY[^>]*>([\s\S]*?)<\/COMPANY>/gi;
        let cb;
        while ((cb = companyBlockRegex.exec(xmlContent)) !== null) {
          const nameMatch = /<NAME[^>]*>([^<]+)<\/NAME>/i.exec(cb[1]);
          if (nameMatch) addName(nameMatch[1]);
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

