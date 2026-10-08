import { z } from 'zod';

export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u);
