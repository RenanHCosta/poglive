import type { CaptureOptions } from '../../shared/schemas/capture';
import type {
  QualityReport,
  VideoQualityReason,
  VideoQualityTier,
} from '../../shared/protocols/media';

export interface QualityTierDefinition {
  id: VideoQualityTier;
  height: number;
  frameRate: number;
  maxBitrate: number;
}

function tier(
  id: VideoQualityTier,
  height: number,
  frameRate: number,
  maxBitrate: number,
): QualityTierDefinition {
  return { id, height, frameRate, maxBitrate };
}

export const QUALITY_TIERS: Record<VideoQualityTier, QualityTierDefinition> = {
  '1080p60': tier('1080p60', 1080, 60, 12_000_000),
  '1080p60-low': tier('1080p60-low', 1080, 60, 7_000_000),
  '1080p30': tier('1080p30', 1080, 30, 6_000_000),
  '1080p30-low': tier('1080p30-low', 1080, 30, 3_500_000),
  '720p60': tier('720p60', 720, 60, 6_000_000),
  '720p60-low': tier('720p60-low', 720, 60, 3_500_000),
  '720p30': tier('720p30', 720, 30, 3_000_000),
  '720p30-low': tier('720p30-low', 720, 30, 1_800_000),
  // Kept for wire compatibility; no ladder goes below 720p30 anymore.
  '540p30': tier('540p30', 540, 30, 1_500_000),
  '540p15': tier('540p15', 540, 15, 800_000),
};

/**
 * Steps tried under pressure. A 60 FPS choice keeps fluidity as long as
 * possible; every ladder trims bitrate before resolution and never goes
 * below 720p30.
 */
const LADDERS: Record<string, VideoQualityTier[]> = {
  '1080p60': ['1080p60', '1080p60-low', '720p60', '720p60-low', '720p30-low'],
  '1080p30': ['1080p30', '1080p30-low', '720p30', '720p30-low'],
  '720p60': ['720p60', '720p60-low', '720p30-low'],
  '720p30': ['720p30', '720p30-low'],
};

// Samples arrive every 2 s.
const WARMUP_SAMPLES = 3;
const BAD_SAMPLES_TO_DROP = 2;
const BASE_STABLE_SAMPLES = 6;
const MAX_STABLE_SAMPLES = 48;
// A drop this soon after an upgrade means the upgrade failed.
const FAILED_UPGRADE_WINDOW = 15;

export interface AdaptiveQualityState {
  level: number;
  badSamples: number;
  goodSamples: number;
  cooldownSamples: number;
  reason: VideoQualityReason;
  /** Samples evaluated since the stream started. */
  samples: number;
  /** Samples since the last upgrade, or null when the last change was a drop. */
  sinceUpgrade: number | null;
  /** Stable samples required before trying the next step up. */
  stableRequired: number;
}

export interface AdaptationSample {
  receiver: QualityReport | null;
  qualityLimitationReason: 'none' | 'bandwidth' | 'cpu' | 'other' | null;
  availableOutgoingBitrate: number | null;
  roundTripMs: number | null;
}

export function qualityLadder(
  options: CaptureOptions,
): QualityTierDefinition[] {
  const key = `${options.quality}${options.frameRate}`;
  return (LADDERS[key] ?? LADDERS['720p30'] ?? []).map(
    (id) => QUALITY_TIERS[id],
  );
}

export function initialQualityState(): AdaptiveQualityState {
  return {
    level: 0,
    badSamples: 0,
    goodSamples: 0,
    cooldownSamples: 0,
    reason: 'SOURCE',
    samples: 0,
    sinceUpgrade: null,
    stableRequired: BASE_STABLE_SAMPLES,
  };
}

/**
 * Only signals that something is actually suffering count. Screen capture
 * produces frames only when the picture changes, so pauses alone ("freezes")
 * and a modest bandwidth estimate are normal, not a reason to degrade.
 */
function badReason(sample: AdaptationSample): VideoQualityReason | null {
  const receiver = sample.receiver;
  if (sample.qualityLimitationReason === 'cpu') return 'CPU';
  const lossy =
    (receiver?.lossRatio ?? 0) >= 0.01 ||
    (receiver?.jitterBufferMs ?? 0) >= 200;
  if (
    receiver &&
    (receiver.stalled ||
      (receiver.droppedRatio ?? 0) >= 0.15 ||
      (receiver.freezes > 0 && lossy))
  )
    return 'RECEIVER';
  if (
    sample.qualityLimitationReason === 'bandwidth' ||
    (receiver?.lossRatio ?? 0) >= 0.03 ||
    (receiver?.jitterMs ?? 0) >= 80 ||
    (receiver?.jitterBufferMs ?? 0) >= 300 ||
    (receiver?.roundTripMs ?? sample.roundTripMs ?? 0) >= 400
  )
    return 'NETWORK';
  return null;
}

