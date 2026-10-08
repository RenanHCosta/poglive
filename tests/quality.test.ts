import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  applyVideoQuality,
  evaluateQuality,
  initialQualityState,
  QUALITY_TIERS,
  qualityLadder,
  SOURCE_HEIGHT,
} from '../src/renderer/services/adaptiveQuality';
import type {
  AdaptationSample,
  AdaptiveQualityState,
} from '../src/renderer/services/adaptiveQuality';
import { captureOptionsSchema } from '../src/shared/schemas/capture';
import { mediaMessageSchema } from '../src/shared/protocols/media';
import { preferredVideoCodecs } from '../src/renderer/services/codecs';

const options = (quality: '720p' | '1080p' | 'native', frameRate: 30 | 60) =>
  captureOptionsSchema.parse({
    quality,
    frameRate,
    adaptiveQuality: true,
    audioMode: 'NONE',
  });

const healthy: AdaptationSample = {
  receiver: {
    version: 1,
    type: 'QUALITY_REPORT',
    streamId: randomUUID(),
    lossRatio: 0,
    droppedRatio: 0,
    jitterMs: 5,
    jitterBufferMs: 40,
    roundTripMs: 20,
    framesPerSecond: 60,
    frameWidth: 1920,
    frameHeight: 1080,
    freezes: 0,
    stalled: false,
  },
  qualityLimitationReason: 'none',
  // A LAN estimate well below the 1080p60 budget, as WebRTC really reports.
  availableOutgoingBitrate: 5_000_000,
  roundTripMs: 20,
};
const congested: AdaptationSample = {
  ...healthy,
  receiver: { ...healthy.receiver!, lossRatio: 0.06 },
  qualityLimitationReason: 'bandwidth',
};

function run(
  state: AdaptiveQualityState,
  sample: AdaptationSample,
  times: number,
): AdaptiveQualityState {
  let current = state;
  const ladder = qualityLadder(options('1080p', 60));
  for (let index = 0; index < times; index++)
    current = evaluateQuality(current, ladder, sample);
  return current;
}

test('ladders keep a 720p30 floor and prefer fluidity for 60 FPS', () => {
  assert.deepEqual(
    qualityLadder(options('1080p', 60)).map((tier) => tier.id),
    ['1080p60', '1080p60-low', '720p60', '720p60-low', '720p30-low'],
  );
  assert.deepEqual(
    qualityLadder(options('1080p', 30)).map((tier) => tier.id),
    ['1080p30', '1080p30-low', '720p30', '720p30-low'],
  );
  for (const quality of ['720p', '1080p', 'native'] as const)
    for (const frameRate of [30, 60] as const)
      for (const tier of qualityLadder(options(quality, frameRate))) {
        assert.ok(tier.height === SOURCE_HEIGHT || tier.height >= 720, tier.id);
        assert.ok(tier.frameRate >= 30, tier.id);
      }
  // New tier names are valid on the control channel.
  assert.equal(
    mediaMessageSchema.safeParse({
      version: 1,
      type: 'QUALITY_STATE',
      streamId: randomUUID(),
      tier: '720p30-low',
      automatic: true,
      reduced: true,
      reason: 'NETWORK',
    }).success,
    true,
  );
});

test('a healthy LAN stream stays at 1080p60 despite a modest estimate', () => {
  const state = run(initialQualityState(), healthy, 60);
  assert.equal(state.level, 0);
});

test('screen pauses alone do not degrade the stream', () => {
  const paused: AdaptationSample = {
    ...healthy,
    receiver: { ...healthy.receiver!, freezes: 2, framesPerSecond: 3 },
  };
  assert.equal(run(initialQualityState(), paused, 30).level, 0);
});

test('real congestion drops after warm-up and recovers', () => {
  let state = run(initialQualityState(), congested, 3);
  assert.equal(state.level, 0, 'no drop during warm-up');
  state = run(state, congested, 2);
  assert.equal(state.level, 1);
  assert.equal(state.reason, 'NETWORK');
  // Recovers after cooldown plus the required stable run.
  state = run(state, healthy, 3 + 6);
  assert.equal(state.level, 0);
  assert.equal(state.reason, 'STABLE');
});

