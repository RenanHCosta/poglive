import { z } from 'zod';
import { roomSnapshotSchema } from '../schemas/room';

const route = {
  version: z.literal(1),
  roomId: z.uuid(),
  fromPeerId: z.uuid(),
  toPeerId: z.uuid(),
  negotiationId: z.uuid(),
};
export const signalSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...route,
      type: z.literal('WEBRTC_OFFER'),
      sdp: z.string().min(1).max(48000),
    })
    .strict(),
  z
    .object({
      ...route,
      type: z.literal('WEBRTC_ANSWER'),
      sdp: z.string().min(1).max(48000),
    })
    .strict(),
  z
    .object({
      ...route,
      type: z.literal('ICE_CANDIDATE'),
      candidate: z
        .object({
          candidate: z.string().max(4096),
          sdpMid: z.string().max(256).nullable(),
          sdpMLineIndex: z.number().int().min(0).max(64).nullable(),
        })
        .strict()
        .nullable(),
    })
    .strict(),
]);
export type Signal = z.infer<typeof signalSchema>;
export const signalBatchSchema = z
  .object({
    room: roomSnapshotSchema.nullable(),
    signals: z.array(signalSchema).max(128),
  })
  .strict();
export type SignalBatch = z.infer<typeof signalBatchSchema>;
