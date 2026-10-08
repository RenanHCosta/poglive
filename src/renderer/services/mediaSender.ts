import type { CaptureOptions } from '../../shared/schemas/capture';
import { applyVideoQuality, qualityLadder } from './adaptiveQuality';

const STREAM_AUDIO_BITRATE = 128_000;
const VOICE_BITRATE = 64_000;

/** Native Chromium encoders; one independent RTP encoding per spectator. */
export async function configureSender(
  sender: RTCRtpSender,
  track: MediaStreamTrack,
  options: CaptureOptions,
): Promise<void> {
  if (track.kind === 'video') {
    const tier = qualityLadder(options)[0];
    if (!tier) throw new Error('Video quality unavailable');
    await applyVideoQuality(sender, track, tier);
    return;
  }
  const parameters = sender.getParameters();
  if (!parameters.encodings.length)
    throw new Error('Media encoding not negotiated');
  for (const encoding of parameters.encodings)
    encoding.maxBitrate = STREAM_AUDIO_BITRATE;
  await sender.setParameters(parameters);
}

/** Voice is small but latency-sensitive: mark it ahead of video under congestion. */
export async function configureVoiceSender(
  sender: RTCRtpSender,
): Promise<void> {
  const parameters = sender.getParameters();
  if (!parameters.encodings.length)
    throw new Error('Media encoding not negotiated');
  for (const encoding of parameters.encodings) {
    encoding.maxBitrate = VOICE_BITRATE;
    encoding.priority = 'high';
    encoding.networkPriority = 'high';
  }
  await sender.setParameters(parameters);
}
