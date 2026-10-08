import { createServer } from 'node:tls';
import { timingSafeEqual } from 'node:crypto';
import { createCertificate } from '../transport/certificate';
import type { Server } from 'node:tls';
import type { Socket } from 'node:net';
import { Channel, TLS_OPTIONS } from '../transport/channel';
import { encodeInvite, newRoomAccess } from './invite';
import {
  DISCONNECTED_VOICE,
  MAX_PEERS,
  PROTOCOL_VERSION,
} from '../../shared/schemas/room';
import type {
  Identity,
  RoomSnapshot,
  VoiceState,
} from '../../shared/schemas/room';
import type { NetworkMessage } from '../../shared/protocols/network';
import type { ChatMessage, Reaction } from '../../shared/schemas/chat';
import { signalSchema } from '../../shared/protocols/signaling';
import type { Signal } from '../../shared/protocols/signaling';
import { SignalRouter } from '../signaling/router';
import { LanStunServer } from '../networking/lan-stun-server';
import { ChatLog, RateWindow } from './chat';
import type { RoomEvents } from './events';

// Presence changes are human-driven. Bursts beyond the normal rate are
// coalesced (last state wins); only an absurd rate counts as abuse.
const VOICE_UPDATES_PER_SECOND = 10;
const VOICE_ABUSE_PER_SECOND = 50;
const VOICE_COALESCE_MS = 1000;

interface Member {
  identity: Identity;
  channel: Channel;
  voice: VoiceState;
  chatRate: RateWindow;
  voiceRate: RateWindow;
  voiceAbuse: RateWindow;
  typingRate: RateWindow;
  reactionRate: RateWindow;
  previewRate: RateWindow;
  pendingVoice: {
    voice: VoiceState;
    timer: ReturnType<typeof setTimeout>;
  } | null;
}

