import { randomBytes, randomUUID } from 'node:crypto';
import { inviteSchema } from '../../shared/schemas/room';
import type { Invite } from '../../shared/schemas/room';

const PREFIX = 'VS1.';
export function newRoomAccess(): Pick<Invite, 'roomId' | 'secret'> {
  return {
    roomId: randomUUID(),
    secret: randomBytes(32).toString('base64url'),
  };
}
export function encodeInvite(invite: Invite): string {
  return (
    PREFIX +
    Buffer.from(JSON.stringify(inviteSchema.parse(invite))).toString(
      'base64url',
    )
  );
}
export function decodeInvite(code: string): Invite {
  try {
    if (code.length > 1024 || !/^VS1\.[A-Za-z0-9_-]+$/.test(code))
      throw new Error();
    const encoded = code.slice(PREFIX.length);
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) throw new Error();
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    const invite = inviteSchema.parse(value);
    if (
      Buffer.from(invite.secret, 'base64url').toString('base64url') !==
      invite.secret
    )
      throw new Error();
    return invite;
  } catch {
    throw new Error('Convite inválido ou de versão incompatível.');
  }
}
