import { createHash, randomBytes } from 'node:crypto';
import { inviteSchema } from '../../shared/schemas/room';
import type { Invite } from '../../shared/schemas/room';

// Every PL prefix carries the same 70-byte payload; the number marks the room
// protocol, so older builds reject the invite up front instead of failing
// mid-handshake. From v3 on, unknown message types are ignored, so additive
// features no longer need a new prefix.
const PREFIX = 'PL3.';
const LEGACY_PREFIXES = ['PL1.', 'PL2.', 'VS1.'];
const PAYLOAD_BYTES = 70;

function roomIdFromSecret(secret: string): string {
  const bytes = createHash('sha256')
    .update(Buffer.from(secret, 'base64url'))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newRoomAccess(): Pick<Invite, 'roomId' | 'secret'> {
  const secret = randomBytes(32).toString('base64url');
  return {
    roomId: roomIdFromSecret(secret),
    secret,
  };
}
export function encodeInvite(invite: Invite): string {
  const parsed = inviteSchema.parse(invite);
  if (parsed.roomId !== roomIdFromSecret(parsed.secret))
    throw new Error('Sala e segredo incompatíveis.');
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  parsed.host
    .split('.')
    .forEach((part, index) => (payload[index] = Number(part)));
  payload.writeUInt16BE(parsed.port, 4);
  Buffer.from(parsed.secret, 'base64url').copy(payload, 6);
  Buffer.from(parsed.fingerprint, 'hex').copy(payload, 38);
  return PREFIX + payload.toString('base64url');
}
export function decodeInvite(code: string): Invite {
  const normalized = code.trim();
  if (LEGACY_PREFIXES.some((prefix) => normalized.startsWith(prefix)))
    throw new Error(
      'Este convite é de uma versão anterior do Poglive. Atualize o app de quem criou a sala e gere um novo convite.',
    );
  try {
    if (!/^PL3\.[A-Za-z0-9_-]{94}$/.test(normalized)) throw new Error();
    const encoded = normalized.slice(PREFIX.length);
    const bytes = Buffer.from(encoded, 'base64url');
    if (
      bytes.length !== PAYLOAD_BYTES ||
      bytes.toString('base64url') !== encoded
    )
      throw new Error();
    const secret = bytes.subarray(6, 38).toString('base64url');
    return inviteSchema.parse({
      version: 1,
      host: Array.from(bytes.subarray(0, 4)).join('.'),
      port: bytes.readUInt16BE(4),
      roomId: roomIdFromSecret(secret),
      secret,
      fingerprint: bytes.subarray(38).toString('hex'),
    });
  } catch {
    throw new Error('Convite inválido ou de versão incompatível.');
  }
}
