import { CAPTURE_PROFILES } from '../../shared/schemas/capture';

/** Native Chromium encoders; one independent RTP encoding per spectator. */
export async function configureSender(
  sender: RTCRtpSender,
  track: MediaStreamTrack,
): Promise<void> {
  const parameters = sender.getParameters();
  if (!parameters.encodings.length)
    throw new Error('Media encoding not negotiated');
  const profile =
    CAPTURE_PROFILES[
      (track.getSettings().height ?? 720) > 720 ? '1080p' : '720p'
    ];
  const requestedRate = track.getConstraints().frameRate;
  const maximumRate =
    typeof requestedRate === 'number' ? requestedRate : requestedRate?.max;
  const frameRate = maximumRate === 60 ? 60 : 30;
  for (const encoding of parameters.encodings) {
    encoding.maxBitrate =
      track.kind === 'video' ? profile.maxBitrate * (frameRate / 30) : 128000;
    if (track.kind === 'video') encoding.maxFramerate = frameRate;
  }
  await sender.setParameters(parameters);
}
