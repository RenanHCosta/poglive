import { z } from 'zod';
import type { CaptureOptions } from '../schemas/capture';

const stream = { version: z.literal(1), streamId: z.uuid() };
export const videoQualityTierSchema = z.enum([
  '1080p60',
  '1080p30',
  '720p60',
  '720p30',
  '540p30',
  '540p15',
  // Same resolution and frame rate with a smaller bitrate budget: blurrier
  // under motion, but neither the picture size nor the fluidity drops.
  '1080p60-low',
  '1080p30-low',
  '720p60-low',
  '720p30-low',
  // Source resolution (whatever the monitor or window is), up to 4K.
  'native60',
  'native60-low',
  'native30',
  'native30-low',
]);
export const videoQualityReasonSchema = z.enum([
  'SOURCE',
  'NETWORK',
  'CPU',
  'RECEIVER',
  'STABLE',
]);
// The authenticated PeerLink supplies identity: never trust an ID in a payload.
export const mediaMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...stream, type: z.literal('STREAM_STARTED') }),
  z.strictObject({ ...stream, type: z.literal('STREAM_STOPPED') }),
  z.strictObject({ ...stream, type: z.literal('WATCH_REQUEST') }),
  z.strictObject({ ...stream, type: z.literal('WATCH_STOP') }),
  z.strictObject({ ...stream, type: z.literal('WATCH_ACCEPTED') }),
  // Viewer → streamer: a clip of this stream was saved, for transparency.
  z.strictObject({ ...stream, type: z.literal('CLIP_SAVED') }),
  z.strictObject({
    ...stream,
    type: z.literal('QUALITY_REPORT'),
    lossRatio: z.number().min(0).max(1).nullable(),
    droppedRatio: z.number().min(0).max(1).nullable(),
    jitterMs: z.number().min(0).max(60000).nullable(),
    jitterBufferMs: z.number().min(0).max(60000).nullable(),
    roundTripMs: z.number().min(0).max(60000).nullable(),
    framesPerSecond: z.number().min(0).max(240).nullable(),
    frameWidth: z.number().int().min(1).max(16384).nullable(),
    frameHeight: z.number().int().min(1).max(16384).nullable(),
    freezes: z.number().int().min(0).max(10000),
    stalled: z.boolean(),
  }),
  z.strictObject({
    ...stream,
    type: z.literal('QUALITY_STATE'),
    tier: videoQualityTierSchema,
    automatic: z.boolean(),
    reduced: z.boolean(),
    reason: videoQualityReasonSchema,
  }),
]);
export type MediaMessage = z.infer<typeof mediaMessageSchema>;
export const KNOWN_MEDIA_TYPES: ReadonlySet<string> = new Set(
  mediaMessageSchema.options.map((option) => option.shape.type.value),
);
export type VideoQualityTier = z.infer<typeof videoQualityTierSchema>;
export type VideoQualityReason = z.infer<typeof videoQualityReasonSchema>;
export type QualityReport = Extract<MediaMessage, { type: 'QUALITY_REPORT' }>;
export interface LocalCapture {
  stream: MediaStream;
  options: CaptureOptions;
}
export interface LocalStream {
  streamId: string;
  track: MediaStreamTrack;
  audioTrack: MediaStreamTrack | null;
  options: CaptureOptions;
}
export type WatchState = 'IDLE' | 'CONNECTING' | 'WATCHING' | 'ERROR';
export interface RemoteVideoQuality {
  tier: VideoQualityTier;
  automatic: boolean;
  reduced: boolean;
  reason: VideoQualityReason;
  frameWidth: number | null;
  frameHeight: number | null;
  framesPerSecond: number | null;
  codec: string | null;
}
