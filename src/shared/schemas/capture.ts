import { z } from 'zod';

export const sourceIdSchema = z.string().min(1).max(256);
export const captureOptionsSchema = z.strictObject({
  quality: z.enum(['720p', '1080p']),
  frameRate: z.union([z.literal(30), z.literal(60)]),
  audioMode: z.enum(['NONE', 'SYSTEM', 'WINDOW']),
});
export type CaptureOptions = z.infer<typeof captureOptionsSchema>;
export const CAPTURE_PROFILES = {
  '720p': { width: 1280, height: 720, maxBitrate: 2500000 },
  '1080p': { width: 1920, height: 1080, maxBitrate: 5000000 },
} as const;
// Bitrate presets are for 30 FPS; the sender doubles the budget for 60 FPS.
export const captureSelectionSchema = z.strictObject({
  id: sourceIdSchema,
  options: captureOptionsSchema,
});
export const captureSourceSchema = z
  .object({
    id: sourceIdSchema,
    name: z.string().max(512),
    kind: z.enum(['screen', 'window']),
    thumbnail: z
      .string()
      .max(1000000)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]*$/),
  })
  .strict();
export type CaptureSource = z.infer<typeof captureSourceSchema>;
export const captureSourcesResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('OK'),
      sources: z.array(captureSourceSchema).max(100),
    })
    .strict(),
  z
    .object({ status: z.literal('ERROR'), message: z.string().max(200) })
    .strict(),
]);
export type CaptureSourcesResult = z.infer<typeof captureSourcesResultSchema>;
