import { CAPTURE_PROFILES } from '../../shared/schemas/capture';
import type {
  CaptureOptions,
  CaptureSource,
} from '../../shared/schemas/capture';
import type { LocalCapture } from '../../shared/protocols/media';
import { startProcessAudio, stopProcessAudio } from './ProcessAudioTrack';
import { Store } from './store';

export type ShareState =
  | { status: 'IDLE' }
  | { status: 'LOADING' }
  | { status: 'SELECTING_SOURCE'; sources: CaptureSource[] }
  | { status: 'STARTING' }
  | {
      status: 'LIVE';
      stream: MediaStream;
      source: CaptureSource;
      settings: string;
      options: CaptureOptions;
      warning: string | null;
    }
  | { status: 'ERROR'; message: string };

function release(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
}

/**
 * Owns the local screen capture for one room session. Every async step checks
 * a generation counter so a cancelled or superseded request never leaks tracks.
 */
export class ScreenShare {
  readonly state = new Store<ShareState>({ status: 'IDLE' });
  readonly capture = new Store<LocalCapture | null>(null);
  private stream: MediaStream | null = null;
  private live: Extract<ShareState, { status: 'LIVE' }> | null = null;
  private generation = 0;
  private locked = false;
  private closed = false;

  async list(): Promise<void> {
    if (this.locked || this.closed) return;
    this.locked = true;
    const current = ++this.generation;
    this.state.set({ status: 'LOADING' });
    try {
      const result = await window.pogLive.captureSources();
      if (this.generation !== current) return;
      this.state.set(
        result.status === 'OK'
          ? { status: 'SELECTING_SOURCE', sources: result.sources }
          : result,
      );
    } catch {
      if (this.generation === current)
        this.state.set({
          status: 'ERROR',
          message: 'Não foi possível carregar as fontes de captura.',
        });
    } finally {
      if (this.generation === current) this.locked = false;
    }
  }

  async start(source: CaptureSource, options: CaptureOptions): Promise<void> {
    if (this.locked || this.closed) return;
    this.locked = true;
    const current = ++this.generation;
    const previous = this.stream;
    this.state.set({ status: 'STARTING' });
    try {
      const result = await window.pogLive.captureSelect(source.id, options);
      if (this.generation !== current) return;
      if (result.status === 'ERROR') {
        this.fail(result.message);
        return;
      }
      const profile = CAPTURE_PROFILES[options.quality];
      // Native captures the source's own size: resizeMode 'none' alone
      // (adding width/height limits makes Chromium upscale to them). Larger
      // than 4K sources are scaled down by the encoder instead.
      const constraints =
        options.quality === 'native'
          ? {
              resizeMode: 'none',
              frameRate: { ideal: options.frameRate, max: options.frameRate },
            }
          : {
              width: { ideal: profile.width, max: profile.width },
              height: { ideal: profile.height, max: profile.height },
              frameRate: { ideal: options.frameRate, max: options.frameRate },
            };
      const media = await navigator.mediaDevices.getDisplayMedia({
        video: constraints,
        audio: false,
      });
      if (this.generation !== current) {
        release(media);
        return;
      }
      // Switching sources replaces the old capture only once the new one works.
      if (previous) {
        release(previous);
        await stopProcessAudio();
      }
      this.stream = media;
      this.live = null;
      // Audio is optional: a failure keeps the video share running with a warning.
      let warning: string | null = null;
      if (options.audioMode !== 'NONE') {
        try {
          if (options.audioMode === 'WINDOW' && source.kind !== 'window')
            throw new Error('Window audio requires a window source');
          const audio = await startProcessAudio(
            options.audioMode === 'WINDOW'
              ? { mode: 'WINDOW', sourceId: source.id }
              : { mode: 'SYSTEM' },
          );
          if (this.generation !== current) {
            audio.stop();
            await this.abandon(media);
            return;
          }
          media.addTrack(audio);
        } catch {
          warning =
            'Não foi possível capturar o áudio (requer Windows 10 build 20348 ou mais recente). A transmissão segue somente com vídeo.';
        }
      }
      const track = media.getVideoTracks()[0];
      if (!track || track.readyState === 'ended')
        throw new Error('Source ended');
      // Screen text stays legible when bandwidth drops; games keep motion.
      track.contentHint = options.frameRate === 60 ? 'motion' : 'detail';
      await track.applyConstraints(constraints);
      if (this.generation !== current) {
        await this.abandon(media);
        return;
      }
      if (track.readyState !== 'live')
        throw new Error('Source ended during configuration');
      track.onended = () => {
        if (this.generation !== current) return;
        this.stop();
        this.state.set({
          status: 'ERROR',
          message:
            'A transmissão terminou porque a janela ou tela foi fechada.',
        });
      };
      const settings = track.getSettings();
      const live: Extract<ShareState, { status: 'LIVE' }> = {
        status: 'LIVE',
        stream: media,
        source,
        settings: `${settings.width ?? '?'}×${settings.height ?? '?'} · ${settings.frameRate === undefined ? '?' : Math.round(settings.frameRate)} FPS`,
        options,
        warning,
      };
      const audio = media.getAudioTracks()[0];
      if (audio)
        audio.onended = () => {
          if (this.stream !== media || !this.live) return;
          this.live = {
            ...this.live,
            warning:
              'O áudio da transmissão foi interrompido. Reinicie a transmissão para tentar novamente.',
          };
          if (this.state.get().status === 'LIVE') this.state.set(this.live);
        };
      this.live = live;
      this.state.set(live);
      this.capture.set({ stream: media, options });
    } catch (error: unknown) {
      if (this.generation !== current) return;
      const denied =
        error instanceof DOMException && error.name === 'NotAllowedError';
      const message = denied
        ? 'Captura não autorizada ou seleção expirada. Selecione a fonte novamente.'
        : 'Não foi possível iniciar a transmissão. Tente outra fonte ou qualidade.';
      if (this.stream !== previous) {
        // The new capture was already swapped in: nothing usable remains.
        release(this.stream);
        this.stream = null;
        this.live = null;
        this.capture.set(null);
        await stopProcessAudio();
      }
      this.fail(message);
    } finally {
      if (this.generation === current) {
        this.locked = false;
        void window.pogLive.captureCancel().catch(() => {});
      }
    }
  }

  /**
   * A superseded start (cancelled or replaced) after the swap: the previous
   * capture is already gone, so tear down everything this attempt created,
   * including the process-audio helper, unless a newer attempt owns it.
   */
  private async abandon(media: MediaStream): Promise<void> {
    release(media);
    if (this.stream !== media) return;
    this.stream = null;
    this.live = null;
    this.capture.set(null);
    await stopProcessAudio();
  }

  /** A failed switch keeps the running share and surfaces the error on it. */
  private fail(message: string): void {
    if (this.live && this.stream?.getVideoTracks()[0]?.readyState === 'live') {
      this.live = { ...this.live, warning: message };
      this.state.set(this.live);
    } else this.state.set({ status: 'ERROR', message });
  }

  /** Leaves the source picker without touching a running share. */
  cancelSelection(): void {
    this.generation++;
    this.locked = false;
    void window.pogLive.captureCancel().catch(() => {});
    if (this.live && this.stream) this.state.set(this.live);
    else this.state.set({ status: 'IDLE' });
  }

  stop(): void {
    this.generation++;
    this.locked = false;
    release(this.stream);
    this.stream = null;
    this.live = null;
    this.capture.set(null);
    void stopProcessAudio();
    void window.pogLive.captureCancel().catch(() => {});
    this.state.set({ status: 'IDLE' });
  }

  close(): void {
    this.stop();
    this.closed = true;
  }
}
