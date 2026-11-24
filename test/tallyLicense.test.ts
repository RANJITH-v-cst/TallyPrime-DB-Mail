import http from 'http';
import { TallyClient } from '../src/tally/client';
import {
  TallyLicenseGuard,
  LICENSED_TALLY_SERIAL,
  parseSerialFromResponse,
} from '../src/license/tallyLicense';
import { startMockTallyServer, setMockSerialNumber } from '../src/mock/mockTallyServer';

const PORT = 9411;

describe('Tally licence serial number check', () => {
  let server: http.Server;
  let requests = 0;

  beforeAll(async () => {
    server = await startMockTallyServer(PORT, 'native');
    server.on('request', (_req, _res) => {
      requests++;
    });
  });

  afterAll(async () => {
    await new Promise((r) => server.close(() => r(null)));
  });

  beforeEach(() => {
    requests = 0;
    setMockSerialNumber(LICENSED_TALLY_SERIAL);
  });

  const makeGuard = (port = PORT) => new TallyLicenseGuard(() => new TallyClient({ host: '127.0.0.1', port, timeoutMs: 5000 } as any));

  test('parses the serial from a Tally response', () => {
    expect(parseSerialFromResponse('<ENVELOPE><ADVLICSERIAL> 741042099 </ADVLICSERIAL></ENVELOPE>')).toBe('741042099');
    expect(parseSerialFromResponse('<ENVELOPE></ENVELOPE>')).toBeNull();
  });

  test('matching serial is valid and is checked only once', async () => {
    const guard = makeGuard();
    expect((await guard.verify()).status).toBe('valid');
    expect((await guard.verify()).status).toBe('valid');
    expect(guard.isLicensed()).toBe(true);
    expect(requests).toBe(1);
  });

  test('different serial is invalid and stays blocked without re-checking', async () => {
    setMockSerialNumber('123456789');
    const guard = makeGuard();
    const state = await guard.verify();
    expect(state.status).toBe('invalid');
    expect(state.detectedSerial).toBe('123456789');
    await guard.verify();
    expect(requests).toBe(1);
    expect(guard.isLicensed()).toBe(false);
  });

  test('missing serial is treated as invalid', async () => {
    setMockSerialNumber(null);
    expect((await makeGuard().verify()).status).toBe('invalid');
  });

  test('unreachable Tally is retried later and is not cached', async () => {
    const guard = makeGuard(9499); // nothing listening
    expect((await guard.verify()).status).toBe('unreachable');
    expect(guard.isLicensed()).toBe(false);
  });
});
