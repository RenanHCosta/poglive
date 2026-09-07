import { createServer } from 'node:tls';
import { timingSafeEqual } from 'node:crypto';
import { createCertificate } from '../transport/certificate';
import type { Server } from 'node:tls';
import type { Socket } from 'node:net';
import { Channel, TLS_OPTIONS } from '../transport/channel';
import { encodeInvite, newRoomAccess } from './invite';
import { MAX_PEERS } from '../../shared/schemas/room';
import type { Identity, RoomSnapshot } from '../../shared/schemas/room';
import type { NetworkMessage } from '../../shared/protocols/network';
import { signalSchema } from '../../shared/protocols/signaling';
import type { Signal } from '../../shared/protocols/signaling';
import { SignalRouter } from '../signaling/router';
import { LanStunServer } from '../networking/lan-stun-server';

export class RoomHost {
  private readonly access = newRoomAccess();
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly channels = new Set<Channel>();
  private readonly admitted = new Set<Channel>();
  private readonly members = new Map<string, Identity>();
  private readonly memberChannels = new Map<string, Channel>();
  private readonly router: SignalRouter;
  private readonly stun: LanStunServer;
  private rtcEndpoint: { host: string; port: number } | null = null;
  private closing = false;
  invite = '';
  constructor(
    private readonly identity: Identity,
    private readonly name: string,
    onFailure: () => void,
    onSignal: (signal: Signal) => void = () => {},
  ) {
    this.stun = new LanStunServer(onFailure);
    this.router = new SignalRouter(
      this.access.roomId,
      () => new Set([this.identity.peerId, ...this.members.keys()]),
      (signal) => {
        if (signal.toPeerId === this.identity.peerId) onSignal(signal);
        else this.memberChannels.get(signal.toPeerId)?.send(signal);
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
            const parsed = signalSchema.safeParse(message);
            if (!parsed.success) {
              channel.close();
              return;
            }
            this.router.route(memberId, parsed.data);
            return;
          }
          if (rejected || memberId || message.type !== 'ROOM_JOIN') {
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
              : message.identity.peerId === this.identity.peerId ||
                  this.members.has(message.identity.peerId)
                ? 'DUPLICATE_ID'
                : this.members.size >= MAX_PEERS - 1
                  ? 'FULL'
                  : null;
          if (reason) {
            rejected = true;
            channel.send({ version: 1, type: 'ROOM_JOIN_REJECTED', reason });
            socket.end();
            return;
          }
          clearTimeout(admissionTimer);
          memberId = message.identity.peerId;
          this.admitted.add(channel);
          this.members.set(memberId, message.identity);
          this.memberChannels.set(memberId, channel);
          channel.send({
            version: 1,
            type: 'ROOM_JOIN_ACCEPTED',
            room: this.snapshot(),
          });
          this.broadcast({
            version: 1,
            type: 'PEER_JOINED',
            peer: { ...message.identity, role: 'MEMBER' },
          });
          this.broadcastState();
          console.info('[Room] Peer joined');
        });
        this.channels.add(channel);
        socket.once('close', () => {
          clearTimeout(admissionTimer);
          this.channels.delete(channel);
          this.admitted.delete(channel);
          if (memberId && this.members.delete(memberId) && !this.closing) {
            this.memberChannels.delete(memberId);
            this.router.remove(memberId);
            this.broadcast({ version: 1, type: 'PEER_LEFT', peerId: memberId });
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
        { ...this.identity, role: 'HOST' },
        ...[...this.members.values()].map((peer) => ({
          ...peer,
          role: 'MEMBER' as const,
        })),
      ],
    };
  }
  sendSignal(signal: Signal): void {
    this.router.route(this.identity.peerId, signal);
  }
  private broadcast(message: NetworkMessage): void {
    for (const channel of this.admitted) channel.send(message);
  }
  private broadcastState(): void {
    this.broadcast({ version: 1, type: 'ROOM_STATE', room: this.snapshot() });
  }
  async close(): Promise<void> {
    this.closing = true;
    for (const channel of this.channels) channel.close();
    for (const socket of this.sockets) socket.destroy();
    await Promise.all([
      new Promise<void>((resolve) => this.server.close(() => resolve())),
      this.stun.close(),
    ]);
    this.members.clear();
  }
}
