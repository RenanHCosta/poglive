import { connect } from 'node:tls';
import type { TLSSocket } from 'node:tls';
import { Channel, TLS_OPTIONS } from '../transport/channel';
import { matchesCertificate } from '../transport/certificate';
import { PROTOCOL_VERSION } from '../../shared/schemas/room';
import type {
  Identity,
  Invite,
  RoomSnapshot,
  VoiceState,
} from '../../shared/schemas/room';
import type { ChatMessage } from '../../shared/schemas/chat';
import { CHAT_LOG_LIMIT } from '../../shared/schemas/chat';
import type { NetworkMessage } from '../../shared/protocols/network';
import { signalSchema } from '../../shared/protocols/signaling';
import type { Signal } from '../../shared/protocols/signaling';
import type { RoomEvents } from './events';

export class RoomClient {
  private channel: Channel | null = null;
  private socket: TLSSocket | null = null;
  private snapshotValue: RoomSnapshot | null = null;
  private readonly chat: ChatMessage[] = [];
  private closing = false;
  constructor(private readonly events: RoomEvents = {}) {}
  get room(): RoomSnapshot | null {
    return this.snapshotValue;
  }
  chatHistory(): ChatMessage[] {
    return [...this.chat];
  }
  async join(
    invite: Invite,
    identity: Identity,
    onDisconnect: () => void,
    onSignal: (signal: Signal) => void = () => {},
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let accepted = false;
      let failure =
        'Não foi possível entrar. Confira o convite, o host e o firewall.';
      // Trust is the exact certificate fingerprint from the private invitation, not public CAs.
      // No application data or secret is sent/processed until matchesCertificate succeeds.
      const socket = connect({
        ...TLS_OPTIONS,
        host: invite.host,
        port: invite.port,
        rejectUnauthorized: false,
      });
      this.socket = socket;
      const timeout = setTimeout(() => socket.destroy(), 7000);
      socket.on('error', () => socket.destroy());
      const receive = (message: NetworkMessage): void => {
        const signal = signalSchema.safeParse(message);
        if (accepted && signal.success) {
          if (
            signal.data.roomId !== invite.roomId ||
            signal.data.toPeerId !== identity.peerId ||
            !this.snapshotValue?.participants.some(
              (peer) => peer.peerId === signal.data.fromPeerId,
            )
          ) {
            socket.destroy();
            return;
          }
          onSignal(signal.data);
          return;
        }
        if (message.type === 'ROOM_JOIN_REJECTED' && !accepted) {
          failure =
            message.reason === 'DUPLICATE_ID'
              ? 'Esta identidade já está na sala. Use outro perfil para testar.'
              : message.reason === 'FULL'
                ? 'A sala atingiu o limite de 8 participantes.'
                : 'O convite foi recusado. Confira o código de acesso.';
          socket.destroy();
          return;
        }
        if (
          (message.type === 'ROOM_JOIN_ACCEPTED' && !accepted) ||
          (message.type === 'ROOM_STATE' && accepted)
        ) {
          const room = message.room;
          if (
            room.roomId !== invite.roomId ||
            !room.participants.some(
              (peer) =>
                peer.peerId === identity.peerId && peer.role === 'MEMBER',
            ) ||
            (this.snapshotValue &&
              room.hostPeerId !== this.snapshotValue.hostPeerId)
          ) {
            socket.destroy();
            return;
          }
          this.snapshotValue = room;
          if (!accepted) {
            accepted = true;
            clearTimeout(timeout);
            console.info('[Room] Joined');
            resolve();
          }
          this.events.onChange?.();
          return;
        }
        if (!accepted) {
          socket.destroy();
          return;
        }
        switch (message.type) {
          case 'PEER_JOINED':
          case 'PEER_LEFT':
            return; // ROOM_STATE is authoritative; these are notifications.
          case 'CHAT_HISTORY':
            for (const item of message.messages) this.remember(item);
            this.events.onHistory?.();
            return;
          case 'CHAT_MESSAGE':
            if (this.remember(message.message))
              this.events.onChat?.(message.message);
            return;
          case 'CHAT_REJECTED':
            this.events.onChatRejected?.(message.id, message.reason);
            return;
          default:
            socket.destroy();
        }
      };
      socket.once('secureConnect', () => {
        if (!matchesCertificate(socket, invite.fingerprint)) {
          failure =
            'A identidade do host não corresponde ao convite, ou o certificado expirou.';
          socket.destroy();
          return;
        }
        this.channel = new Channel(socket, receive);
        this.channel.send({
          version: PROTOCOL_VERSION,
          type: 'ROOM_JOIN',
          roomId: invite.roomId,
          secret: invite.secret,
          identity,
        });
      });
      socket.once('close', () => {
        clearTimeout(timeout);
        if (!accepted) reject(new Error(failure));
        else if (!this.closing) onDisconnect();
      });
    });
  }
  /** Returns false for a message ID that was already delivered. */
  private remember(message: ChatMessage): boolean {
    // Authors are not checked against the roster: history keeps messages
    // from people who already left. The host stamps author fields.
    if (this.chat.some((item) => item.id === message.id)) return false;
    this.chat.push(message);
    if (this.chat.length > CHAT_LOG_LIMIT) this.chat.shift();
    return true;
  }
  close(): void {
    this.closing = true;
    this.channel?.close();
    this.socket?.destroy();
  }
  private live(): Channel {
    if (!this.channel || this.socket?.destroyed || !this.snapshotValue)
      throw new Error('Sala desconectada.');
    return this.channel;
  }
  sendSignal(signal: Signal): void {
    this.live().send(signal);
  }
  updateVoice(voice: VoiceState): void {
    this.live().send({ version: PROTOCOL_VERSION, type: 'VOICE_STATE', voice });
  }
  sendChat(id: string, text: string): void {
    this.live().send({
      version: PROTOCOL_VERSION,
      type: 'CHAT_SEND',
      id,
      text,
    });
  }
}
