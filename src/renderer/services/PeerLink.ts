import type { Signal } from '../../shared/protocols/signaling';
import { PROTOCOL_VERSION } from '../../shared/schemas/room';
import { mediaMessageSchema } from '../../shared/protocols/media';
import type { MediaMessage } from '../../shared/protocols/media';
import { PeerMedia } from './PeerMedia';
import { tuneOpus } from './sdp';

// Bumped with the voice transceiver so mismatched builds fail with a clear reason.
export const CONTROL_CHANNEL = 'poglive-control-v3';

export type LinkStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
type Candidate = Extract<Signal, { type: 'ICE_CANDIDATE' }>['candidate'];
export class PeerLink {
  private readonly pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private localReady = false;
  private localIce: Candidate[] = [];
  private remoteIce: Candidate[] = [];
  private confirmed = false;
  private localCandidates = 0;
  private remoteCandidates = 0;
  private localMdns = 0;
  private remoteMdns = 0;
  private localUdp = 0;
  private remoteUdp = 0;
  private localRadmin = 0;
  private remoteRadmin = 0;
  private localStun = 0;
  private remoteStun = 0;
  diagnostic: string | null = null;
  private closed = false;
  private messageCount = 0;
  private messageWindow = Date.now();
  readonly media: PeerMedia;
  private readonly deadline: ReturnType<typeof setTimeout>;
  status: LinkStatus = 'CONNECTING';
  constructor(
    readonly peerId: string,
    readonly negotiationId: string,
    private readonly roomId: string,
    private readonly selfId: string,
    rtcEndpoint: { host: string; port: number },
    private readonly send: (signal: Signal) => Promise<void>,
    private readonly changed: () => void,
  ) {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: `stun:${rtcEndpoint.host}:${rtcEndpoint.port}` }],
    });
    this.media = new PeerMedia(
      this.pc,
      (message) => this.sendControl(message),
      this.changed,
      () => this.fail(),
    );
    this.deadline = setTimeout(() => this.fail('TIMEOUT_25S'), 25000);
    this.pc.onicecandidate = ({ candidate }) => {
      if (this.closed) return;
      if (candidate) {
        this.localCandidates++;
        if (/\.local(?:\s|$)/i.test(candidate.candidate)) this.localMdns++;
        const info = this.classifyCandidate(candidate.candidate);
        if (info.udp) this.localUdp++;
        if (info.radmin) this.localRadmin++;
        if (info.stun) this.localStun++;
      }
      const value = candidate
        ? {
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
          }
        : null;
      if (!this.localReady) {
        if (this.localIce.length >= 64) {
          this.fail();
          return;
        }
        this.localIce.push(value);
      } else void this.sendIce(value).catch(() => this.fail());
    };
    this.pc.ondatachannel = ({ channel }) => {
      if (channel.label !== CONTROL_CHANNEL) {
        channel.close();
        this.fail('INCOMPATIBLE_VERSION');
        return;
      }
      if (this.channel) {
        channel.close();
        this.fail();
        return;
      }
      this.attach(channel);
    };
    this.pc.onconnectionstatechange = () => {
      if (this.closed) return;
      console.info('[WebRTC] Connection state:', this.pc.connectionState);
      if (this.pc.connectionState === 'failed') this.fail('CONNECTION_FAILED');
      else if (this.pc.connectionState === 'disconnected') {
        this.status = 'DISCONNECTED';
        this.changed();
      } else if (this.pc.connectionState === 'connected' && this.confirmed) {
        this.status = 'CONNECTED';
        this.changed();
      }
    };
  }
  private route() {
    return {
      version: PROTOCOL_VERSION,
      roomId: this.roomId,
      fromPeerId: this.selfId,
      toPeerId: this.peerId,
      negotiationId: this.negotiationId,
    };
  }
  private attach(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.onopen = () => {
      if (!this.closed) channel.send('VS1:HELLO');
    };
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (this.closed) return;
      if (Date.now() - this.messageWindow >= 1000) {
        this.messageWindow = Date.now();
        this.messageCount = 0;
      }
      if (
        ++this.messageCount > 20 ||
        typeof data !== 'string' ||
        data.length > 1024
      ) {
        this.fail();
        return;
      }
      if (data === 'VS1:HELLO') channel.send('VS1:ACK');
      else if (data === 'VS1:ACK' && !this.confirmed) {
        this.confirmed = true;
        clearTimeout(this.deadline);
        this.status = 'CONNECTED';
        this.media.connected();
        this.changed();
        console.info('[WebRTC] Direct channel confirmed');
      } else {
        try {
          if (!this.confirmed) throw new Error('Unconfirmed channel');
          this.media.receive(
            mediaMessageSchema.parse(JSON.parse(data) as unknown),
          );
        } catch {
          this.fail();
        }
      }
    };
    channel.onerror = () => this.fail();
    channel.onclose = () => {
      if (!this.closed) this.fail();
    };
  }
  async offer(): Promise<void> {
    // Order matters: MEDIA_SECTION addresses transceivers by this index.
    this.pc.addTransceiver('video', { direction: 'sendrecv' });
    this.pc.addTransceiver('audio', { direction: 'sendrecv' });
    this.pc.addTransceiver('audio', { direction: 'sendrecv' });
    this.attach(this.pc.createDataChannel(CONTROL_CHANNEL));
    console.info('[WebRTC] Creating offer');
    const created = await this.pc.createOffer();
    if (this.closed) return;
    const offer = { type: created.type, sdp: tuneOpus(created.sdp ?? '') };
    await this.pc.setLocalDescription(offer);
    if (this.closed) return;
    await this.send({
      ...this.route(),
      type: 'WEBRTC_OFFER',
      sdp: offer.sdp,
    });
    await this.flushLocal();
  }
  async receive(signal: Signal): Promise<void> {
    if (this.closed || signal.negotiationId !== this.negotiationId) return;
    if (signal.type === 'ICE_CANDIDATE') {
      if (signal.candidate) {
        this.remoteCandidates++;
        if (/\.local(?:\s|$)/i.test(signal.candidate.candidate))
          this.remoteMdns++;
        const info = this.classifyCandidate(signal.candidate.candidate);
        if (info.udp) this.remoteUdp++;
        if (info.radmin) this.remoteRadmin++;
        if (info.stun) this.remoteStun++;
      }
      if (!this.pc.remoteDescription) {
        if (this.remoteIce.length >= 64) throw new Error('ICE queue limit');
        this.remoteIce.push(signal.candidate);
      } else await this.pc.addIceCandidate(signal.candidate ?? undefined);
      return;
    }
    await this.pc.setRemoteDescription({
      type: signal.type === 'WEBRTC_OFFER' ? 'offer' : 'answer',
      sdp: signal.sdp,
    });
    if (this.closed) return;
    for (const candidate of this.remoteIce.splice(0)) {
      if (this.closed) return;
      await this.pc.addIceCandidate(candidate ?? undefined);
    }
    if (signal.type === 'WEBRTC_OFFER') {
      const kinds = this.pc
        .getTransceivers()
        .map((item) => item.receiver.track.kind);
      if (kinds.join(',') !== 'video,audio,audio')
        throw new Error('Unexpected media configuration');
      const transceivers = this.pc.getTransceivers();
      for (const transceiver of transceivers)
        transceiver.direction = 'sendrecv';
      console.info('[WebRTC] Creating answer');
      const created = await this.pc.createAnswer();
      if (this.closed) return;
      const answer = { type: created.type, sdp: tuneOpus(created.sdp ?? '') };
      await this.pc.setLocalDescription(answer);
      if (this.closed) return;
      await this.send({
        ...this.route(),
        type: 'WEBRTC_ANSWER',
        sdp: answer.sdp,
      });
      await this.flushLocal();
    }
  }
  private async sendIce(candidate: Candidate): Promise<void> {
    if (this.closed) return;
    await this.send({ ...this.route(), type: 'ICE_CANDIDATE', candidate });
  }
  private classifyCandidate(candidate: string): {
    udp: boolean;
    radmin: boolean;
    stun: boolean;
  } {
    const fields = candidate.trim().split(/\s+/);
    const address = fields[4] ?? '';
    const typeIndex = fields.indexOf('typ');
    return {
      udp: fields[2]?.toLowerCase() === 'udp',
      radmin: /^26\.(?:\d{1,3}\.){2}\d{1,3}$/.test(address),
      stun: typeIndex >= 0 && fields[typeIndex + 1] === 'srflx',
    };
  }
  private sendControl(message: MediaMessage): void {
    if (this.closed) return;
    const channel = this.channel;
    if (
      !channel ||
      channel.readyState !== 'open' ||
      channel.bufferedAmount > 65536
    ) {
      this.fail();
      return;
    }
    try {
      channel.send(JSON.stringify(message));
    } catch {
      this.fail();
    }
  }
  private async flushLocal(): Promise<void> {
    // Keep buffering events until all preceding candidates have been sent.
    while (this.localIce.length && !this.closed)
      await this.sendIce(this.localIce.shift() ?? null);
    this.localReady = true;
  }
  fail(reason = 'LINK_ERROR'): void {
    if (this.closed) return;
    // Only fixed labels and counts; never emit candidate addresses, SDP or credentials.
    this.diagnostic = [
      reason,
      `ICE=${this.pc.iceConnectionState}`,
      `coleta=${this.pc.iceGatheringState}`,
      `SDP=${this.pc.localDescription?.type ?? '-'}/${this.pc.remoteDescription?.type ?? '-'}`,
      `candidatos=${this.localCandidates}/${this.remoteCandidates}`,
      `mDNS=${this.localMdns}/${this.remoteMdns}`,
      `IP=${this.localCandidates - this.localMdns}/${this.remoteCandidates - this.remoteMdns}`,
      `UDP=${this.localUdp}/${this.remoteUdp}`,
      `Radmin=${this.localRadmin}/${this.remoteRadmin}`,
      `STUN=${this.localStun}/${this.remoteStun}`,
      `canal=${this.channel?.readyState ?? '-'}`,
    ].join(' · ');
    console.warn('[WebRTC] Diagnostic:', this.diagnostic);
    this.close();
    this.status = 'ERROR';
    this.changed();
  }
  close(): void {
    this.closed = true;
    this.media.close();
    clearTimeout(this.deadline);
    this.channel?.close();
    this.pc.close();
    this.localIce = [];
    this.remoteIce = [];
  }
}