function isStable(sample: AdaptationSample): boolean {
  const receiver = sample.receiver;
  if (!receiver) return false;
  if (
    sample.qualityLimitationReason === 'bandwidth' ||
    sample.qualityLimitationReason === 'cpu'
  )
    return false;
  return (
    !receiver.stalled &&
    (receiver.lossRatio ?? 0) <= 0.01 &&
    (receiver.droppedRatio ?? 0) <= 0.05 &&
    (receiver.jitterMs ?? 0) <= 40 &&
    (receiver.jitterBufferMs ?? 0) <= 200 &&
    (receiver.roundTripMs ?? sample.roundTripMs ?? 0) <= 250
  );
}

export function evaluateQuality(
  state: AdaptiveQualityState,
  ladder: QualityTierDefinition[],
  sample: AdaptationSample,
): AdaptiveQualityState {
  const samples = state.samples + 1;
  // Bandwidth estimation ramps up after a stream starts; judge it afterwards.
  const warmingUp = samples <= WARMUP_SAMPLES;
  const reason = warmingUp ? null : badReason(sample);
  const stable = !reason && !warmingUp && isStable(sample);
  const sinceUpgrade =
    state.sinceUpgrade === null ? null : state.sinceUpgrade + 1;
  const nextState: AdaptiveQualityState = {
    ...state,
    samples,
    sinceUpgrade,
    badSamples: reason ? state.badSamples + 1 : 0,
    goodSamples: stable ? state.goodSamples + 1 : 0,
    cooldownSamples: Math.max(0, state.cooldownSamples - 1),
    reason: reason ?? state.reason,
  };
  if (nextState.cooldownSamples > 0) return nextState;
  if (
    reason &&
    nextState.badSamples >= BAD_SAMPLES_TO_DROP &&
    state.level < ladder.length - 1
  ) {
    // A failed upgrade makes the next attempt wait twice as long.
    const failedUpgrade =
      sinceUpgrade !== null && sinceUpgrade <= FAILED_UPGRADE_WINDOW;
    return {
      ...nextState,
      level: state.level + 1,
      badSamples: 0,
      goodSamples: 0,
      cooldownSamples: 3,
      reason,
      sinceUpgrade: null,
      stableRequired: failedUpgrade
        ? Math.min(MAX_STABLE_SAMPLES, state.stableRequired * 2)
        : state.stableRequired,
    };
  }
  if (
    stable &&
    nextState.goodSamples >= state.stableRequired &&
    state.level > 0
  )
    return {
      ...nextState,
      level: state.level - 1,
      badSamples: 0,
      goodSamples: 0,
      cooldownSamples: 3,
      reason: 'STABLE',
      sinceUpgrade: 0,
    };
  // A long healthy run forgives earlier failed upgrades.
  if (
    stable &&
    sinceUpgrade !== null &&
    sinceUpgrade > FAILED_UPGRADE_WINDOW * 4
  )
    return { ...nextState, stableRequired: BASE_STABLE_SAMPLES };
  return nextState;
}

export async function applyVideoQuality(
  sender: RTCRtpSender,
  track: MediaStreamTrack,
  tier: QualityTierDefinition,
): Promise<void> {
  const parameters = sender.getParameters();
  if (!parameters.encodings.length)
    throw new Error('Media encoding not negotiated');
  const sourceHeight = track.getSettings().height ?? tier.height;
  const scale = Math.max(1, sourceHeight / tier.height);
  for (const encoding of parameters.encodings) {
    encoding.maxBitrate = tier.maxBitrate;
    encoding.maxFramerate = tier.frameRate;
    if (scale > 1 || encoding.scaleResolutionDownBy !== undefined)
      encoding.scaleResolutionDownBy = Math.round(scale * 100) / 100;
  }
  // Within a tier, WebRTC trades a little frame rate and resolution evenly;
  // the ladder above decides the larger steps and keeps the 720p floor.
  parameters.degradationPreference = 'balanced';
  await sender.setParameters(parameters);
}
