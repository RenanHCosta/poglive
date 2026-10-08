import type { Settings } from '../../../shared/schemas/settings';
import { playSound } from '../sounds';
import { sameSet, Store } from '../store';
import { MicrophoneError, MicrophoneInput } from './MicrophoneInput';
import { VoicePlayback } from './VoicePlayback';
import { voicePrefs } from './prefs';

const TICK_MS = 40;

export type VoiceStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export interface VoiceView {
  status: VoiceStatus;
  /** User's own mute choice; deafen forces mute without overwriting it. */
  selfMuted: boolean;
  deafened: boolean;
  /** No usable microphone: connected in listen-only mode. */
  micUnavailable: boolean;
  error: string | null;
}

export interface RemoteVoiceSource {
  peerId: string;
  track: MediaStreamTrack | null;
  inVoice: boolean;
}

/** Stand-ins for components rendered without a room session. */
export const IDLE_VOICE_VIEW = new Store<VoiceView>({
  status: 'DISCONNECTED',
  selfMuted: false,
  deafened: false,
  micUnavailable: false,
  error: null,
});
export const IDLE_SPEAKING = new Store<ReadonlySet<string>>(new Set());

export function effectiveMuted(view: VoiceView): boolean {
  return view.selfMuted || view.deafened || view.micUnavailable;
}

/**
 * Local side of the voice channel: microphone pipeline, remote mix, mute and
 * deafen, and speaking indicators. Network routing is PeerMesh's job; this
 * class only hands it the processed track.
 */
