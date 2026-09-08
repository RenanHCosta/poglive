import type { Signal } from '../../shared/protocols/signaling';
import type { RoomSnapshot } from '../../shared/schemas/room';
import { PeerLink } from './PeerLink';
import type { LinkStatus } from './PeerLink';
import type { LocalStream, WatchState } from '../../shared/protocols/media';

export interface PeerConnectionView {
  peerId: string;
  displayName: string;
  status: LinkStatus | 'WAITING';
  streamId: string | null;
  media: MediaStream | null;
  watchState: WatchState;
  watchingLocal: boolean;
  diagnostic: string | null;
}
export class PeerMesh {
  private readonly links = new Map<string, PeerLink>();
  private room: RoomSnapshot | null = null;
  private stopped = false;
  private capture: LocalStream | null = null;
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
    // React StrictMode can mount/clean up immediately; don't drain IPC on that discarded mount.
    this.timer = setTimeout(() => {
      void this.poll();
    }, 0);
  }
  setCapture(stream: MediaStream | null): void {
    const track = stream?.getVideoTracks()[0];
    if (this.stopped || this.capture?.track === track) return;
    this.capture =
      track && track.readyState === 'live'
        ? {
            streamId: crypto.randomUUID(),
            track,
            audioTrack: stream?.getAudioTracks()[0] ?? null,
          }
        : null;
    for (const link of this.links.values()) link.media.setCapture(this.capture);
    console.info(this.capture ? '[Stream] Started' : '[Stream] Stopped');
  }
  watch(peerId: string): void {
    const target = this.links.get(peerId);
    if (target?.status !== 'CONNECTED') return;
    for (const link of this.links.values()) link.media.stopWatching();
    target.media.watch();
  }
  stopWatching(): void {
    for (const link of this.links.values()) link.media.stopWatching();
  }
  private publish(error: string | null = null): void {
    if (this.stopped) return;
    this.update(
      (this.room?.participants ?? [])
        .filter((peer) => peer.peerId !== this.selfId)
        .map((peer) => ({
          peerId: peer.peerId,
          displayName: peer.displayName,
          streamId: this.links.get(peer.peerId)?.media.remoteId ?? null,
          media: this.links.get(peer.peerId)?.media.remoteStream ?? null,
          watchState: this.links.get(peer.peerId)?.media.watchState ?? 'IDLE',
          watchingLocal:
            this.links.get(peer.peerId)?.media.watchingLocal ?? false,
          diagnostic:
            this.links.get(peer.peerId)?.diagnostic ??
            (!this.links.has(peer.peerId) &&
            Date.now() - (this.waitingSince.get(peer.peerId) ?? Date.now()) >
              30000
              ? 'NO_REMOTE_OFFER · A oferta do outro participante não chegou em 30 segundos.'
              : null),
          status:
            this.links.get(peer.peerId)?.status ??
            (Date.now() - (this.waitingSince.get(peer.peerId) ?? Date.now()) >
            30000
              ? 'ERROR'
              : 'WAITING'),
        })),
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
      () => this.publish(),
    );
    this.links.set(peerId, link);
    link.media.setCapture(this.capture);
    return link;
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
        }
      for (const id of members) {
        if (this.stopped) return;
        if (this.selfId < id && !this.links.has(id)) {
          const link = this.create(id, crypto.randomUUID());
          try {
            await link.offer();
          } catch {
            link.fail('OFFER_FAILED');
          }
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
    clearTimeout(this.timer);
    for (const link of this.links.values()) link.close();
    this.links.clear();
  }
}
