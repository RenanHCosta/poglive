import { z } from 'zod';
import { displayNameSchema } from './common';

export const MAX_CHAT_LENGTH = 2000;
export const CHAT_LOG_LIMIT = 200;
export const CHAT_HISTORY_LIMIT = 100;

// Line breaks and tabs are allowed; other C0/C1 controls and bidirectional
// overrides are rejected because they can disguise the rendered text. Zero
// width joiners stay valid: emoji sequences depend on them.
// eslint-disable-next-line no-control-regex -- matching controls is the point.
const forbiddenCharacters = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/;

export const chatTextSchema = z
  .string()
  .min(1)
  .max(MAX_CHAT_LENGTH)
  .refine((text) => text.trim().length > 0, 'Mensagem vazia')
  .refine(
    (text) => !forbiddenCharacters.test(text),
    'Caracteres não permitidos',
  );

export const MAX_ATTACHMENT_BYTES = 512 * 1024 * 1024;

/**
 * A clip shared in chat. The host only relays this description; the bytes
 * go straight from the author's computer to whoever opens it.
 */
export const clipAttachmentSchema = z
  .object({
    kind: z.literal('clip'),
    id: z.uuid(),
    name: z.string().min(1).max(120),
    size: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(10 * 60 * 1000),
  })
  .strict();
export type ClipAttachment = z.infer<typeof clipAttachmentSchema>;

export const chatMessageSchema = z
  .object({
    id: z.uuid(),
    authorId: z.uuid(),
    authorName: displayNameSchema,
    text: chatTextSchema,
    sentAt: z.number().int().min(0).max(8.64e15),
    /** Message this one answers; may point to one no longer in the log. */
    replyTo: z.uuid().nullable(),
    attachment: clipAttachmentSchema.nullable(),
    editedAt: z.number().int().min(0).max(8.64e15).nullable(),
  })
  .strict();
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Fixed set: reactions are a signal, not a second chat. */
export const REACTIONS = [
  '🔥',
  '😂',
  '👏',
  '😮',
  '❤️',
  '💀',
  '🎉',
  '👀',
] as const;
export const reactionSchema = z.enum(REACTIONS);
export type Reaction = z.infer<typeof reactionSchema>;

// Small JPEG thumbnail of a stream, shown before anyone starts watching.
export const MAX_PREVIEW_LENGTH = 40_000;
export const previewImageSchema = z
  .string()
  .max(MAX_PREVIEW_LENGTH)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/);

export const chatRejectionSchema = z.enum(['RATE_LIMITED', 'UNAVAILABLE']);
export type ChatRejection = z.infer<typeof chatRejectionSchema>;

export const chatHistorySchema = z
  .object({
    roomId: z.uuid().nullable(),
    messages: z.array(chatMessageSchema).max(CHAT_LOG_LIMIT),
  })
  .strict();
export type ChatHistory = z.infer<typeof chatHistorySchema>;

/** Main → renderer notifications. State changes carry no payload: the renderer refetches. */
export const roomEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('STATE') }).strict(),
  z.object({ type: z.literal('CHAT_HISTORY'), roomId: z.uuid() }).strict(),
  z
    .object({ type: z.literal('TYPING'), roomId: z.uuid(), peerId: z.uuid() })
    .strict(),
  z
    .object({
      type: z.literal('CHAT_MESSAGE'),
      roomId: z.uuid(),
      message: chatMessageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CHAT_UPDATED'),
      roomId: z.uuid(),
      message: chatMessageSchema,
    })
    .strict(),
  z
    .object({ type: z.literal('CHAT_DELETED'), roomId: z.uuid(), id: z.uuid() })
    .strict(),
  z
    .object({
      type: z.literal('REACTION'),
      roomId: z.uuid(),
      fromPeerId: z.uuid(),
      targetPeerId: z.uuid(),
      emoji: reactionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('PREVIEW'),
      roomId: z.uuid(),
      peerId: z.uuid(),
      image: previewImageSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('CHAT_REJECTED'),
      roomId: z.uuid(),
      id: z.uuid(),
      reason: chatRejectionSchema,
    })
    .strict(),
]);
export type RoomEvent = z.infer<typeof roomEventSchema>;
