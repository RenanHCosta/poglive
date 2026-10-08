/**
 * Screen video prefers H.264: Chromium hands it to the GPU encoder
 * (NVENC/AMF/Quick Sync through Media Foundation) when available. On a test
 * machine a 1080p screen held 29 FPS with H.264 versus 14 FPS with software
 * VP8. Every other codec stays negotiable as a fallback.
 */
const H264_PROFILE_ORDER = ['640', '4d0', '42e', '420'];

function h264Rank(codec: RTCRtpCodec): number {
  const fmtp = codec.sdpFmtpLine ?? '';
  // Non-interleaved packetization is the one WebRTC actually uses.
  const packetization = /packetization-mode=1/.test(fmtp) ? 0 : 10;
  const profile = /profile-level-id=([0-9a-f]{3})/i
    .exec(fmtp)?.[1]
    ?.toLowerCase();
  const index = profile ? H264_PROFILE_ORDER.indexOf(profile) : -1;
  return packetization + (index < 0 ? H264_PROFILE_ORDER.length : index);
}

export function preferredVideoCodecs(
  codecs: readonly RTCRtpCodec[],
): RTCRtpCodec[] {
  const h264 = codecs
    .filter((codec) => codec.mimeType.toLowerCase() === 'video/h264')
    .sort((a, b) => h264Rank(a) - h264Rank(b));
  return [...h264, ...codecs.filter((codec) => !h264.includes(codec))];
}

/** Applies the preference when the browser supports it; never throws. */
export function preferHardwareVideo(transceiver: RTCRtpTransceiver): void {
  try {
    const capabilities = RTCRtpReceiver.getCapabilities('video');
    if (!capabilities || !('setCodecPreferences' in transceiver)) return;
    transceiver.setCodecPreferences(preferredVideoCodecs(capabilities.codecs));
  } catch {
    // Keep the default order rather than failing the link.
  }
}
