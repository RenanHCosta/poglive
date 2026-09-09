import type { CaptureOptions } from '../../shared/schemas/capture';
import { applyVideoQuality, qualityLadder } from './adaptiveQuality';

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
  for (const encoding of parameters.encodings) encoding.maxBitrate = 128_000;
  await sender.setParameters(parameters);
}
