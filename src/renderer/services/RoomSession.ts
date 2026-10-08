import type {
  Identity,
  RoomSnapshot,
  VoiceState,
} from '../../shared/schemas/room';
import type { Reaction, RoomEvent } from '../../shared/schemas/chat';
import { capturePreview } from './preview';
import type { Settings } from '../../shared/schemas/settings';
import { ChatController } from './ChatController';
import { ClipManager, SELF_CLIP } from './clips/ClipManager';
import type { ClipSource } from './clips/ClipManager';
import { pushToast } from './toasts';
import { PeerMesh } from './PeerMesh';
import type { PeerConnectionView } from './PeerMesh';
import { ScreenShare } from './ScreenShare';
import { playSound } from './sounds';
import { Store } from './store';
import { effectiveMuted, VoiceController } from './voice/VoiceController';

const PRESENCE_INTERVAL_MS = 250;

export interface LiveReaction {
  id: number;
  fromPeerId: string;
  targetPeerId: string;
  emoji: Reaction;
}

// Floating reactions disappear after their animation.
const REACTION_LIFETIME_MS = 2600;
const MAX_VISIBLE_REACTIONS = 40;
// Thumbnail refresh while streaming; the host also rate-limits previews.
const PREVIEW_INTERVAL_MS = 10_000;

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
  readonly clips: ClipManager;
  readonly reactions = new Store<readonly LiveReaction[]>([]);
  /** Latest stream thumbnail per streaming peer. */
  readonly previews = new Store<ReadonlyMap<string, string>>(new Map());
  private reactionId = 0;
  private previewTimer: ReturnType<typeof setInterval> | undefined;
  private readonly clippedAt = new Map<string, number>();
  private readonly peerMesh: PeerMesh;
  private readonly unsubscribe: (() => void)[] = [];
  private lastPresence: string | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPresenceAt = 0;
  private roster: RoomSnapshot['participants'] | null = null;
  private streamIds = new Map<string, string>();
  private wasInVoice = false;
  private closed = false;

  constructor(
    readonly roomId: string,
    readonly self: Identity,
    rtcEndpoint: { host: string; port: number },
    settings: Settings,
  ) {
    this.chat = new ChatController(roomId, self);
    this.clips = new ClipManager(
      settings.clips,
      (key) =>
        key === SELF_CLIP
          ? `${self.displayName} (minha transmissão)`
          : (this.nameOf(key) ?? 'Transmissão'),
      (key) => this.peerMesh.notifyClip(key),
    );
    this.voice = new VoiceController(self.peerId, settings, (track) =>
      this.peerMesh.setVoice(track, this.voice.connected),
    );
    this.peerMesh = new PeerMesh(
      roomId,
      self.peerId,
      rtcEndpoint,
      (peers, error) => this.meshChanged(peers, error),
      (peerId) => this.clippedByPeer(peerId),
    );
    this.unsubscribe.push(
      this.share.capture.subscribe(() => {
        const capture = this.share.capture.get();
        this.peerMesh.setCapture(capture);
        // Going live happens in the voice channel, as viewers expect.
        if (capture) this.ensureVoice();
        this.syncClips();
        this.syncPreview();
        this.syncPresence();
      }),
      this.voice.view.subscribe(() => {
        const inVoice = this.voice.connected;
        // Leaving voice leaves the call entirely: streams being watched and
        // the user's own share end with it.
        if (this.wasInVoice && !inVoice) {
          this.peerMesh.stopWatchingAll();
          if (this.share.state.get().status !== 'IDLE') this.share.stop();
        }
        this.wasInVoice = inVoice;
        this.syncPresence();
      }),
    );
    this.peerMesh.start();
    void this.chat.load();
  }

  handleRoomEvent(event: RoomEvent): void {
    if ('roomId' in event && event.roomId !== this.roomId) return;
    if (event.type === 'REACTION')
      this.showReaction(event.fromPeerId, event.targetPeerId, event.emoji);
    else if (event.type === 'PREVIEW') {
      const next = new Map(this.previews.get());
      if (event.image) next.set(event.peerId, event.image);
      else next.delete(event.peerId);
      this.previews.set(next);
    } else this.chat.handle(event);
  }

  /** Sends a reaction to a stream and shows it locally right away. */
  react(targetPeerId: string, emoji: Reaction): void {
    this.showReaction(this.self.peerId, targetPeerId, emoji);
    void window.pogLive
      .command({ type: 'REACT', targetPeerId, emoji })
      .catch(() => {});
  }

  kick(peerId: string): void {
    void window.pogLive.command({ type: 'KICK', peerId }).then((result) => {
      if (result.status === 'ERROR') pushToast(result.message, 'error');
    });
  }

  private showReaction(
    fromPeerId: string,
    targetPeerId: string,
    emoji: Reaction,
  ): void {
    const reaction = { id: ++this.reactionId, fromPeerId, targetPeerId, emoji };
    this.reactions.update((items) =>
      [...items, reaction].slice(-MAX_VISIBLE_REACTIONS),
    );
    setTimeout(() => {
      this.reactions.update((items) =>
        items.filter((item) => item.id !== reaction.id),
      );
    }, REACTION_LIFETIME_MS);
  }

  /**
   * While live, a small JPEG of the capture goes to the room every few
   * seconds so others can see what is on before they start watching.
   */
  private syncPreview(): void {
    const capture = this.share.capture.get();
    clearInterval(this.previewTimer);
    this.previewTimer = undefined;
    if (!capture) {
      void window.pogLive
        .command({ type: 'SET_PREVIEW', image: null })
        .catch(() => {});
      return;
    }
    const send = () => {
      void capturePreview(capture.stream).then((image) => {
        if (image && this.share.capture.get() === capture && !this.closed)
          void window.pogLive
            .command({ type: 'SET_PREVIEW', image })
            .catch(() => {});
      });
    };
    setTimeout(send, 1500);
    this.previewTimer = setInterval(send, PREVIEW_INTERVAL_MS);
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
    this.clips.setSettings(settings.clips);
  }

  /** Joins the voice channel if needed; watching and streaming happen there. */
  ensureVoice(): void {
    if (!this.voice.connected) void this.voice.join();
  }
  watch(peerId: string): void {
    this.ensureVoice();
    this.peerMesh.watch(peerId);
  }
  stopWatching(peerId: string): void {
    this.peerMesh.stopWatching(peerId);
  }
  reconnect(peerId: string): void {
    this.peerMesh.reconnect(peerId);
  }

  private nameOf(peerId: string): string | undefined {
    return (
      this.roster?.find((peer) => peer.peerId === peerId)?.displayName ??
      this.mesh.get().peers.find((peer) => peer.peerId === peerId)?.displayName
    );
  }

  /** Recorders follow the streams actually playing on this screen. */
  private syncClips(): void {
    const sources: ClipSource[] = [];
    for (const peer of this.mesh.get().peers)
      if (peer.watchState === 'WATCHING' && peer.media)
        sources.push({ key: peer.peerId, stream: peer.media });
    const own = this.share.capture.get();
    if (own) sources.push({ key: SELF_CLIP, stream: own.stream });
    this.clips.sync(sources);
  }

  private clippedByPeer(peerId: string): void {
    const now = Date.now();
    // One notice per viewer every 10 s, however often they clip.
    if (now - (this.clippedAt.get(peerId) ?? 0) < 10_000) return;
    this.clippedAt.set(peerId, now);
    pushToast(
      `${this.nameOf(peerId) ?? 'Alguém'} salvou um clipe da sua transmissão.`,
      'info',
    );
  }

  private meshChanged(peers: PeerConnectionView[], error: string | null): void {
    if (this.closed) return;
    this.mesh.set({ peers, error });
    // Thumbnails of streams that ended or of people who left are dropped.
    const previews = this.previews.get();
    const streaming = new Set(
      peers
        .filter((peer) => peer.presence.streaming)
        .map((peer) => peer.peerId),
    );
    if ([...previews.keys()].some((peerId) => !streaming.has(peerId)))
      this.previews.set(
        new Map([...previews].filter(([peerId]) => streaming.has(peerId))),
      );
    this.syncClips();
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

  /**
   * Throttles presence to at most one update per PRESENCE_INTERVAL_MS (well
   * under the host's rate), always delivering the latest state at the end.
   */
  private syncPresence(): void {
    if (this.closed || this.presenceTimer !== undefined) return;
    const wait = Math.max(
      0,
      this.lastPresenceAt + PRESENCE_INTERVAL_MS - Date.now(),
    );
    this.presenceTimer = setTimeout(
      () => {
        this.presenceTimer = undefined;
        this.lastPresenceAt = Date.now();
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
      },
      Math.max(wait, 30),
    );
  }

  close(): void {
    this.closed = true;
    clearInterval(this.previewTimer);
    clearTimeout(this.presenceTimer);
    for (const stop of this.unsubscribe) stop();
    this.clips.close();
    this.share.close();
    this.voice.close();
    this.chat.close();
    this.peerMesh.stop();
  }
}
