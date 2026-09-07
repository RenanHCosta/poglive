import { generate } from 'selfsigned';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { TLSSocket } from 'node:tls';

export async function createCertificate(): Promise<{
  key: string;
  cert: string;
  fingerprint: string;
}> {
  const pems = await generate([{ name: 'commonName', value: 'Poglive' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 60000),
    notAfterDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  const der = Buffer.from(
    pems.cert.replace(/-----[^-]+-----|\s/g, ''),
    'base64',
  );
  return {
    key: pems.private,
    cert: pems.cert,
    fingerprint: createHash('sha256').update(der).digest('hex'),
  };
}
export function matchesCertificate(
  socket: TLSSocket,
  fingerprint: string,
): boolean {
  const cert = socket.getPeerCertificate();
  if (!cert.raw || !/^[a-f0-9]{64}$/.test(fingerprint)) return false;
  const actual = createHash('sha256').update(cert.raw).digest();
  const now = Date.now();
  return (
    timingSafeEqual(actual, Buffer.from(fingerprint, 'hex')) &&
    Date.parse(cert.valid_from) <= now &&
    Date.parse(cert.valid_to) >= now
  );
}
