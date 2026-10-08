import { clipMimeType } from './codecProbe';
import { WebmClipBuffer } from './webm';

const TIMESLICE_MS = 500;
// Extra media kept beyond the clip length so a keyframe before the window is
// always available.
const RETAIN_MARGIN_MS = 8000;
const VIDEO_BITS_PER_SECOND = 6_000_000;

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
    return typeof MediaRecorder !== 'undefined';
  }

  /** Starts once the codec for this machine is known (see codecProbe). */
  start(): void {
    void clipMimeType().then((mimeType) => {
      if (mimeType) this.begin(mimeType);
    });
  }

  private begin(mimeType: string): void {
    if (this.stopped) return;
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
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(new MediaStream(live), options);
    } catch {
      // The preferred encoder can be unavailable on some GPUs/drivers.
      recorder = new MediaRecorder(new MediaStream(live), {
        ...options,
        mimeType: 'video/webm;codecs=vp8,opus',
      });
    }
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
