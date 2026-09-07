import { networkInterfaces } from 'node:os';
import type { IdentityStore } from './identity';
import { RoomHost } from './host';
import { RoomClient } from './client';
import { decodeInvite } from './invite';
import type { Signal, SignalBatch } from '../../shared/protocols/signaling';
import type {
  LocalState,
  RoomCommand,
  RoomState,
} from '../../shared/schemas/room';

export function localAddresses(): LocalState['addresses'] {
  const addresses: LocalState['addresses'] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (
        entry.family === 'IPv4' &&
        !entry.internal &&
        !addresses.some((a) => a.address === entry.address)
      ) {
        addresses.push({
          address: entry.address,
          label: `${name.slice(0, 140)} · ${entry.address}`,
        });
      }
    }
  }
  return [
    ...addresses.slice(0, 63),
    { address: '127.0.0.1', label: 'Somente este computador · 127.0.0.1' },
  ];
}
export class RoomService {
  private host: RoomHost | null = null;
  private client: RoomClient | null = null;
  private state: RoomState = { status: 'IDLE' };
  private busy = false;
  private inbox: Signal[] = [];
  private inboxBytes = 0;
  constructor(private readonly identityStore: IdentityStore) {}
  snapshot(): LocalState {
    let room = this.state;
    if (this.host?.invite)
      room = {
        status: 'HOSTING',
        room: this.host.snapshot(),
        invite: this.host.invite,
      };
    else if (this.client?.room && this.state.status !== 'DISCONNECTED')
      room = { status: 'JOINED', room: this.client.room };
    return {
      identity: this.identityStore.get(),
      room,
      addresses: localAddresses(),
    };
  }
  async execute(
    command: Exclude<RoomCommand, { type: 'COPY_INVITE' }>,
  ): Promise<void> {
    if (this.busy) throw new Error('Aguarde a operação atual.');
    this.busy = true;
    try {
      if (command.type === 'LEAVE_ROOM') {
        await this.close();
        return;
      }
      if (this.host || this.client)
        throw new Error(
          'Saia da sala antes de alterar o perfil ou entrar em outra.',
        );
      if (command.type === 'SAVE_IDENTITY') {
        await this.identityStore.save(command.displayName);
        return;
      }
      const identity = this.identityStore.get();
      this.inbox = [];
      this.inboxBytes = 0;
      if (!identity)
        throw new Error('Defina seu nome antes de entrar em uma sala.');
      if (command.type === 'CREATE_ROOM') {
        if (!localAddresses().some((a) => a.address === command.address))
          throw new Error('Selecione um endereço local disponível.');
        const host = new RoomHost(
          identity,
          command.name,
          () => {
            if (this.host === host) {
              this.host = null;
              this.state = {
                status: 'DISCONNECTED',
                message:
                  'O host encontrou um erro de rede. Crie uma nova sala.',
              };
              void host.close();
            }
          },
          (signal) => this.receiveSignal(signal),
        );
        this.host = host;
        try {
          await host.listen(command.address);
        } catch {
          await host.close();
          this.host = null;
          throw new Error(
            'Não foi possível criar a sala. Confira a interface de rede.',
          );
        }
      } else {
        const invite = decodeInvite(command.invite);
        const client = new RoomClient();
        this.client = client;
        this.state = { status: 'CONNECTING' };
        try {
          await client.join(
            invite,
            identity,
            () => {
              if (this.client !== client) return;
              this.client = null;
              this.state = {
                status: 'DISCONNECTED',
                message:
                  'A conexão com o host foi encerrada ou expirou. Entre novamente com um convite válido.',
              };
              console.info('[Room] Disconnected');
            },
            (signal) => this.receiveSignal(signal),
          );
        } catch (error: unknown) {
          client.close();
          this.client = null;
          this.state = { status: 'IDLE' };
          throw error;
        }
      }
    } finally {
      this.busy = false;
    }
  }
  async close(): Promise<void> {
    this.inbox = [];
    this.inboxBytes = 0;
    const host = this.host;
    this.host = null;
    this.client?.close();
    this.client = null;
    this.state = { status: 'IDLE' };
    await host?.close();
  }
  private receiveSignal(signal: Signal): void {
    const size = Buffer.byteLength(JSON.stringify(signal));
    if (this.inbox.length >= 128 || this.inboxBytes + size > 512000)
      throw new Error('Signal queue limit');
    this.inbox.push(signal);
    this.inboxBytes += size;
  }
  pollSignals(roomId: string): SignalBatch {
    const state = this.snapshot().room;
    if (
      (state.status !== 'HOSTING' && state.status !== 'JOINED') ||
      state.room.roomId !== roomId
    )
      return { room: null, signals: [] };
    const signals = this.inbox.filter((signal) => signal.roomId === roomId);
    this.inbox = [];
    this.inboxBytes = 0;
    return { room: state.room, signals };
  }
  sendSignal(signal: Signal): void {
    const state = this.snapshot();
    if (
      (state.room.status !== 'HOSTING' && state.room.status !== 'JOINED') ||
      state.room.room.roomId !== signal.roomId ||
      state.identity?.peerId !== signal.fromPeerId
    )
      throw new Error('Sessão de signaling inválida.');
    if (this.host) this.host.sendSignal(signal);
    else this.client?.sendSignal(signal);
  }
}
