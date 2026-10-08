import type { Settings } from '../../../shared/schemas/settings';
import { playSound } from '../sounds';
import { Store } from '../store';
import { pushToast } from '../toasts';
import { ClipRecorder } from './ClipRecorder';

/** `self` is the user's own share; any other key is a streamer's peer ID. */
export const SELF_CLIP = 'self';

export interface ClipSource {
  key: string;
  stream: MediaStream;
}

export interface ClipView {
  /** Sources currently being buffered and therefore clippable. */
  available: ReadonlySet<string>;
  saving: boolean;
}

// Below this, a "clip" would be a fraction of a second of video.
const MIN_BUFFERED_MS = 2000;

/**
 * One rolling recorder per stream being watched (and the own share when
 * enabled). Saving cuts the last N seconds without interrupting recording.
 */
export class ClipManager {
  readonly view = new Store<ClipView>({ available: new Set(), saving: false });
  private readonly recorders = new Map<
    string,
    { stream: MediaStream; recorder: ClipRecorder }
  >();
  private target: string | null = null;
  private lastSources: ClipSource[] = [];

  constructor(
    private settings: Settings['clips'],
    private readonly label: (key: string) => string,
    private readonly notify: (key: string) => void,
  ) {}

  setSettings(settings: Settings['clips']): void {
    const restart = settings.durationSeconds !== this.settings.durationSeconds;
    this.settings = settings;
    if (restart) this.stopAll();
    this.sync(this.lastSources);
  }

  /** The stream the clip shortcut applies to, usually the focused one. */
  setTarget(key: string | null): void {
    this.target = key;
  }

  sync(sources: ClipSource[]): void {
    this.lastSources = sources;
    const wanted = new Map<string, MediaStream>();
    if (this.settings.enabled && ClipRecorder.supported())
      for (const source of sources)
        if (source.key !== SELF_CLIP || this.settings.recordOwnStream)
          wanted.set(source.key, source.stream);
    for (const [key, entry] of this.recorders)
      if (wanted.get(key) !== entry.stream) {
        entry.recorder.stop();
        this.recorders.delete(key);
      }
    for (const [key, stream] of wanted)
      if (!this.recorders.has(key)) {
        const recorder = new ClipRecorder(
          stream,
          this.settings.durationSeconds * 1000,
        );
        recorder.start();
        this.recorders.set(key, { stream, recorder });
      }
    this.publish();
  }

  private publish(): void {
    const available = new Set(this.recorders.keys());
    const current = this.view.get();
    if (
      available.size !== current.available.size ||
      [...available].some((key) => !current.available.has(key))
    )
      this.view.set({ ...current, available });
  }

  async save(requested?: string): Promise<void> {
    if (this.view.get().saving) return;
    if (!this.settings.enabled) {
      pushToast('Os clipes estão desativados nas configurações.', 'info');
      return;
    }
    const key =
      requested ??
      (this.target && this.recorders.has(this.target) ? this.target : null) ??
      [...this.recorders.keys()].find((item) => item !== SELF_CLIP) ??
      [...this.recorders.keys()][0];
    const entry = key ? this.recorders.get(key) : undefined;
    if (!key || !entry) {
      pushToast('Assista a uma transmissão para salvar um clipe.', 'info');
      return;
    }
    if (entry.recorder.failed) {
      pushToast(
        'A gravação desta transmissão falhou. Reabra a transmissão.',
        'error',
      );
      return;
    }
    if (entry.recorder.bufferedMs < MIN_BUFFERED_MS) {
      pushToast('Ainda não há vídeo suficiente para um clipe.', 'info');
      return;
    }
    this.view.set({ ...this.view.get(), saving: true });
    try {
      const bytes = await entry.recorder.clip(
        this.settings.durationSeconds * 1000,
      );
      if (!bytes) {
        pushToast('Ainda não há vídeo suficiente para um clipe.', 'info');
        return;
      }
      const result = await window.pogLive.saveClip(bytes, this.label(key));
      if (result.status === 'ERROR') {
        pushToast(result.message, 'error');
        return;
      }
      void playSound('clip');
      pushToast(`Clipe salvo: ${result.fileName}`, 'success', {
        label: 'Mostrar',
        run: () => void window.pogLive.revealClip(result.fileName),
      });
      if (key !== SELF_CLIP) this.notify(key);
    } catch {
      pushToast('Não foi possível salvar o clipe.', 'error');
    } finally {
      this.view.set({ ...this.view.get(), saving: false });
    }
  }

  private stopAll(): void {
    for (const entry of this.recorders.values()) entry.recorder.stop();
    this.recorders.clear();
  }

  close(): void {
    this.stopAll();
    this.publish();
  }
}
