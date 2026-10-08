import { rmsDb, SpeakingDetector } from './levels';

type SinkContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

interface RemoteVoice {
  track: MediaStreamTrack;
  // Chromium only feeds remote WebRTC audio into Web Audio while the stream
  // is also attached to a media element, so a muted element keeps it flowing.
  keepAlive: HTMLAudioElement;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
  detector: SpeakingDetector;
}

export interface PeerOutput {
  volume: number;
  muted: boolean;
}

/** Mixes remote voices with per-person volume, deafen and output device. */
export class VoicePlayback {
  private readonly context: SinkContext = new AudioContext({
    latencyHint: 'interactive',
  });
  private readonly master: GainNode;
  private readonly peers = new Map<string, RemoteVoice>();
  private readonly buffer = new Float32Array(512);
  private deafened = false;
  private outputVolume = 100;
  private sinkId = '';
  constructor() {
    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
  }
  async resume(): Promise<void> {
    if (this.context.state === 'suspended') await this.context.resume();
  }
  attach(peerId: string, track: MediaStreamTrack, output: PeerOutput): void {
    const current = this.peers.get(peerId);
    if (current?.track === track) {
      this.setPeerOutput(peerId, output);
      return;
    }
    this.detach(peerId);
    const stream = new MediaStream([track]);
    const keepAlive = new Audio();
    keepAlive.muted = true;
    keepAlive.srcObject = stream;
    void keepAlive.play().catch(() => {});
    const source = this.context.createMediaStreamSource(stream);
    const gain = this.context.createGain();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    source.connect(gain);
    gain.connect(this.master);
    this.peers.set(peerId, {
      track,
      keepAlive,
      source,
      gain,
      analyser,
      detector: new SpeakingDetector(),
    });
    this.setPeerOutput(peerId, output);
  }
  detach(peerId: string): void {
    const voice = this.peers.get(peerId);
    if (!voice) return;
    this.peers.delete(peerId);
    voice.source.disconnect();
    voice.gain.disconnect();
    voice.keepAlive.pause();
    voice.keepAlive.srcObject = null;
  }
  has(peerId: string): boolean {
    return this.peers.has(peerId);
  }
  peerIds(): string[] {
    return [...this.peers.keys()];
  }
  setPeerOutput(peerId: string, output: PeerOutput): void {
    const voice = this.peers.get(peerId);
    if (!voice) return;
    voice.gain.gain.setTargetAtTime(
      output.muted ? 0 : output.volume / 100,
      this.context.currentTime,
      0.02,
    );
  }
  setOutput(volume: number, deafened: boolean): void {
    this.outputVolume = volume;
    this.deafened = deafened;
    this.master.gain.setTargetAtTime(
      deafened ? 0 : volume / 100,
      this.context.currentTime,
      0.02,
    );
  }
  get muted(): boolean {
    return this.deafened || this.outputVolume === 0;
  }
  async setSink(deviceId: string | null): Promise<boolean> {
    const next = deviceId ?? '';
    if (next === this.sinkId) return true;
    if (!this.context.setSinkId) return false;
    try {
      await this.context.setSinkId(next);
      this.sinkId = next;
      return true;
    } catch {
      return false;
    }
  }
  /** Returns the peers currently speaking, measured before per-user volume. */
  sample(now: number): Set<string> {
    const speaking = new Set<string>();
    for (const [peerId, voice] of this.peers) {
      voice.analyser.getFloatTimeDomainData(this.buffer);
      if (voice.detector.update(rmsDb(this.buffer), now)) speaking.add(peerId);
    }
    return speaking;
  }
  close(): void {
    for (const peerId of [...this.peers.keys()]) this.detach(peerId);
    void this.context.close().catch(() => {});
  }
}
