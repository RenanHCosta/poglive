import { WebmClipBuffer } from './webm';

const TIMESLICE_MS = 500;
// Extra media kept beyond the clip length so a keyframe before the window is
// always available.
const RETAIN_MARGIN_MS = 8000;
const VIDEO_BITS_PER_SECOND = 8_000_000;

const MIME_TYPES = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];

type RecorderOptions = MediaRecorderOptions & {
  // Chromium extension: forces regular keyframes so cuts stay close.
  videoKeyFrameIntervalDuration?: number;
};

/**
 * Keeps the last moments of a stream in memory, re-encoded once locally, so
 * a viewer can save a clip of something that already happened.
 */
export class ClipRecorder {
  private readonly buffer: WebmClipBuffer;
  private recorder: MediaRecorder | null = null;
  private chain = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly stream: MediaStream,
    durationMs: number,
  ) {
    this.buffer = new WebmClipBuffer(durationMs + RETAIN_MARGIN_MS);
  }

  static supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && !!ClipRecorder.mimeType();
  }

  private static mimeType(): string | null {
    return (
      MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
    );
  }

  start(): void {
    const mimeType = ClipRecorder.mimeType();
    if (!mimeType || this.stopped) return;
    const live = this.stream
      .getTracks()
      .filter((track) => track.readyState === 'live');
    if (!live.some((track) => track.kind === 'video')) return;
    const options: RecorderOptions = {
      mimeType,
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      audioBitsPerSecond: 128_000,
      videoKeyFrameIntervalDuration: 2000,
    };
    const recorder = new MediaRecorder(new MediaStream(live), options);
    recorder.ondataavailable = ({ data }) => {
      if (!data.size || this.stopped) return;
      // Chunks must be parsed in order; arrayBuffer() is asynchronous.
      this.chain = this.chain.then(async () => {
        if (!this.stopped)
          this.buffer.push(new Uint8Array(await data.arrayBuffer()));
      });
    };
    recorder.onerror = () => this.stop();
    recorder.start(TIMESLICE_MS);
    this.recorder = recorder;
  }

  get bufferedMs(): number {
    return this.buffer.bufferedMs();
  }

  get failed(): boolean {
    return this.buffer.failed;
  }

  /** Waits for in-flight chunks, then cuts the last `durationMs`. */
  async clip(durationMs: number): Promise<Uint8Array | null> {
    if (this.recorder?.state === 'recording') this.recorder.requestData();
    // requestData delivers asynchronously; give it a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 120));
    await this.chain;
    return this.buffer.clip(durationMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.recorder && this.recorder.state !== 'inactive')
      this.recorder.stop();
    this.recorder = null;
  }
}
