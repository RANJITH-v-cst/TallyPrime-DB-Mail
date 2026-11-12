"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompanyDiscoveryService = void 0;
const fast_xml_parser_1 = require("fast-xml-parser");
const logger_1 = require("../utils/logger");
class CompanyDiscoveryService {
    tallyClient;
    parser;
    constructor(tallyClient) {
        this.tallyClient = tallyClient;
        this.parser = new fast_xml_parser_1.XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            trimValues: true,
            parseTagValue: true,
        });
    }
    /**
     * Builds Step 1 Tally XML request for open companies collection
     */
    buildDiscoveryXml() {
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
    parseCompanyNames(xmlContent) {
        if (!xmlContent || typeof xmlContent !== 'string') {
            return [];
        }
        try {
            const parsed = this.parser.parse(xmlContent);
            const companies = [];
            // Recursive search for company nodes or names
            const extractNames = (obj) => {
                if (!obj || typeof obj !== 'object')
                    return;
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
        }
        catch (err) {
            logger_1.logger.error(`Failed to parse List of Companies XML: ${err.message}`);
            return [];
        }
    }
    /**
     * Fetches open companies from Tally and compares with configured companies.
     */
    async discoverCompanies(configuredCompanies) {
        const xml = this.buildDiscoveryXml();
        const responseXml = await this.tallyClient.sendXml(xml);
        const openCompanies = this.parseCompanyNames(responseXml);
        logger_1.logger.info(`Discovered ${openCompanies.length} open company tabs in TallyPrime: [${openCompanies.join(', ')}]`);
        let missingCompanies = [];
        if (Array.isArray(configuredCompanies)) {
            missingCompanies = configuredCompanies.filter((cfg) => !openCompanies.some((open) => open.toLowerCase() === cfg.toLowerCase()));
            if (missingCompanies.length > 0) {
                logger_1.logger.warn(`WARNING: The following ${missingCompanies.length} configured companies are NOT open in TallyPrime: [${missingCompanies.join(', ')}]`);
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
exports.CompanyDiscoveryService = CompanyDiscoveryService;
//# sourceMappingURL=companyDiscovery.js.map