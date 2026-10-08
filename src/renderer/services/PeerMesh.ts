import type { Signal } from '../../shared/protocols/signaling';
import type {
  Participant,
  RoomSnapshot,
  VoiceState,
} from '../../shared/schemas/room';
import { PeerLink } from './PeerLink';
import type { LinkStatus } from './PeerLink';
import type {
  LocalCapture,
  LocalStream,
  RemoteVideoQuality,
  WatchState,
} from '../../shared/protocols/media';

// Offerer-side retry after a failed link. Version mismatches never retry.
const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000];
const WAITING_TIMEOUT_MS = 30000;

export interface PeerConnectionView {
  peerId: string;
  displayName: string;
  role: Participant['role'];
  presence: VoiceState;
  status: LinkStatus | 'WAITING';
  streamId: string | null;
  media: MediaStream | null;
  voiceTrack: MediaStreamTrack | null;
  watchState: WatchState;
  quality: RemoteVideoQuality | null;
  watchingLocal: boolean;
  roundTripMs: number | null;
  diagnostic: string | null;
}

interface Retry {
  attempts: number;
  at: number;
}

export class PeerMesh {
  private readonly links = new Map<string, PeerLink>();
  private readonly retries = new Map<string, Retry>();
  private room: RoomSnapshot | null = null;
  private stopped = false;
  private capture: LocalStream | null = null;
  private voiceTrack: MediaStreamTrack | null = null;
  private voiceConnected = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private outbox = Promise.resolve();
  private readonly waitingSince = new Map<string, number>();
  constructor(
    private readonly roomId: string,
    private readonly selfId: string,
    private readonly rtcEndpoint: { host: string; port: number },
    private readonly update: (
      peers: PeerConnectionView[],
      error: string | null,
    ) => void,
  ) {}
  start(): void {
    this.timer = setTimeout(() => {
      void this.poll();
    }, 0);
  }
  setCapture(capture: LocalCapture | null): void {
    const track = capture?.stream.getVideoTracks()[0];
    if (this.stopped || this.capture?.track === track) return;
    this.capture =
      track && track.readyState === 'live'
        ? {
            streamId: crypto.randomUUID(),
            track,
            audioTrack: capture?.stream.getAudioTracks()[0] ?? null,
            options: capture.options,
          }
        : null;
    for (const link of this.links.values()) link.media.setCapture(this.capture);
    console.info(this.capture ? '[Stream] Started' : '[Stream] Stopped');
  }
  /** Voice flows only between members who are both in the voice channel. */
  setVoice(track: MediaStreamTrack | null, connected: boolean): void {
    if (this.stopped) return;
    this.voiceTrack = track;
    this.voiceConnected = connected;
    this.routeVoice();
  }
  watch(peerId: string): void {
    const target = this.links.get(peerId);
    if (target?.status !== 'CONNECTED') return;
    target.media.watch();
  }
  stopWatching(peerId: string): void {
    this.links.get(peerId)?.media.stopWatching();
  }
  /**
   * Manual retry from the UI, regardless of backoff. Only the offerer (lower
   * UUID) can renegotiate; the other side waits for its new offer.
   */
  reconnect(peerId: string): void {
    const link = this.links.get(peerId);
    if (!link || link.status !== 'ERROR') return;
    this.retries.set(peerId, {
      attempts: this.retries.get(peerId)?.attempts ?? 0,
      at: 0,
    });
  }
  private routeVoice(): void {
    const presence = new Map(
      (this.room?.participants ?? []).map((peer) => [
        peer.peerId,
        peer.voice.connected,
      ]),
    );
    for (const [peerId, link] of this.links)
      link.media.setVoice(
        this.voiceTrack,
        this.voiceConnected && presence.get(peerId) === true,
      );
  }
  private publish(error: string | null = null): void {
    if (this.stopped) return;
    const now = Date.now();
    this.update(
      (this.room?.participants ?? [])
        .filter((peer) => peer.peerId !== this.selfId)
        .map((peer) => {
          const link = this.links.get(peer.peerId);
          const waited =
            now - (this.waitingSince.get(peer.peerId) ?? now) >
            WAITING_TIMEOUT_MS;
          return {
            peerId: peer.peerId,
            displayName: peer.displayName,
            role: peer.role,
            presence: peer.voice,
            streamId: link?.media.remoteId ?? null,
            media: link?.media.remoteStream ?? null,
            voiceTrack: link?.media.remoteVoice ?? null,
            watchState: link?.media.watchState ?? 'IDLE',
            quality: link?.media.remoteQuality ?? null,
            watchingLocal: link?.media.watchingLocal ?? false,
            roundTripMs:
              link?.status === 'CONNECTED' ? link.media.roundTripMs : null,
            diagnostic:
              link?.diagnostic ??
              (!link && waited
                ? 'NO_REMOTE_OFFER · A oferta do outro participante não chegou em 30 segundos.'
                : null),
            status: link?.status ?? (waited ? 'ERROR' : 'WAITING'),
          };
        }),
      error,
    );
  }
  private send = (signal: Signal): Promise<void> => {
    const task = this.outbox.then(async () => {
      if (
        this.stopped ||
        this.links.get(signal.toPeerId)?.negotiationId !== signal.negotiationId
      )
        return;
      const result = await window.pogLive.sendSignal(signal);
      if (result.status !== 'OK') throw new Error('Signal delivery failed');
      await new Promise((resolve) => setTimeout(resolve, 35));
    });
    this.outbox = task.catch(() => {});
    return task;
  };
  private create(peerId: string, negotiationId: string): PeerLink {
    this.links.get(peerId)?.close();
    const link = new PeerLink(
      peerId,
      negotiationId,
      this.roomId,
      this.selfId,
      this.rtcEndpoint,
      this.send,
      () => this.changed(peerId, link),
    );
    this.links.set(peerId, link);
    link.media.setCapture(this.capture);
    this.routeVoice();
    return link;
  }
  private changed(peerId: string, link: PeerLink): void {
    if (this.links.get(peerId) !== link) return;
    if (link.status === 'CONNECTED') this.retries.delete(peerId);
    else if (
      link.status === 'ERROR' &&
      this.selfId < peerId &&
      !link.diagnostic?.startsWith('INCOMPATIBLE_VERSION') &&
      !this.retries.has(peerId)
    ) {
      const attempts = 0;
      this.retries.set(peerId, {
        attempts,
        at: Date.now() + (RETRY_DELAYS_MS[attempts] ?? 30000),
      });
    }
    this.publish();
  }
  private async poll(): Promise<void> {
    try {
      const batch = await window.pogLive.pollSignals(this.roomId);
      if (this.stopped) return;
      if (!batch.room) {
        this.publish('A sessão de conexão foi encerrada.');
        this.stop();
        return;
      }
      this.room = batch.room;
      const members = new Set(
        batch.room.participants.map((peer) => peer.peerId),
      );
      for (const id of members)
        if (!this.waitingSince.has(id)) this.waitingSince.set(id, Date.now());
      for (const id of this.waitingSince.keys())
        if (!members.has(id)) this.waitingSince.delete(id);
      for (const [id, link] of this.links)
        if (!members.has(id)) {
          link.close();
          this.links.delete(id);
          this.retries.delete(id);
        }
      for (const id of members) {
        if (this.stopped) return;
        if (this.selfId >= id) continue;
        const existing = this.links.get(id);
        const retry = this.retries.get(id);
        const due =
          existing?.status === 'ERROR' && retry && Date.now() >= retry.at;
        if (existing && !due) continue;
        if (due && retry) {
          const attempts = retry.attempts + 1;
          this.retries.set(id, {
            attempts,
            at: Date.now() + (RETRY_DELAYS_MS[attempts] ?? 30000),
          });
          console.info('[WebRTC] Retrying link');
        }
        const link = this.create(id, crypto.randomUUID());
        try {
          await link.offer();
        } catch {
          link.fail('OFFER_FAILED');
        }
      }
      for (const signal of batch.signals) {
        if (this.stopped) return;
        if (
          signal.roomId !== this.roomId ||
          signal.toPeerId !== this.selfId ||
          !members.has(signal.fromPeerId)
        )
          continue;
        let link = this.links.get(signal.fromPeerId);
        if (signal.type === 'WEBRTC_OFFER') {
          if (
            signal.fromPeerId >= this.selfId ||
            link?.negotiationId === signal.negotiationId
          )
            continue;
          link = this.create(signal.fromPeerId, signal.negotiationId);
        }
        try {
          await link?.receive(signal);
        } catch {
          link?.fail(
            signal.type === 'ICE_CANDIDATE'
              ? 'REMOTE_ICE_FAILED'
              : 'SDP_EXCHANGE_FAILED',
          );
        }
      }
      this.routeVoice();
      this.publish();
    } catch {
      this.publish(
        'Falha na troca de conexão. Saia da sala e entre novamente.',
      );
      this.stop();
    }
    if (!this.stopped)
      this.timer = setTimeout(() => {
        void this.poll();
      }, 250);
  }
  stop(): void {
    this.stopped = true;
    this.capture = null;
    this.voiceTrack = null;
    clearTimeout(this.timer);
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.retries.clear();
  }
}
