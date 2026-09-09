import type {
  LocalStream,
  MediaMessage,
  QualityReport,
  RemoteVideoQuality,
  WatchState,
} from '../../shared/protocols/media';
import { configureSender } from './mediaSender';
import {
  applyVideoQuality,
  evaluateQuality,
  initialQualityState,
  qualityLadder,
} from './adaptiveQuality';
import type { AdaptiveQualityState } from './adaptiveQuality';
import { collectMediaStats } from './mediaStats';
import type { MediaStatsSnapshot } from './mediaStats';

const STATS_INTERVAL_MS = 2000;

/** One pre-negotiated video sender per peer; capture ownership stays in useCapture. */
export class PeerMedia {
  remoteId: string | null = null;
  remoteStream: MediaStream | null = null;
  remoteQuality: RemoteVideoQuality | null = null;
  watchState: WatchState = 'IDLE';
  private local: LocalStream | null = null;
  private subscribedId: string | null = null;
  private sendingId: string | null = null;
  private ready = false;
  private closed = false;
  private accepted = false;
  private updates = Promise.resolve();
  private pendingUpdates = 0;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private statsBusy = false;
  private statsSnapshot: MediaStatsSnapshot | null = null;
  private videoSender: RTCRtpSender | null = null;
  private qualityState: AdaptiveQualityState = initialQualityState();
  private receiverReport: QualityReport | null = null;
  private receiverReportSequence = 0;
  private evaluatedReportSequence = 0;
  get watchingLocal(): boolean {
    return (
      this.ready &&
      !this.closed &&
      this.local?.streamId === this.subscribedId &&
      this.sendingId === this.subscribedId
    );
  }
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
    this.statsTimer = setInterval(() => {
      void this.sampleStats();
    }, STATS_INTERVAL_MS);
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
    this.resetSenderQuality();
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
      case 'QUALITY_REPORT':
        if (message.streamId !== this.sendingId) return;
        this.receiverReport = message;
        this.receiverReportSequence++;
        return;
      case 'QUALITY_STATE':
        if (message.streamId !== this.remoteId || this.watchState === 'IDLE')
          return;
        this.remoteQuality = {
          tier: message.tier,
          automatic: message.automatic,
          reduced: message.reduced,
          reason: message.reason,
          frameWidth: this.remoteQuality?.frameWidth ?? null,
          frameHeight: this.remoteQuality?.frameHeight ?? null,
          framesPerSecond: this.remoteQuality?.framesPerSecond ?? null,
        };
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
    this.remoteQuality = null;
    this.statsSnapshot = null;
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
          if (mediaTrack) {
            if (!local) throw new Error('Local capture unavailable');
            await configureSender(sender, mediaTrack, local.options);
          }
          if (kind === 'video') this.videoSender = mediaTrack ? sender : null;
        }
        const sendingId =
          !this.closed &&
          track &&
          local &&
          this.local === local &&
          this.subscribedId === local.streamId
            ? local.streamId
            : null;
        if (!this.closed && this.sendingId !== sendingId) {
          this.sendingId = sendingId;
          this.changed();
        }
        if (sendingId) {
          this.send({
            version: 1,
            type: 'WATCH_ACCEPTED',
            streamId: sendingId,
          });
          this.sendQualityState();
        } else {
          this.resetSenderQuality();
        }
      })
      .catch(() => {
        if (!this.closed) this.fail();
      })
      .finally(() => {
        this.pendingUpdates--;
      });
  }
  private resetSenderQuality(): void {
    this.videoSender = null;
    this.qualityState = initialQualityState();
    this.receiverReport = null;
    this.receiverReportSequence = 0;
    this.evaluatedReportSequence = 0;
  }
  private sendQualityState(): void {
    const local = this.local;
    if (!local || !this.sendingId) return;
    const ladder = qualityLadder(local.options);
    const tier = ladder[this.qualityState.level] ?? ladder[0];
    if (!tier) return;
    this.send({
      version: 1,
      type: 'QUALITY_STATE',
      streamId: this.sendingId,
      tier: tier.id,
      automatic: local.options.adaptiveQuality,
      reduced: this.qualityState.level > 0,
      reason: local.options.adaptiveQuality
        ? this.qualityState.reason
        : 'SOURCE',
    });
  }
  private async sampleStats(): Promise<void> {
    if (this.closed || !this.ready || this.statsBusy) return;
    this.statsBusy = true;
    try {
      const collected = collectMediaStats(
        await this.pc.getStats(),
        this.statsSnapshot,
      );
      this.statsSnapshot = collected.snapshot;
      if (collected.report && this.remoteId && this.watchState === 'WATCHING') {
        if (this.remoteQuality?.automatic !== false)
          this.send({
            version: 1,
            type: 'QUALITY_REPORT',
            streamId: this.remoteId,
            ...collected.report,
          });
        if (this.remoteQuality) {
          const previous = this.remoteQuality;
          const next: RemoteVideoQuality = {
            ...previous,
            frameWidth: collected.report.frameWidth,
            frameHeight: collected.report.frameHeight,
            framesPerSecond: collected.report.framesPerSecond,
          };
          if (
            next.frameWidth !== previous.frameWidth ||
            next.frameHeight !== previous.frameHeight ||
            Math.round(next.framesPerSecond ?? 0) !==
              Math.round(previous.framesPerSecond ?? 0)
          ) {
            this.remoteQuality = next;
            this.changed();
          }
        }
      }
      const local = this.local;
      const sender = this.videoSender;
      if (
        !local?.options.adaptiveQuality ||
        !sender ||
        this.sendingId !== local.streamId
      )
        return;
      const hasFreshReport =
        this.receiverReportSequence !== this.evaluatedReportSequence;
      if (hasFreshReport)
        this.evaluatedReportSequence = this.receiverReportSequence;
      const ladder = qualityLadder(local.options);
      const previousState = this.qualityState;
      const nextState = evaluateQuality(previousState, ladder, {
        receiver: hasFreshReport ? this.receiverReport : null,
        ...collected.sender,
      });
      if (nextState.level !== previousState.level) {
        const tier = ladder[nextState.level];
        if (!tier) return;
        await applyVideoQuality(sender, local.track, tier);
        console.info(
          `[Stream] Quality ${tier.id} for peer (${nextState.reason.toLowerCase()})`,
        );
        this.qualityState = nextState;
        this.sendQualityState();
        this.changed();
      } else {
        this.qualityState = nextState;
      }
    } catch (error: unknown) {
      console.warn(
        '[Stream] Quality telemetry failed:',
        error instanceof Error ? error.message : 'Unknown error',
      );
    } finally {
      this.statsBusy = false;
    }
  }
  close(): void {
    this.closed = true;
    clearTimeout(this.timeout);
    clearInterval(this.statsTimer);
    this.local = null;
    this.sendingId = null;
    this.remoteId = null;
    this.watchState = 'IDLE';
    this.remoteStream?.getTracks().forEach((track) => {
      track.onended = null;
      track.onunmute = null;
      track.stop();
    });
    this.remoteStream = null;
    this.remoteQuality = null;
    this.resetSenderQuality();
  }
}
