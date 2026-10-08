import type {
  Identity,
  RoomSnapshot,
  VoiceState,
} from '../../shared/schemas/room';
import type { RoomEvent } from '../../shared/schemas/chat';
import type { Settings } from '../../shared/schemas/settings';
import { ChatController } from './ChatController';
import { PeerMesh } from './PeerMesh';
import type { PeerConnectionView } from './PeerMesh';
import { ScreenShare } from './ScreenShare';
import { playSound } from './sounds';
import { Store } from './store';
import { effectiveMuted, VoiceController } from './voice/VoiceController';

export interface MeshView {
  peers: PeerConnectionView[];
  error: string | null;
}

/**
 * Everything that lives exactly as long as one room: peer links, voice,
 * screen share and chat. Created on entry, closed on exit.
 */
export class RoomSession {
  readonly mesh = new Store<MeshView>({ peers: [], error: null });
  readonly voice: VoiceController;
  readonly share = new ScreenShare();
  readonly chat: ChatController;
  private readonly peerMesh: PeerMesh;
  private readonly unsubscribe: (() => void)[] = [];
  private lastPresence: string | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | undefined;
  private roster: RoomSnapshot['participants'] | null = null;
  private streamIds = new Map<string, string>();
  private closed = false;

  constructor(
    readonly roomId: string,
    readonly self: Identity,
    rtcEndpoint: { host: string; port: number },
    settings: Settings,
  ) {
    this.chat = new ChatController(roomId, self);
    this.voice = new VoiceController(self.peerId, settings, (track) =>
      this.peerMesh.setVoice(track, this.voice.connected),
    );
    this.peerMesh = new PeerMesh(
      roomId,
      self.peerId,
      rtcEndpoint,
      (peers, error) => this.meshChanged(peers, error),
    );
    this.unsubscribe.push(
      this.share.capture.subscribe(() => {
        this.peerMesh.setCapture(this.share.capture.get());
        this.syncPresence();
      }),
      this.voice.view.subscribe(() => this.syncPresence()),
    );
    this.peerMesh.start();
    void this.chat.load();
  }

  handleRoomEvent(event: RoomEvent): void {
    this.chat.handle(event);
  }

  /** Roster from the authoritative room state, for join/leave notices. */
  setRoster(room: RoomSnapshot): void {
    const previous = this.roster;
    this.roster = room.participants;
    if (!previous) return;
    const before = new Map(previous.map((peer) => [peer.peerId, peer]));
    const after = new Map(room.participants.map((peer) => [peer.peerId, peer]));
    for (const [peerId, peer] of after) {
      if (peerId === this.self.peerId) continue;
      const old = before.get(peerId);
      if (!old) this.chat.addSystem(`${peer.displayName} entrou na sala.`);
      if (this.voice.connected && old?.voice.connected !== peer.voice.connected)
        void playSound(peer.voice.connected ? 'peerJoin' : 'peerLeave');
    }
    for (const [peerId, peer] of before)
      if (!after.has(peerId) && peerId !== this.self.peerId) {
        this.chat.addSystem(`${peer.displayName} saiu da sala.`);
        if (this.voice.connected && peer.voice.connected)
          void playSound('peerLeave');
      }
  }

  applySettings(settings: Settings): void {
    this.voice.applySettings(settings);
  }

  watch(peerId: string): void {
    this.peerMesh.watch(peerId);
  }
  stopWatching(peerId: string): void {
    this.peerMesh.stopWatching(peerId);
  }
  reconnect(peerId: string): void {
    this.peerMesh.reconnect(peerId);
  }

  private meshChanged(peers: PeerConnectionView[], error: string | null): void {
    if (this.closed) return;
    this.mesh.set({ peers, error });
    this.voice.setRemotes(
      peers.map((peer) => ({
        peerId: peer.peerId,
        track: peer.status === 'CONNECTED' ? peer.voiceTrack : null,
        inVoice: peer.presence.connected,
      })),
    );
    // Cue when someone in the room starts or ends a stream.
    const current = new Map<string, string>();
    for (const peer of peers)
      if (peer.streamId) current.set(peer.peerId, peer.streamId);
    let started = false;
    let stopped = false;
    for (const [peerId, streamId] of current) {
      const previous = this.streamIds.get(peerId);
      if (previous !== streamId) started = true;
      if (previous && previous !== streamId) stopped = true;
    }
    for (const peerId of this.streamIds.keys())
      if (!current.has(peerId)) stopped = true;
    this.streamIds = current;
    if (stopped) void playSound('streamStop');
    if (started) void playSound('streamStart');
  }

  private presence(): VoiceState {
    const view = this.voice.view.get();
    const connected = view.status !== 'DISCONNECTED';
    return {
      connected,
      muted: connected && effectiveMuted(view),
      deafened: connected && view.deafened,
      streaming: this.share.capture.get() !== null,
    };
  }

  /** Coalesces rapid toggles into one presence update for the host. */
  private syncPresence(): void {
    if (this.closed) return;
    clearTimeout(this.presenceTimer);
    this.presenceTimer = setTimeout(() => {
      const presence = this.presence();
      const key = JSON.stringify(presence);
      if (key === this.lastPresence || this.closed) return;
      this.lastPresence = key;
      void window.pogLive
        .command({ type: 'UPDATE_VOICE', voice: presence })
        .then((result) => {
          if (result.status === 'ERROR') this.lastPresence = null;
        })
        .catch(() => {
          this.lastPresence = null;
        });
    }, 60);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.presenceTimer);
    for (const stop of this.unsubscribe) stop();
    this.share.close();
    this.voice.close();
    this.chat.close();
    this.peerMesh.stop();
  }
}
