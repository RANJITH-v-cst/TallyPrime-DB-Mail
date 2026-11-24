import { TallyClient } from '../tally/client';
import { logger } from '../utils/logger';

/**
 * TallyPrime serial numbers this build is allowed to run against.
 * Per-customer: edit this list (and rebuild) to add or remove a Tally serial number.
 * (TallyPrime > F1 Help > Licence Information > "Serial Number")
 */
export const LICENSED_TALLY_SERIALS: string[] = ['741042099', '765248040'];

/** First licensed serial (used by the mock Tally server and tests). */
export const LICENSED_TALLY_SERIAL = LICENSED_TALLY_SERIALS[0];

/**
 * pending     - not checked yet
 * valid       - serial matches a licensed serial (cached for the life of the app)
 * invalid     - TallyPrime reported a different serial (cached; restart the app after opening the right Tally)
 * unreadable  - TallyPrime answered but no serial could be read (blocked, re-tried on the next cycle)
 * unreachable - TallyPrime could not be contacted (re-tried on the next cycle)
 */
export type LicenseStatus = 'pending' | 'valid' | 'invalid' | 'unreadable' | 'unreachable';

export interface LicenseState {
  status: LicenseStatus;
  /** Serial number read from the running TallyPrime (if it could be read). */
  detectedSerial?: string;
  message: string;
  checkedAt?: string;
}

const LICENSE_TAG = 'ADVLICSERIAL';

/** TDL expressions that return the licence serial number, tried in order. */
const SERIAL_EXPRESSIONS = ['$$LicenseInfo:SerialNumber', '$$SysInfo:SerialNumber'];

/** Variant 1: computed value on the Company collection (same style as the working connection test). */
export function buildCollectionRequest(expression: string): string {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>ADV License Coll</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="ADV License Coll" ISMODIFY="No" ISFIXED="No">
      <TYPE>Company</TYPE>
      <FETCH>Name</FETCH>
      <COMPUTE>${LICENSE_TAG} : ${expression}</COMPUTE>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

/** Variant 2: tiny inline TDL report with one field. */
export function buildReportRequest(expression: string): string {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>ADV License Report</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <REPORT NAME="ADV License Report" ISMODIFY="No">
      <FORM>ADV License Form</FORM>
     </REPORT>
     <FORM NAME="ADV License Form" ISMODIFY="No">
      <PARTS>ADV License Part</PARTS>
     </FORM>
     <PART NAME="ADV License Part" ISMODIFY="No">
      <LINES>ADV License Line</LINES>
     </PART>
     <LINE NAME="ADV License Line" ISMODIFY="No">
      <FIELDS>ADV License Fld</FIELDS>
     </LINE>
     <FIELD NAME="ADV License Fld" ISMODIFY="No">
      <SET>${expression}</SET>
      <XMLTAG>${LICENSE_TAG}</XMLTAG>
     </FIELD>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

/** Finds the first non-empty serial tag in a Tally response (tag may carry attributes, e.g. TYPE="String"). */
export function parseSerialFromResponse(xml: string): string | null {
  const re = new RegExp(`<${LICENSE_TAG}(?:\\s[^>]*)?>\\s*([^<]*?)\\s*</${LICENSE_TAG}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml || '')) !== null) {
    const value = m[1].replace(/&#?\w+;/g, '').replace(/\s+/g, '');
    if (value) return value;
  }
  return null;
}

/**
 * One-time licence gate. The serial number is read from TallyPrime and compared to the licensed
 * serial numbers. A match (or a mismatch) is remembered for the life of the process, so Tally is
 * asked only once - when the application is opened. If Tally cannot be reached yet, or answers
 * without a serial number, the check is simply retried the next time it is needed.
 */
export class TallyLicenseGuard {
  private state: LicenseState = { status: 'pending', message: 'Licence not verified yet.' };
  private inFlight: Promise<LicenseState> | null = null;

  constructor(
    private getClient: () => TallyClient,
    private allowedSerials: string[] = LICENSED_TALLY_SERIALS
  ) {}

  public getState(): LicenseState {
    return { ...this.state };
  }

  /** Forgets the cached result so the next verify() asks TallyPrime again (used by the Test Tally button). */
  public reset(): void {
    this.state = { status: 'pending', message: 'Licence not verified yet.' };
  }

  public isLicensed(): boolean {
    return this.state.status === 'valid';
  }

  /** Verifies once; a definitive result (valid / invalid) is cached and never re-checked. */
  public async verify(signal?: AbortSignal): Promise<LicenseState> {
    if (this.state.status === 'valid' || this.state.status === 'invalid') {
      return this.getState();
    }
    if (!this.inFlight) {
      this.inFlight = this.check(signal).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async readSerial(signal?: AbortSignal): Promise<string | null> {
    const attempts: { label: string; xml: string }[] = [];
    for (const expr of SERIAL_EXPRESSIONS) {
      attempts.push({ label: `collection ${expr}`, xml: buildCollectionRequest(expr) });
      attempts.push({ label: `report ${expr}`, xml: buildReportRequest(expr) });
    }

    for (const attempt of attempts) {
      const xml = await this.getClient().sendXml(attempt.xml, 10000, signal);
      const serial = parseSerialFromResponse(xml);
      if (serial) {
        logger.info(`[License] Serial number read from TallyPrime (${attempt.label}).`);
        return serial;
      }
      const snippet = (xml || '').replace(/\s+/g, ' ').slice(0, 400);
      logger.warn(`[License] No serial in TallyPrime response to "${attempt.label}". Response: ${snippet}`);
    }
    return null;
  }

  private async check(signal?: AbortSignal): Promise<LicenseState> {
    const checkedAt = new Date().toISOString();
    let serial: string | null;
    try {
      serial = await this.readSerial(signal);
    } catch (err: any) {
      this.state = {
        status: 'unreachable',
        message: `Could not read the TallyPrime licence serial number: ${err.message}`,
        checkedAt,
      };
      logger.warn(`[License] ${this.state.message}`);
      return this.getState();
    }

    if (!serial) {
      this.state = {
        status: 'unreadable',
        message:
          'Could not read the serial number from TallyPrime. Make sure TallyPrime is open and its HTTP port is enabled, then try Send Now again (see Live Logs for details).',
        checkedAt,
      };
      logger.error(`[License] ${this.state.message}`);
      return this.getState();
    }

    if (this.allowedSerials.map((x) => x.replace(/\s+/g, '')).includes(serial)) {
      this.state = { status: 'valid', detectedSerial: serial, message: 'Licensed TallyPrime serial number verified.', checkedAt };
      logger.info(`[License] TallyPrime serial number ${serial} verified.`);
    } else {
      this.state = {
        status: 'invalid',
        detectedSerial: serial,
        message: `This application is not licensed for TallyPrime serial number ${serial}. Mail dispatch is disabled.`,
        checkedAt,
      };
      logger.error(`[License] ${this.state.message}`);
    }
    return this.getState();
  }
}
