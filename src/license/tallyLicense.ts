import { TallyClient } from '../tally/client';
import { logger } from '../utils/logger';

/**
 * The only TallyPrime licence this build is allowed to run against.
 * Per-customer: change this value (and rebuild) for each customer's Tally serial number.
 * (TallyPrime > F1 Help > Licence Information > "Serial Number")
 */
export const LICENSED_TALLY_SERIAL = '741042099';

export type LicenseStatus = 'pending' | 'valid' | 'invalid' | 'unreachable';

export interface LicenseState {
  status: LicenseStatus;
  /** Serial number read from the running TallyPrime (if it could be read). */
  detectedSerial?: string;
  message: string;
  checkedAt?: string;
}

const LICENSE_TAG = 'ADVLICSERIAL';

/**
 * Asks the running TallyPrime for its licence serial number using a tiny inline TDL report.
 * Does not need any company to be open.
 */
export const TALLY_LICENSE_REQUEST_XML = `<ENVELOPE>
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
      <SET>$$LicenseInfo:SerialNumber</SET>
      <XMLTAG>${LICENSE_TAG}</XMLTAG>
     </FIELD>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;

export function parseSerialFromResponse(xml: string): string | null {
  const m = new RegExp(`<${LICENSE_TAG}>\\s*([^<]*?)\\s*</${LICENSE_TAG}>`, 'i').exec(xml || '');
  const value = m ? m[1].replace(/\s+/g, '') : '';
  return value || null;
}

/**
 * One-time licence gate. The serial number is read from TallyPrime and compared to the hard-coded
 * customer serial. A successful (or failed) comparison is remembered for the life of the process,
 * so Tally is asked only once - when the application is opened. If Tally cannot be reached yet,
 * the check is simply retried the next time it is needed.
 */
export class TallyLicenseGuard {
  private state: LicenseState = { status: 'pending', message: 'Licence not verified yet.' };
  private inFlight: Promise<LicenseState> | null = null;

  constructor(
    private getClient: () => TallyClient,
    private expectedSerial: string = LICENSED_TALLY_SERIAL
  ) {}

  public getState(): LicenseState {
    return { ...this.state };
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

  private async check(signal?: AbortSignal): Promise<LicenseState> {
    const checkedAt = new Date().toISOString();
    let xml: string;
    try {
      xml = await this.getClient().sendXml(TALLY_LICENSE_REQUEST_XML, 10000, signal);
    } catch (err: any) {
      this.state = {
        status: 'unreachable',
        message: `Could not read the TallyPrime licence serial number: ${err.message}`,
        checkedAt,
      };
      logger.warn(`[License] ${this.state.message}`);
      return this.getState();
    }

    const serial = parseSerialFromResponse(xml);
    if (!serial) {
      logger.warn(`[License] TallyPrime returned no serial number. Raw response: ${(xml || '').slice(0, 300)}`);
      this.state = {
        status: 'invalid',
        message: 'Could not read the serial number from TallyPrime. Open TallyPrime with a licensed serial number and restart this application.',
        checkedAt,
      };
      return this.getState();
    }

    if (serial === this.expectedSerial.replace(/\s+/g, '')) {
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
