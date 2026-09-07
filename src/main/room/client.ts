import { connect } from 'node:tls';
import type { TLSSocket } from 'node:tls';
import { Channel, TLS_OPTIONS } from '../transport/channel';
import { matchesCertificate } from '../transport/certificate';
import type { Identity, Invite, RoomSnapshot } from '../../shared/schemas/room';
import type { NetworkMessage } from '../../shared/protocols/network';
import { signalSchema } from '../../shared/protocols/signaling';
import type { Signal } from '../../shared/protocols/signaling';

export class RoomClient {
  private channel: Channel | null = null;
  private socket: TLSSocket | null = null;
  private snapshotValue: RoomSnapshot | null = null;
  private closing = false;
  get room(): RoomSnapshot | null {
    return this.snapshotValue;
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
        } else if (
          !accepted ||
          !['PEER_JOINED', 'PEER_LEFT'].includes(message.type)
        )
          socket.destroy();
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
          version: 1,
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
  close(): void {
    this.closing = true;
    this.channel?.close();
    this.socket?.destroy();
  }
  sendSignal(signal: Signal): void {
    if (!this.channel || this.socket?.destroyed || !this.snapshotValue)
      throw new Error('Sala desconectada.');
    this.channel.send(signal);
  }
}
