import { z } from 'zod';

const versionSchema = z.string().min(1).max(40);

export const updateStateSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('DISABLED'),
      reason: z.enum(['DEVELOPMENT', 'PORTABLE', 'PLATFORM']),
    })
    .strict(),
  z.object({ status: z.literal('IDLE') }).strict(),
  z.object({ status: z.literal('CHECKING') }).strict(),
  z.object({ status: z.literal('CURRENT') }).strict(),
  z.object({ status: z.literal('AVAILABLE'), version: versionSchema }).strict(),
  z
    .object({
      status: z.literal('DOWNLOADING'),
      version: versionSchema,
      percent: z.number().min(0).max(100),
    })
    .strict(),
  z.object({ status: z.literal('READY'), version: versionSchema }).strict(),
  z
    .object({ status: z.literal('ERROR'), message: z.string().max(200) })
    .strict(),
]);

export type UpdateState = z.infer<typeof updateStateSchema>;
