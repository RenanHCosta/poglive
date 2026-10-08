import { WebmClipBuffer } from './webm';

const H264 = 'video/webm;codecs=h264,opus';
const VP8 = 'video/webm;codecs=vp8,opus';
const PROBE_MS = 1500;
const PROBE_FPS = 30;
// Below this, the H.264 path is software-only and too slow to keep up.
const MIN_HEALTHY_FPS = 20;

let choice: Promise<string | null> | null = null;

/**
 * H.264 is cheap when a GPU encoder exists but can crawl in software (seen
 * on GPU-less machines: clips with a handful of frames). A short one-time
 * recording of an animated canvas measures the real frame rate.
 */
export function clipMimeType(): Promise<string | null> {
  choice ??= probe().catch(() => fallback());
  return choice;
}

function fallback(): string | null {
  return MediaRecorder.isTypeSupported(VP8)
    ? VP8
    : MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm'
      : null;
}

async function probe(): Promise<string | null> {
  if (typeof MediaRecorder === 'undefined') return null;
  if (!MediaRecorder.isTypeSupported(H264)) return fallback();
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext('2d');
  if (!context) return fallback();
  let frame = 0;
  const draw = setInterval(() => {
    frame++;
    context.fillStyle = `hsl(${(frame * 11) % 360} 60% 40%)`;
    context.fillRect(0, 0, 1280, 720);
    context.fillStyle = '#fff';
    context.fillRect((frame * 37) % 1200, 300, 80, 80);
  }, 1000 / PROBE_FPS);
  const stream = canvas.captureStream(PROBE_FPS);
  const buffer = new WebmClipBuffer(60_000);
  const chunks: Promise<void>[] = [];
  try {
    const recorder = new MediaRecorder(stream, {
      mimeType: H264,
      videoBitsPerSecond: 4_000_000,
    });
    recorder.ondataavailable = ({ data }) => {
      chunks.push(
        data.arrayBuffer().then((bytes) => buffer.push(new Uint8Array(bytes))),
      );
    };
    recorder.start(250);
    await new Promise((resolve) => setTimeout(resolve, PROBE_MS));
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.stop();
    await stopped;
    for (const chunk of chunks) await chunk;
  } finally {
    clearInterval(draw);
    stream.getTracks().forEach((track) => track.stop());
  }
  const fps = buffer.videoFrames() / (PROBE_MS / 1000);
  return fps >= MIN_HEALTHY_FPS && !buffer.failed ? H264 : fallback();
}
