import { z } from 'zod';
import { signalSchema } from './signaling';
import {
  identitySchema,
  participantSchema,
  PROTOCOL_VERSION,
  roomSnapshotSchema,
  voiceStateSchema,
} from '../schemas/room';
import {
  CHAT_HISTORY_LIMIT,
  chatMessageSchema,
  chatRejectionSchema,
  chatTextSchema,
  clipAttachmentSchema,
  previewImageSchema,
  reactionSchema,
} from '../schemas/chat';

const envelope = { version: z.literal(PROTOCOL_VERSION) };
// Room, presence, chat and signaling transport. Media control uses
// mediaMessageSchema over WebRTC and never travels through the host.
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
      reason: z.enum([
        'FULL',
        'DUPLICATE_ID',
        'WRONG_ROOM',
        'INVALID_SECRET',
        'KICKED',
      ]),
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
  // Member → host. The host binds the update to the authenticated connection.
  z
    .object({
      ...envelope,
      type: z.literal('VOICE_STATE'),
      voice: voiceStateSchema,
    })
    .strict(),
  // Member → host. The host stamps author, name and time before relaying.
  z
    .object({
      ...envelope,
      type: z.literal('CHAT_SEND'),
      id: z.uuid(),
      text: chatTextSchema,
      replyTo: z.uuid().nullable(),
      attachment: clipAttachmentSchema.nullable(),
    })
    .strict(),
  // Member → host: only the author may edit; author or host may delete.
  z
    .object({
      ...envelope,
      type: z.literal('CHAT_EDIT'),
      id: z.uuid(),
      text: chatTextSchema,
    })
    .strict(),
  z
    .object({ ...envelope, type: z.literal('CHAT_DELETE'), id: z.uuid() })
    .strict(),
  // Host → members.
  z
    .object({
      ...envelope,
      type: z.literal('CHAT_UPDATED'),
      message: chatMessageSchema,
    })
    .strict(),
  z
    .object({ ...envelope, type: z.literal('CHAT_DELETED'), id: z.uuid() })
    .strict(),
  // Live reactions on someone's stream.
  z
    .object({
      ...envelope,
      type: z.literal('REACT'),
      targetPeerId: z.uuid(),
      emoji: reactionSchema,
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('PEER_REACTION'),
      fromPeerId: z.uuid(),
      targetPeerId: z.uuid(),
      emoji: reactionSchema,
    })
    .strict(),
  // Stream thumbnail: member → host, then host → everyone else.
  z
    .object({
      ...envelope,
      type: z.literal('STREAM_PREVIEW'),
      image: previewImageSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('PEER_PREVIEW'),
      peerId: z.uuid(),
      image: previewImageSchema.nullable(),
    })
    .strict(),
  // Host → member, right before the host closes the connection.
  z.object({ ...envelope, type: z.literal('KICKED') }).strict(),
  // Host → members.
  z
    .object({
      ...envelope,
      type: z.literal('CHAT_MESSAGE'),
      message: chatMessageSchema,
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('CHAT_HISTORY'),
      messages: z.array(chatMessageSchema).max(CHAT_HISTORY_LIMIT),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('CHAT_REJECTED'),
      id: z.uuid(),
      reason: chatRejectionSchema,
    })
    .strict(),
  // Member → host: "I am typing". The host relays it with the sender's ID.
  z.object({ ...envelope, type: z.literal('TYPING') }).strict(),
  z
    .object({ ...envelope, type: z.literal('PEER_TYPING'), peerId: z.uuid() })
    .strict(),
  ...signalSchema.options,
  z.object({ ...envelope, type: z.literal('PING'), nonce: z.uuid() }).strict(),
  z.object({ ...envelope, type: z.literal('PONG'), nonce: z.uuid() }).strict(),
]);
export type NetworkMessage = z.infer<typeof networkMessageSchema>;

/** Message types this build understands; newer types are skipped, not fatal. */
export const KNOWN_NETWORK_TYPES: ReadonlySet<string> = new Set(
  networkMessageSchema.options.map((option) => option.shape.type.value),
);