test('a failed upgrade doubles the wait before the next attempt', () => {
  let state = run(initialQualityState(), congested, 5);
  assert.equal(state.level, 1);
  state = run(state, healthy, 9);
  assert.equal(state.level, 0);
  // Congestion right after the upgrade: drop again, longer wait next time.
  state = run(state, healthy, 3);
  state = run(state, congested, 2);
  assert.equal(state.level, 1);
  assert.equal(state.stableRequired, 12);
  state = run(state, healthy, 11);
  assert.equal(state.level, 1);
  state = run(state, healthy, 1);
  assert.equal(state.level, 0);
});

test('decoder stalls and CPU limits are acted on', () => {
  const stalled: AdaptationSample = {
    ...healthy,
    receiver: { ...healthy.receiver!, stalled: true },
  };
  let state = run(initialQualityState(), healthy, 3);
  state = run(state, stalled, 2);
  assert.equal(state.level, 1);
  assert.equal(state.reason, 'RECEIVER');
  const cpu: AdaptationSample = { ...healthy, qualityLimitationReason: 'cpu' };
  state = run(run(initialQualityState(), healthy, 3), cpu, 2);
  assert.equal(state.reason, 'CPU');
});

test('tiers set bitrate, frame rate, scale and balanced degradation', async () => {
  const encoding: RTCRtpEncodingParameters = {};
  const parameters = { encodings: [encoding] } as RTCRtpSendParameters;
  const sender = {
    getParameters: () => parameters,
    setParameters: async () => undefined,
  } as unknown as RTCRtpSender;
  const track = {
    getSettings: () => ({ height: 1080 }),
    contentHint: 'detail',
  } as unknown as MediaStreamTrack;
  await applyVideoQuality(sender, track, QUALITY_TIERS['720p30-low']);
  assert.equal(encoding.maxBitrate, 1_800_000);
  assert.equal(encoding.maxFramerate, 30);
  assert.equal(encoding.scaleResolutionDownBy, 1.5);
  assert.equal(parameters.degradationPreference, 'balanced');
  await applyVideoQuality(sender, track, QUALITY_TIERS['1080p60']);
  assert.equal(encoding.maxBitrate, 12_000_000);
  assert.equal(encoding.scaleResolutionDownBy, 1);
});

test('screen video prefers H.264 with the best profile first', () => {
  const codec = (mimeType: string, sdpFmtpLine?: string) =>
    ({
      mimeType,
      clockRate: 90000,
      ...(sdpFmtpLine ? { sdpFmtpLine } : {}),
    }) as RTCRtpCodec;
  const vp8 = codec('video/VP8');
  const baseline = codec(
    'video/H264',
    'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
  );
  const baselineSingle = codec(
    'video/H264',
    'level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f',
  );
  const high = codec(
    'video/H264',
    'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640032',
  );
  const rtx = codec('video/rtx', 'apt=96');
  assert.deepEqual(
    preferredVideoCodecs([vp8, baselineSingle, baseline, rtx, high]),
    [high, baseline, baselineSingle, vp8, rtx],
  );
  assert.deepEqual(preferredVideoCodecs([vp8, rtx]), [vp8, rtx]);
});

test('native resolution streams the source size, then falls back to 1080p', async () => {
  assert.deepEqual(
    qualityLadder(options('native', 60)).map((tier) => tier.id),
    [
      'native60',
      'native60-low',
      '1080p60',
      '1080p60-low',
      '720p60-low',
      '720p30-low',
    ],
  );
  const encoding: RTCRtpEncodingParameters = {};
  const parameters = { encodings: [encoding] } as RTCRtpSendParameters;
  const sender = {
    getParameters: () => parameters,
    setParameters: async () => undefined,
  } as unknown as RTCRtpSender;
  const track = {
    getSettings: () => ({ height: 1440 }),
  } as unknown as MediaStreamTrack;
  await applyVideoQuality(sender, track, QUALITY_TIERS.native60);
  assert.equal(encoding.scaleResolutionDownBy, undefined);
  assert.equal(encoding.maxBitrate, 20_000_000);
  // Falling back to 1080p scales a 1440p source down by 4/3.
  await applyVideoQuality(sender, track, QUALITY_TIERS['1080p60']);
  assert.equal(encoding.scaleResolutionDownBy, 1.33);
  await applyVideoQuality(sender, track, QUALITY_TIERS['native60-low']);
  assert.equal(encoding.scaleResolutionDownBy, 1);
});
