import { z } from 'zod';

const stream = { version: z.literal(1), streamId: z.uuid() };
// The authenticated PeerLink supplies identity: never trust an ID in a payload.
export const mediaMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...stream, type: z.literal('STREAM_STARTED') }),
  z.strictObject({ ...stream, type: z.literal('STREAM_STOPPED') }),
  z.strictObject({ ...stream, type: z.literal('WATCH_REQUEST') }),
  z.strictObject({ ...stream, type: z.literal('WATCH_STOP') }),
  z.strictObject({ ...stream, type: z.literal('WATCH_ACCEPTED') }),
]);
export type MediaMessage = z.infer<typeof mediaMessageSchema>;
export interface LocalStream {
  streamId: string;
  track: MediaStreamTrack;
  audioTrack: MediaStreamTrack | null;
}
export type WatchState = 'IDLE' | 'CONNECTING' | 'WATCHING' | 'ERROR';
