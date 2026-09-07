import type {
  LocalStream,
  MediaMessage,
  WatchState,
} from '../../shared/protocols/media';
import { configureSender } from './mediaSender';

/** One pre-negotiated video sender per peer; capture ownership stays in useCapture. */
export class PeerMedia {
  remoteId: string | null = null;
  remoteStream: MediaStream | null = null;
  watchState: WatchState = 'IDLE';
  private local: LocalStream | null = null;
  private subscribedId: string | null = null;
  private ready = false;
  private closed = false;
  private accepted = false;
  private updates = Promise.resolve();
  private pendingUpdates = 0;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly send: (message: MediaMessage) => void,
    private readonly changed: () => void,
    private readonly fail: () => void,
  ) {
    pc.ontrack = ({ track }) => {
      if (this.closed) return;
      if (
        !['video', 'audio'].includes(track.kind) ||
        this.remoteStream?.getTracks().some((item) => item.kind === track.kind)
      ) {
        this.fail();
        return;
      }
      this.remoteStream ??= new MediaStream();
      this.remoteStream.addTrack(track);
      track.onunmute = () => this.checkReceiving();
      track.onended = () => {
        if (track.kind === 'video' && this.watchState !== 'IDLE')
          this.watchState = 'ERROR';
        this.changed();
      };
      this.checkReceiving();
    };
  }
  connected(): void {
    if (this.ready || this.closed) return;
    this.ready = true;
    if (this.local)
      this.send({
        version: 1,
        type: 'STREAM_STARTED',
        streamId: this.local.streamId,
      });
  }
  setCapture(local: LocalStream | null): void {
    if (this.closed || this.local?.streamId === local?.streamId) return;
    const previous = this.local;
    this.local = local;
    this.subscribedId = null;
    this.updateSender();
    if (!this.ready) return;
    if (previous)
      this.send({
        version: 1,
        type: 'STREAM_STOPPED',
        streamId: previous.streamId,
      });
    if (local)
      this.send({
        version: 1,
        type: 'STREAM_STARTED',
        streamId: local.streamId,
      });
  }
  receive(message: MediaMessage): void {
    if (this.closed) return;
    switch (message.type) {
      case 'STREAM_STARTED':
        if (message.streamId === this.remoteId) return;
        this.stopWatching();
        this.remoteId = message.streamId;
        break;
      case 'STREAM_STOPPED':
        if (message.streamId !== this.remoteId) return;
        this.stopWatching();
        this.remoteId = null;
        break;
      case 'WATCH_REQUEST':
        if (message.streamId !== this.local?.streamId) return;
        this.subscribedId = message.streamId;
        this.updateSender();
        break;
      case 'WATCH_STOP':
        if (message.streamId !== this.subscribedId) return;
        this.subscribedId = null;
        this.updateSender();
        break;
      case 'WATCH_ACCEPTED':
        if (
          message.streamId !== this.remoteId ||
          this.watchState !== 'CONNECTING'
        )
          return;
        this.accepted = true;
        this.checkReceiving();
        break;
    }
    this.changed();
  }
  watch(): void {
    if (!this.ready || !this.remoteId || this.closed) return;
    this.stopWatching();
    this.watchState = 'CONNECTING';
    this.send({ version: 1, type: 'WATCH_REQUEST', streamId: this.remoteId });
    this.timeout = setTimeout(() => {
      this.stopWatching();
      this.watchState = 'ERROR';
      this.changed();
    }, 15000);
    this.changed();
  }
  stopWatching(): void {
    clearTimeout(this.timeout);
    if (
      this.remoteId &&
      (this.watchState === 'CONNECTING' || this.watchState === 'WATCHING') &&
      this.ready &&
      !this.closed
    )
      this.send({ version: 1, type: 'WATCH_STOP', streamId: this.remoteId });
    this.accepted = false;
    this.watchState = 'IDLE';
    this.changed();
  }
  private checkReceiving(): void {
    if (this.closed) return;
    const track = this.remoteStream?.getVideoTracks()[0];
    if (
      this.watchState === 'CONNECTING' &&
      this.accepted &&
      track &&
      !track.muted &&
      track.readyState === 'live'
    ) {
      clearTimeout(this.timeout);
      this.watchState = 'WATCHING';
      console.info('[Stream] Receiving video');
    }
    this.changed();
  }
  private updateSender(): void {
    // Bound outstanding replaceTrack operations even if Chromium stalls.
    if (this.closed) return;
    if (this.pendingUpdates >= 8) {
      this.fail();
      return;
    }
    this.pendingUpdates++;
    this.updates = this.updates
      .then(async () => {
        if (this.closed) return;
        const local = this.local;
        const track =
          local &&
          local.streamId === this.subscribedId &&
          local.track.readyState === 'live'
            ? local.track
            : null;
        for (const kind of ['video', 'audio'] as const) {
          if (this.closed) return;
          const sender = this.pc
            .getTransceivers()
            .find((item) => item.receiver.track.kind === kind)?.sender;
          const mediaTrack =
            kind === 'video'
              ? track
              : track && local?.audioTrack?.readyState === 'live'
                ? local.audioTrack
                : null;
          if (!sender) {
            if (mediaTrack) throw new Error('Media sender unavailable');
            continue;
          }
          await sender.replaceTrack(mediaTrack);
          if (mediaTrack) await configureSender(sender, mediaTrack);
        }
        if (
          !this.closed &&
          track &&
          local &&
          this.local === local &&
          this.subscribedId === local.streamId
        )
          this.send({
            version: 1,
            type: 'WATCH_ACCEPTED',
            streamId: local.streamId,
          });
      })
      .catch(() => {
        if (!this.closed) this.fail();
      })
      .finally(() => {
        this.pendingUpdates--;
      });
  }
  close(): void {
    this.closed = true;
    clearTimeout(this.timeout);
    this.local = null;
    this.remoteId = null;
    this.watchState = 'IDLE';
    this.remoteStream?.getTracks().forEach((track) => {
      track.onended = null;
      track.onunmute = null;
      track.stop();
    });
    this.remoteStream = null;
  }
}