export class VoiceController {
  readonly view = new Store<VoiceView>({
    status: 'DISCONNECTED',
    ...voicePrefs.get(),
    micUnavailable: false,
    error: null,
  });
  readonly speaking = new Store<ReadonlySet<string>>(new Set());
  private mic: MicrophoneInput | null = null;
  private playback: VoicePlayback | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private remotes: RemoteVoiceSource[] = [];
  private generation = 0;
  private restarting: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly selfId: string,
    private settings: Settings,
    private readonly publishTrack: (track: MediaStreamTrack | null) => void,
  ) {}

  get connected(): boolean {
    return this.view.get().status !== 'DISCONNECTED';
  }

  async join(): Promise<void> {
    if (this.closed || this.connected) return;
    const generation = ++this.generation;
    this.view.update((view) => ({
      ...view,
      status: 'CONNECTING',
      error: null,
    }));
    this.playback = new VoicePlayback();
    void this.playback.resume();
    void this.playback.setSink(this.settings.audio.outputDeviceId);
    this.applyOutput();
    let micError: string | null = null;
    let mic: MicrophoneInput | null = null;
    try {
      mic = await MicrophoneInput.open(this.settings.audio);
    } catch (error: unknown) {
      micError =
        error instanceof MicrophoneError
          ? error.message
          : 'Não foi possível abrir o microfone.';
    }
    // A leave (and maybe another join) happened meanwhile: never touch the
    // microphone that a newer join owns.
    if (generation !== this.generation || this.closed) {
      mic?.close();
      return;
    }
    this.mic = mic;
    this.view.update((view) => ({
      ...view,
      status: 'CONNECTED',
      micUnavailable: !this.mic,
      error:
        micError ??
        (this.mic?.usedFallback
          ? 'O microfone escolhido não está disponível. Usando o padrão do sistema.'
          : null),
    }));
    this.applyMute();
    this.publishTrack(this.mic?.track ?? null);
    this.syncRemotes();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    void playSound('voiceJoin');
  }

  leave(): void {
    if (!this.connected) return;
    this.generation++;
    clearInterval(this.timer);
    this.publishTrack(null);
    this.mic?.close();
    this.mic = null;
    this.playback?.close();
    this.playback = null;
    this.speaking.set(new Set());
    this.view.update((view) => ({
      ...view,
      status: 'DISCONNECTED',
      micUnavailable: false,
      error: null,
    }));
    void playSound('voiceLeave');
  }

  toggleMute(): void {
    const view = this.view.get();
    if (view.deafened) {
      // Unmuting while deafened also undeafens, as users expect.
      this.view.set({ ...view, deafened: false, selfMuted: false });
      void playSound('unmute');
    } else {
      this.view.set({ ...view, selfMuted: !view.selfMuted });
      void playSound(view.selfMuted ? 'unmute' : 'mute');
    }
    this.applyMute();
    this.applyOutput();
    this.savePrefs();
  }

  private savePrefs(): void {
    const { selfMuted, deafened } = this.view.get();
    voicePrefs.set({ selfMuted, deafened });
  }

  toggleDeafen(): void {
    const view = this.view.get();
    this.view.set({ ...view, deafened: !view.deafened });
    void playSound(view.deafened ? 'undeafen' : 'deafen');
    this.applyMute();
    this.applyOutput();
    this.savePrefs();
  }

  /** Retries the microphone after a listen-only join (e.g. device plugged in). */
  async retryMicrophone(): Promise<void> {
    if (this.view.get().status !== 'CONNECTED' || this.mic) return;
    await this.restartMicrophone();
  }

  applySettings(settings: Settings): void {
    const previous = this.settings;
    this.settings = settings;
    if (!this.connected) return;
    if (previous.audio.outputDeviceId !== settings.audio.outputDeviceId)
      void this.playback?.setSink(settings.audio.outputDeviceId);
    this.applyOutput();
    if (this.mic?.requiresRestart(settings.audio))
      void this.restartMicrophone();
    else this.mic?.update(settings.audio);
  }

  /** Called whenever links or presence change. */
  setRemotes(remotes: RemoteVoiceSource[]): void {
    this.remotes = remotes;
    this.syncRemotes();
  }

  private syncRemotes(): void {
    const playback = this.playback;
    if (!playback || this.view.get().status !== 'CONNECTED') return;
    const wanted = new Set<string>();
    for (const remote of this.remotes) {
      if (
        !remote.inVoice ||
        !remote.track ||
        remote.track.readyState !== 'live'
      )
        continue;
      wanted.add(remote.peerId);
      playback.attach(
        remote.peerId,
        remote.track,
        this.peerOutput(remote.peerId),
      );
    }
    for (const peerId of playback.peerIds())
      if (!wanted.has(peerId)) playback.detach(peerId);
  }

  private peerOutput(peerId: string) {
    return this.settings.peers[peerId] ?? { volume: 100, muted: false };
  }

  private applyOutput(): void {
    const playback = this.playback;
    if (!playback) return;
    playback.setOutput(
      this.settings.audio.outputVolume,
      this.view.get().deafened,
    );
    for (const peerId of playback.peerIds())
      playback.setPeerOutput(peerId, this.peerOutput(peerId));
  }

  private applyMute(): void {
    this.mic?.setMuted(effectiveMuted(this.view.get()));
  }

  private async restartMicrophone(): Promise<void> {
    if (this.restarting) return this.restarting;
    const generation = this.generation;
    this.restarting = (async () => {
      let next: MicrophoneInput | null = null;
      let error: string | null = null;
      try {
        next = await MicrophoneInput.open(this.settings.audio);
      } catch (cause: unknown) {
        error =
          cause instanceof MicrophoneError
            ? cause.message
            : 'Não foi possível abrir o microfone.';
      }
      if (generation !== this.generation || this.closed) {
        next?.close();
        return;
      }
      const previous = this.mic;
      this.mic = next;
      // Peers switch to the new track before the old graph is torn down.
      this.publishTrack(next?.track ?? null);
      previous?.close();
      this.view.update((view) => ({
        ...view,
        micUnavailable: !next,
        error:
          error ??
          (next?.usedFallback
            ? 'O microfone escolhido não está disponível. Usando o padrão do sistema.'
            : null),
      }));
      this.applyMute();
    })().finally(() => {
      this.restarting = null;
    });
    return this.restarting;
  }

  private tick(): void {
    const now = performance.now();
    const speaking = new Set<string>();
    if (this.mic) {
      if (this.mic.ended && !this.restarting) {
        // Device unplugged: try the default device once.
        void this.restartMicrophone();
      } else {
        const sample = this.mic.sample(now);
        if (sample.gateOpen && !effectiveMuted(this.view.get()))
          speaking.add(this.selfId);
      }
    }
    if (this.playback && !this.view.get().deafened)
      for (const peerId of this.playback.sample(now)) speaking.add(peerId);
    if (!sameSet(speaking, this.speaking.get())) this.speaking.set(speaking);
  }

  close(): void {
    this.closed = true;
    this.generation++;
    clearInterval(this.timer);
    this.publishTrack(null);
    this.mic?.close();
    this.mic = null;
    this.playback?.close();
    this.playback = null;
  }
}
