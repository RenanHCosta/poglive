import { z } from 'zod';

export const MAX_PEERS = 8;
export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u);
export const identitySchema = z
  .object({ peerId: z.uuid(), displayName: displayNameSchema })
  .strict();
export type Identity = z.infer<typeof identitySchema>;
export const participantSchema = identitySchema.extend({
  role: z.enum(['HOST', 'MEMBER']),
});
export const ipv4Schema = z.ipv4().refine((value) => {
  const first = Number(value.split('.')[0]);
  return first > 0 && first < 224 && value !== '255.255.255.255';
}, 'Endereço IPv4 inválido');
export const inviteSchema = z
  .object({
    version: z.literal(1),
    host: ipv4Schema,
    port: z.number().int().min(1024).max(65535),
    roomId: z.uuid(),
    secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type Invite = z.infer<typeof inviteSchema>;
export const rtcEndpointSchema = z
  .object({ host: ipv4Schema, port: z.number().int().min(1024).max(65535) })
  .strict();
export const roomSnapshotSchema = z
  .object({
    roomId: z.uuid(),
    name: displayNameSchema,
    hostPeerId: z.uuid(),
    rtcEndpoint: rtcEndpointSchema,
    participants: z.array(participantSchema).min(1).max(MAX_PEERS),
  })
  .strict()
  .superRefine((room, ctx) => {
    const hosts = room.participants.filter((p) => p.role === 'HOST');
    if (
      hosts.length !== 1 ||
      hosts[0]?.peerId !== room.hostPeerId ||
      new Set(room.participants.map((p) => p.peerId)).size !==
        room.participants.length
    ) {
      ctx.addIssue({ code: 'custom', message: 'Participantes inconsistentes' });
    }
  });
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
export const roomStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('IDLE') }).strict(),
  z.object({ status: z.literal('CONNECTING') }).strict(),
  z
    .object({
      status: z.literal('HOSTING'),
      room: roomSnapshotSchema,
      invite: z.string().max(1024),
    })
    .strict(),
  z.object({ status: z.literal('JOINED'), room: roomSnapshotSchema }).strict(),
  z
    .object({ status: z.literal('DISCONNECTED'), message: z.string().max(200) })
    .strict(),
]);
export type RoomState = z.infer<typeof roomStateSchema>;
export const localStateSchema = z
  .object({
    identity: identitySchema.nullable(),
    room: roomStateSchema,
    addresses: z
      .array(
        z.object({ address: ipv4Schema, label: z.string().max(200) }).strict(),
      )
      .max(64),
  })
  .strict();
export type LocalState = z.infer<typeof localStateSchema>;
export const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('SAVE_IDENTITY'),
      displayName: displayNameSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CREATE_ROOM'),
      name: displayNameSchema,
      address: ipv4Schema,
    })
    .strict(),
  z
    .object({
      type: z.literal('JOIN_ROOM'),
      invite: z.string().trim().min(1).max(1024),
    })
    .strict(),
  z.object({ type: z.literal('LEAVE_ROOM') }).strict(),
  z.object({ type: z.literal('COPY_INVITE') }).strict(),
]);
export type RoomCommand = z.infer<typeof commandSchema>;
export const commandResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('OK') }).strict(),
  z
    .object({ status: z.literal('ERROR'), message: z.string().max(200) })
    .strict(),
]);
export type CommandResult = z.infer<typeof commandResultSchema>;
