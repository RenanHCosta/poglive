export const SILENCE_DB = -100;

/** RMS level of a time-domain buffer in dBFS, floored at SILENCE_DB. */
export function rmsDb(samples: Float32Array): number {
  if (!samples.length) return SILENCE_DB;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(rms)) : SILENCE_DB;
}

export interface GateOptions {
  automatic: boolean;
  thresholdDb: number;
}

// Keeps the gate open between words so syllables are not chopped.
const HOLD_MS = 320;
const AUTOMATIC_MARGIN_DB = 12;
const AUTOMATIC_MIN_DB = -62;
const AUTOMATIC_MAX_DB = -28;

/**
 * Voice-activity gate, like "input sensitivity" in voice chat apps. In
 * automatic mode it tracks the noise floor (falls fast, rises slowly) and
 * opens a fixed margin above it.
 */
export class VoiceGate {
  private floorDb = -70;
  private initialized = false;
  private openUntil = 0;
  isOpen = false;
  get thresholdDb(): number {
    return Math.min(
      AUTOMATIC_MAX_DB,
      Math.max(AUTOMATIC_MIN_DB, this.floorDb + AUTOMATIC_MARGIN_DB),
    );
  }
  update(levelDb: number, now: number, options: GateOptions): boolean {
    if (!this.initialized) {
      // Start from the first reading so a noisy room does not open the gate.
      this.floorDb = levelDb;
      this.initialized = true;
    }
    const step = levelDb < this.floorDb ? 0.3 : 0.004;
    this.floorDb += (levelDb - this.floorDb) * step;
    const threshold = options.automatic
      ? this.thresholdDb
      : options.thresholdDb;
    if (levelDb >= threshold) this.openUntil = now + HOLD_MS;
    this.isOpen = now < this.openUntil;
    return this.isOpen;
  }
  reset(): void {
    this.openUntil = 0;
    this.isOpen = false;
  }
}

const SPEAKING_THRESHOLD_DB = -52;
const SPEAKING_HOLD_MS = 280;

/** Speaking indicator for an already-gated remote voice track. */
export class SpeakingDetector {
  private until = 0;
  update(levelDb: number, now: number): boolean {
    if (levelDb >= SPEAKING_THRESHOLD_DB) this.until = now + SPEAKING_HOLD_MS;
    return now < this.until;
  }
}