export class RoomHost {
  private readonly access = newRoomAccess();
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly channels = new Set<Channel>();
  private readonly members = new Map<string, Member>();
  private readonly router: SignalRouter;
  private readonly stun: LanStunServer;
  private readonly chat = new ChatLog();
  private readonly hostChatRate = RateWindow.chat();
  private readonly hostTypingRate = RateWindow.typing();
  private readonly hostReactionRate = RateWindow.reactions();
  /** Kicked identities may not rejoin while this room lasts. */
  private readonly banned = new Set<string>();
  private hostVoice: VoiceState = DISCONNECTED_VOICE;
  private rtcEndpoint: { host: string; port: number } | null = null;
  private closing = false;
  invite = '';
  constructor(
    private readonly identity: Identity,
    private readonly name: string,
    onFailure: () => void,
    onSignal: (signal: Signal) => void = () => {},
    private readonly events: RoomEvents = {},
  ) {
    this.stun = new LanStunServer(onFailure);
    this.router = new SignalRouter(
      this.access.roomId,
      () => new Set([this.identity.peerId, ...this.members.keys()]),
      (signal) => {
        if (signal.toPeerId === this.identity.peerId) onSignal(signal);
        else this.members.get(signal.toPeerId)?.channel.send(signal);
      },
    );
    this.server = createServer(
      {
        ...TLS_OPTIONS,
        handshakeTimeout: 5000,
      },
      (socket) => {
        let memberId: string | null = null;
        let rejected = false;
        const admissionTimer = setTimeout(() => socket.destroy(), 5000);
        const channel = new Channel(socket, (message) => {
          if (memberId) {
            this.receiveFromMember(memberId, channel, message);
            return;
          }
          if (rejected || message.type !== 'ROOM_JOIN') {
            channel.close();
            return;
          }
          const reason = !timingSafeEqual(
            Buffer.from(message.secret),
            Buffer.from(this.access.secret),
          )
            ? 'INVALID_SECRET'
            : message.roomId !== this.access.roomId
              ? 'WRONG_ROOM'
              : this.banned.has(message.identity.peerId)
                ? 'KICKED'
                : message.identity.peerId === this.identity.peerId ||
                    this.members.has(message.identity.peerId)
                  ? 'DUPLICATE_ID'
                  : this.members.size >= MAX_PEERS - 1
                    ? 'FULL'
                    : null;
          if (reason) {
            rejected = true;
            channel.send({
              version: PROTOCOL_VERSION,
              type: 'ROOM_JOIN_REJECTED',
              reason,
            });
            socket.end();
            return;
          }
          clearTimeout(admissionTimer);
          memberId = message.identity.peerId;
          this.members.set(memberId, {
            identity: message.identity,
            channel,
            voice: DISCONNECTED_VOICE,
            chatRate: RateWindow.chat(),
            voiceRate: new RateWindow(VOICE_UPDATES_PER_SECOND, 1000),
            voiceAbuse: new RateWindow(VOICE_ABUSE_PER_SECOND, 1000),
            typingRate: RateWindow.typing(),
            reactionRate: RateWindow.reactions(),
            previewRate: RateWindow.previews(),
            pendingVoice: null,
          });
          channel.send({
            version: PROTOCOL_VERSION,
            type: 'ROOM_JOIN_ACCEPTED',
            room: this.snapshot(),
          });
          for (const messages of this.chat.historyBatches())
            channel.send({
              version: PROTOCOL_VERSION,
              type: 'CHAT_HISTORY',
              messages,
            });
          this.broadcast(
            {
              version: PROTOCOL_VERSION,
              type: 'PEER_JOINED',
              peer: {
                ...message.identity,
                role: 'MEMBER',
                voice: DISCONNECTED_VOICE,
              },
            },
            memberId,
          );
          this.broadcastState();
          console.info('[Room] Peer joined');
        });
        this.channels.add(channel);
        socket.once('close', () => {
          clearTimeout(admissionTimer);
          this.channels.delete(channel);
          const pending = memberId
            ? this.members.get(memberId)?.pendingVoice
            : null;
          if (pending) clearTimeout(pending.timer);
          if (memberId && this.members.delete(memberId) && !this.closing) {
            this.router.remove(memberId);
            this.broadcast({
              version: PROTOCOL_VERSION,
              type: 'PEER_LEFT',
              peerId: memberId,
            });
            this.broadcastState();
            console.info('[Room] Peer left');
          }
        });
      },
    );
    this.server.maxConnections = 16;
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
      socket.on('error', () => socket.destroy());
    });
    this.server.on('tlsClientError', (_error, socket) => socket.destroy());
    this.server.on('error', () => {
      if (!this.closing) onFailure();
    });
  }
  private receiveFromMember(
    memberId: string,
    channel: Channel,
    message: NetworkMessage,
  ): void {
    const member = this.members.get(memberId);
    if (!member) {
      channel.close();
      return;
    }
    switch (message.type) {
      case 'VOICE_STATE':
        if (!member.voiceAbuse.take()) {
          channel.close();
          return;
        }
        if (member.pendingVoice) {
          member.pendingVoice.voice = message.voice;
          return;
        }
        if (member.voiceRate.take()) {
          this.setMemberVoice(member, message.voice);
          return;
        }
        member.pendingVoice = {
          voice: message.voice,
          timer: setTimeout(() => {
            const pending = member.pendingVoice;
            member.pendingVoice = null;
            if (pending && this.members.get(memberId) === member)
              this.setMemberVoice(member, pending.voice);
          }, VOICE_COALESCE_MS),
        };
        return;
      case 'TYPING':
        // Extra notifications inside the window are simply dropped.
        if (member.typingRate.take()) this.publishTyping(memberId);
        return;
      case 'CHAT_SEND':
        if (!member.chatRate.take()) {
          channel.send({
            version: PROTOCOL_VERSION,
            type: 'CHAT_REJECTED',
            id: message.id,
            reason: 'RATE_LIMITED',
          });
          return;
        }
        this.publishChat(
          member.identity,
          message.id,
          message.text,
          message.replyTo,
          message.attachment,
        );
        return;
      case 'CHAT_EDIT':
        if (member.chatRate.take())
          this.publishEdit(member.identity.peerId, message.id, message.text);
        return;
      case 'CHAT_DELETE':
        if (member.chatRate.take())
          this.publishDelete(message.id, member.identity.peerId, false);
        return;
      case 'REACT':
        if (member.reactionRate.take())
          this.publishReaction(memberId, message.targetPeerId, message.emoji);
        return;
      case 'STREAM_PREVIEW':
        // Previews refresh every few seconds; extra ones are dropped.
        if (member.previewRate.take())
          this.publishPreview(memberId, message.image);
        return;
      default: {
        const parsed = signalSchema.safeParse(message);
        if (!parsed.success) {
          channel.close();
          return;
        }
        this.router.route(memberId, parsed.data);
      }
    }
  }
  private setMemberVoice(member: Member, voice: VoiceState): void {
    if (sameVoice(member.voice, voice)) return;
    member.voice = voice;
    this.broadcastState();
  }
  private publishTyping(peerId: string): void {
    this.broadcast(
      { version: PROTOCOL_VERSION, type: 'PEER_TYPING', peerId },
      peerId,
    );
    if (peerId !== this.identity.peerId) this.events.onTyping?.(peerId);
  }
  sendTyping(): void {
    if (this.hostTypingRate.take()) this.publishTyping(this.identity.peerId);
  }
  private publishEdit(authorId: string, id: string, text: string): void {
    const message = this.chat.edit(authorId, id, text);
    if (!message) return;
    this.broadcast({
      version: PROTOCOL_VERSION,
      type: 'CHAT_UPDATED',
      message,
    });
    this.events.onChatUpdated?.(message);
  }
  private publishDelete(
    id: string,
    requesterId: string,
    moderator: boolean,
  ): void {
    if (!this.chat.remove(id, requesterId, moderator)) return;
    this.broadcast({ version: PROTOCOL_VERSION, type: 'CHAT_DELETED', id });
    this.events.onChatDeleted?.(id);
  }
  private publishReaction(from: string, target: string, emoji: Reaction): void {
    const present = target === this.identity.peerId || this.members.has(target);
    if (!present) return;
    this.broadcast(
      {
        version: PROTOCOL_VERSION,
        type: 'PEER_REACTION',
        fromPeerId: from,
        targetPeerId: target,
        emoji,
      },
      from,
    );
    if (from !== this.identity.peerId)
      this.events.onReaction?.(from, target, emoji);
  }
  private publishPreview(peerId: string, image: string | null): void {
    this.broadcast(
      { version: PROTOCOL_VERSION, type: 'PEER_PREVIEW', peerId, image },
      peerId,
    );
    if (peerId !== this.identity.peerId) this.events.onPreview?.(peerId, image);
  }
  private publishChat(
    author: Identity,
    id: string,
    text: string,
    replyTo: string | null = null,
    attachment: ChatMessage['attachment'] = null,
  ): void {
    const message = this.chat.append(author, id, text, replyTo, attachment);
    if (!message) {
      // A retry of a delivered message: confirm it to its author only, so a
      // slow first confirmation never produces a duplicate post.
      const existing = this.chat.find(id);
      if (existing?.authorId !== author.peerId) return;
      if (author.peerId === this.identity.peerId)
        this.events.onChat?.(existing);
      else
        this.members.get(author.peerId)?.channel.send({
          version: PROTOCOL_VERSION,
          type: 'CHAT_MESSAGE',
          message: existing,
        });
      return;
    }
    this.broadcast({
      version: PROTOCOL_VERSION,
      type: 'CHAT_MESSAGE',
      message,
    });
    this.events.onChat?.(message);
  }
  async listen(address: string): Promise<void> {
    const certificate = await createCertificate();
    if (this.closing) throw new Error('Sala encerrada.');
    this.server.setSecureContext({
      ...TLS_OPTIONS,
      key: certificate.key,
      cert: certificate.cert,
    });
    await new Promise<void>((resolve, reject) => {
      const failed = (): void =>
        reject(new Error('Não foi possível abrir a sala neste endereço.'));
      this.server.once('error', failed);
      this.server.listen(0, address, () => {
        this.server.removeListener('error', failed);
        resolve();
      });
    });
    const bound = this.server.address();
    if (!bound || typeof bound === 'string')
      throw new Error('Endereço indisponível.');
    await this.stun.listen(bound.address, bound.port);
    this.rtcEndpoint = { host: bound.address, port: bound.port };
    this.invite = encodeInvite({
      version: 1,
      host: bound.address,
      port: bound.port,
      ...this.access,
      fingerprint: certificate.fingerprint,
    });
    console.info('[Room] Hosting');
  }
  snapshot(): RoomSnapshot {
    if (!this.rtcEndpoint) throw new Error('Sala ainda não está disponível.');
    return {
      roomId: this.access.roomId,
      name: this.name,
      hostPeerId: this.identity.peerId,
      rtcEndpoint: this.rtcEndpoint,
      participants: [
        { ...this.identity, role: 'HOST', voice: this.hostVoice },
        ...[...this.members.values()].map((member) => ({
          ...member.identity,
          role: 'MEMBER' as const,
          voice: member.voice,
        })),
      ],
    };
  }
  chatHistory() {
    return this.chat.messages();
  }
  updateVoice(voice: VoiceState): void {
    if (sameVoice(this.hostVoice, voice)) return;
    this.hostVoice = voice;
    this.broadcastState();
  }
  sendChat(
    id: string,
    text: string,
    replyTo: string | null = null,
    attachment: ChatMessage['attachment'] = null,
  ): void {
    if (!this.hostChatRate.take()) {
      this.events.onChatRejected?.(id, 'RATE_LIMITED');
      return;
    }
    this.publishChat(this.identity, id, text, replyTo, attachment);
  }
  editChat(id: string, text: string): void {
    this.publishEdit(this.identity.peerId, id, text);
  }
  /** The host moderates: it may delete anyone's message. */
  deleteChat(id: string): void {
    this.publishDelete(id, this.identity.peerId, true);
  }
  react(targetPeerId: string, emoji: Reaction): void {
    if (this.hostReactionRate.take())
      this.publishReaction(this.identity.peerId, targetPeerId, emoji);
  }
  setPreview(image: string | null): void {
    this.publishPreview(this.identity.peerId, image);
  }
  /** Removes a member for the rest of this room's life. */
  kick(peerId: string): boolean {
    const member = this.members.get(peerId);
    if (!member) return false;
    this.banned.add(peerId);
    member.channel.send({ version: PROTOCOL_VERSION, type: 'KICKED' });
    // Give the notice a moment to flush before closing.
    setTimeout(() => member.channel.close(), 100);
    return true;
  }
  sendSignal(signal: Signal): void {
    this.router.route(this.identity.peerId, signal);
  }
  private broadcast(message: NetworkMessage, except?: string): void {
    for (const [id, member] of this.members)
      if (id !== except) member.channel.send(message);
  }
  private broadcastState(): void {
    if (this.closing || !this.rtcEndpoint) return;
    this.broadcast({
      version: PROTOCOL_VERSION,
      type: 'ROOM_STATE',
      room: this.snapshot(),
    });
    this.events.onChange?.();
  }
  async close(): Promise<void> {
    this.closing = true;
    for (const member of this.members.values())
      if (member.pendingVoice) clearTimeout(member.pendingVoice.timer);
    for (const channel of this.channels) channel.close();
    for (const socket of this.sockets) socket.destroy();
    await Promise.all([
      new Promise<void>((resolve) => this.server.close(() => resolve())),
      this.stun.close(),
    ]);
    this.members.clear();
  }
}

function sameVoice(a: VoiceState, b: VoiceState): boolean {
  return (
    a.connected === b.connected &&
    a.muted === b.muted &&
    a.deafened === b.deafened &&
    a.streaming === b.streaming
  );
}
