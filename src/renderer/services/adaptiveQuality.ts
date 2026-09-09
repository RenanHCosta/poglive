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

export const QUALITY_TIERS: Record<VideoQualityTier, QualityTierDefinition> = {
  '1080p60': {
    id: '1080p60',
    height: 1080,
    frameRate: 60,
    maxBitrate: 10_000_000,
  },
  '1080p30': {
    id: '1080p30',
    height: 1080,
    frameRate: 30,
    maxBitrate: 5_000_000,
  },
  '720p60': {
    id: '720p60',
    height: 720,
    frameRate: 60,
    maxBitrate: 5_000_000,
  },
  '720p30': {
    id: '720p30',
    height: 720,
    frameRate: 30,
    maxBitrate: 2_500_000,
  },
  '540p30': {
    id: '540p30',
    height: 540,
    frameRate: 30,
    maxBitrate: 1_500_000,
  },
  '540p15': {
    id: '540p15',
    height: 540,
    frameRate: 15,
    maxBitrate: 800_000,
  },
};

const LADDERS: Record<string, VideoQualityTier[]> = {
  '1080p60': ['1080p60', '1080p30', '720p30', '540p30', '540p15'],
  '1080p30': ['1080p30', '720p30', '540p30', '540p15'],
  '720p60': ['720p60', '720p30', '540p30', '540p15'],
  '720p30': ['720p30', '540p30', '540p15'],
};

export interface AdaptiveQualityState {
  level: number;
  badSamples: number;
  goodSamples: number;
  cooldownSamples: number;
  reason: VideoQualityReason;
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
    (tier) => QUALITY_TIERS[tier],
  );
}

export function initialQualityState(): AdaptiveQualityState {
  return {
    level: 0,
    badSamples: 0,
    goodSamples: 0,
    cooldownSamples: 0,
    reason: 'SOURCE',
  };
}

function badReason(
  sample: AdaptationSample,
  current: QualityTierDefinition,
): VideoQualityReason | null {
  const receiver = sample.receiver;
  if (sample.qualityLimitationReason === 'cpu') return 'CPU';
  if (
    receiver &&
    (receiver.freezes > 0 ||
      receiver.stalled ||
      (receiver.droppedRatio ?? 0) >= 0.08)
  )
    return 'RECEIVER';
  if (
    sample.qualityLimitationReason === 'bandwidth' ||
    (receiver?.lossRatio ?? 0) >= 0.03 ||
    (receiver?.jitterMs ?? 0) >= 80 ||
    (receiver?.jitterBufferMs ?? 0) >= 250 ||
    (receiver?.roundTripMs ?? sample.roundTripMs ?? 0) >= 350 ||
    (sample.availableOutgoingBitrate !== null &&
      sample.availableOutgoingBitrate < current.maxBitrate * 0.75)
  )
    return 'NETWORK';
  return null;
}

function isStable(
  sample: AdaptationSample,
  next: QualityTierDefinition | undefined,
): boolean {
  const receiver = sample.receiver;
  if (!receiver || sample.qualityLimitationReason === 'other') return false;
  if (
    (receiver.lossRatio ?? 0) > 0.01 ||
    (receiver.droppedRatio ?? 0) > 0.02 ||
    (receiver.jitterMs ?? 0) > 40 ||
    (receiver.jitterBufferMs ?? 0) > 180 ||
    (receiver.roundTripMs ?? sample.roundTripMs ?? 0) > 200 ||
    receiver.freezes > 0 ||
    receiver.stalled
  )
    return false;
  return (
    !next ||
    sample.availableOutgoingBitrate === null ||
    sample.availableOutgoingBitrate >= next.maxBitrate * 1.2
  );
}

export function evaluateQuality(
  state: AdaptiveQualityState,
  ladder: QualityTierDefinition[],
  sample: AdaptationSample,
): AdaptiveQualityState {
  const current = ladder[state.level] ?? ladder[0];
  if (!current) return state;
  const reason = badReason(sample, current);
  const nextHigher = state.level > 0 ? ladder[state.level - 1] : undefined;
  const stable = !reason && isStable(sample, nextHigher);
  const nextState: AdaptiveQualityState = {
    ...state,
    badSamples: reason ? state.badSamples + 1 : 0,
    goodSamples: stable ? state.goodSamples + 1 : 0,
    cooldownSamples: Math.max(0, state.cooldownSamples - 1),
    reason: reason ?? state.reason,
  };
  if (nextState.cooldownSamples > 0) return nextState;
  if (reason && nextState.badSamples >= 2 && state.level < ladder.length - 1)
    return {
      level: state.level + 1,
      badSamples: 0,
      goodSamples: 0,
      cooldownSamples: 3,
      reason,
    };
  if (stable && nextState.goodSamples >= 10 && state.level > 0)
    return {
      level: state.level - 1,
      badSamples: 0,
      goodSamples: 0,
      cooldownSamples: 5,
      reason: 'STABLE',
    };
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
  await sender.setParameters(parameters);
}
