import type { Settings } from '../../../shared/schemas/settings';
import { rmsDb, VoiceGate } from './levels';

export type AudioSettings = Settings['audio'];

export interface MicrophoneSample {
  levelDb: number;
  gateOpen: boolean;
  thresholdDb: number;
}

export class MicrophoneError extends Error {
  constructor(
    readonly reason: 'DENIED' | 'NOT_FOUND' | 'BUSY' | 'FAILED',
    message: string,
  ) {
    super(message);
  }
}

function constraints(
  settings: AudioSettings,
  deviceId: string | null,
): MediaStreamConstraints {
  return {
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
      channelCount: 1,
      sampleRate: 48000,
    },
    video: false,
  };
}

async function openStream(settings: AudioSettings): Promise<{
  stream: MediaStream;
  usedFallback: boolean;
}> {
  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia(
        constraints(settings, settings.inputDeviceId),
      ),
      usedFallback: false,
    };
  } catch (error: unknown) {
    // A saved device may be unplugged: fall back to the system default.
    if (
      settings.inputDeviceId &&
      error instanceof DOMException &&
      (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')
    )
      return {
        stream: await navigator.mediaDevices.getUserMedia(
          constraints(settings, null),
        ),
        usedFallback: true,
      };
    throw error;
  }
}

/**
 * Microphone → input volume → voice gate → processed track sent to peers.
 * Chromium applies echo cancellation, noise suppression and AGC first.
 */
export class MicrophoneInput {
  private readonly gate = new VoiceGate();
  private readonly buffer: Float32Array<ArrayBuffer>;
  private muted = false;
  private closed = false;
  private constructor(
    private readonly context: AudioContext,
    private readonly raw: MediaStream,
    private readonly volume: GainNode,
    private readonly analyser: AnalyserNode,
    private readonly gateGain: GainNode,
    private readonly destination: MediaStreamAudioDestinationNode,
    private settings: AudioSettings,
    readonly usedFallback: boolean,
  ) {
    this.buffer = new Float32Array(analyser.fftSize);
  }
  static async open(settings: AudioSettings): Promise<MicrophoneInput> {
    let opened: { stream: MediaStream; usedFallback: boolean };
    try {
      opened = await openStream(settings);
    } catch (error: unknown) {
      const name = error instanceof DOMException ? error.name : '';
      throw name === 'NotAllowedError' || name === 'SecurityError'
        ? new MicrophoneError(
            'DENIED',
            'O acesso ao microfone foi negado pelo Windows. Libere em Configurações > Privacidade > Microfone.',
          )
        : name === 'NotFoundError' || name === 'OverconstrainedError'
          ? new MicrophoneError(
              'NOT_FOUND',
              'Nenhum microfone encontrado. Conecte um dispositivo de entrada.',
            )
          : name === 'NotReadableError'
            ? new MicrophoneError(
                'BUSY',
                'O microfone está em uso exclusivo por outro aplicativo.',
              )
            : new MicrophoneError(
                'FAILED',
                'Não foi possível abrir o microfone.',
              );
    }
    const context = new AudioContext({
      sampleRate: 48000,
      latencyHint: 'interactive',
    });
    try {
      const source = context.createMediaStreamSource(opened.stream);
      const volume = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0;
      const gateGain = context.createGain();
      gateGain.gain.value = 0;
      const destination = context.createMediaStreamDestination();
      source.connect(volume);
      volume.connect(analyser);
      volume.connect(gateGain);
      gateGain.connect(destination);
      if (context.state === 'suspended') await context.resume();
      const input = new MicrophoneInput(
        context,
        opened.stream,
        volume,
        analyser,
        gateGain,
        destination,
        settings,
        opened.usedFallback,
      );
      input.applyVolume();
      return input;
    } catch (error: unknown) {
      opened.stream.getTracks().forEach((track) => track.stop());
      void context.close();
      throw error;
    }
  }
  /** Shared by every PeerLink; replaced only when the device or DSP changes. */
  get track(): MediaStreamTrack {
    const track = this.destination.stream.getAudioTracks()[0];
    if (!track) throw new Error('Voice track unavailable');
    return track;
  }
  get deviceLabel(): string {
    return this.raw.getAudioTracks()[0]?.label ?? '';
  }
  /** Device and DSP flags need a new getUserMedia; volume and gate do not. */
  requiresRestart(next: AudioSettings): boolean {
    return (
      next.inputDeviceId !== this.settings.inputDeviceId ||
      next.echoCancellation !== this.settings.echoCancellation ||
      next.noiseSuppression !== this.settings.noiseSuppression ||
      next.autoGainControl !== this.settings.autoGainControl
    );
  }
  update(settings: AudioSettings): void {
    this.settings = settings;
    this.applyVolume();
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
    // Disabled tracks send silence frames, which Opus DTX reduces to almost nothing.
    for (const track of this.destination.stream.getAudioTracks())
      track.enabled = !muted;
    if (muted) {
      this.gate.reset();
      this.gateGain.gain.setTargetAtTime(0, this.context.currentTime, 0.01);
    }
  }
  get ended(): boolean {
    return this.raw
      .getAudioTracks()
      .every((track) => track.readyState !== 'live');
  }
  sample(now: number): MicrophoneSample {
    this.analyser.getFloatTimeDomainData(this.buffer);
    const levelDb = rmsDb(this.buffer);
    const open =
      !this.muted &&
      this.gate.update(levelDb, now, {
        automatic: this.settings.automaticSensitivity,
        thresholdDb: this.settings.sensitivityDb,
      });
    if (!this.muted)
      // Fast attack so the first syllable passes; slower release avoids clicks.
      this.gateGain.gain.setTargetAtTime(
        open ? 1 : 0,
        this.context.currentTime,
        open ? 0.004 : 0.06,
      );
    return {
      levelDb,
      gateOpen: open,
      thresholdDb: this.settings.automaticSensitivity
        ? this.gate.thresholdDb
        : this.settings.sensitivityDb,
    };
  }
  private applyVolume(): void {
    this.volume.gain.setTargetAtTime(
      this.settings.inputVolume / 100,
      this.context.currentTime,
      0.02,
    );
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.raw.getTracks().forEach((track) => track.stop());
    this.destination.stream.getTracks().forEach((track) => track.stop());
    void this.context.close().catch(() => {});
  }
}
