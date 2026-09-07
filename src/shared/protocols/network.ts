import { z } from 'zod';
import { signalSchema } from './signaling';
import {
  identitySchema,
  participantSchema,
  roomSnapshotSchema,
} from '../schemas/room';

const envelope = { version: z.literal(1) };
// Room/signaling transport only. Media control uses mediaMessageSchema over WebRTC.
export const networkMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...envelope,
      type: z.literal('ROOM_JOIN'),
      roomId: z.uuid(),
      identity: identitySchema,
      secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('ROOM_JOIN_ACCEPTED'),
      room: roomSnapshotSchema,
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('ROOM_JOIN_REJECTED'),
      reason: z.enum(['FULL', 'DUPLICATE_ID', 'WRONG_ROOM', 'INVALID_SECRET']),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('PEER_JOINED'),
      peer: participantSchema,
    })
    .strict(),
  z
    .object({ ...envelope, type: z.literal('PEER_LEFT'), peerId: z.uuid() })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('ROOM_STATE'),
      room: roomSnapshotSchema,
    })
    .strict(),
  ...signalSchema.options,
  z.object({ ...envelope, type: z.literal('PING'), nonce: z.uuid() }).strict(),
  z.object({ ...envelope, type: z.literal('PONG'), nonce: z.uuid() }).strict(),
]);
export type NetworkMessage = z.infer<typeof networkMessageSchema>;
