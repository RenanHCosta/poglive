import { randomUUID } from 'node:crypto';
import type { TLSSocket } from 'node:tls';
import { networkMessageSchema } from '../../shared/protocols/network';
import type { NetworkMessage } from '../../shared/protocols/network';

export const MAX_FRAME = 65536;
export const HEARTBEAT_MS = 4000;
export const DEADLINE_MS = 12000;
// TLS 1.3 only. The client pins the room certificate before sending any payload.
export const TLS_OPTIONS = {
  minVersion: 'TLSv1.3',
  maxVersion: 'TLSv1.3',
} as const;

export class Channel {
  private buffer: Buffer = Buffer.alloc(0);
  private rateStart = Date.now();
  private count = 0;
  private pendingPing: { nonce: string; time: number } | null = null;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  constructor(
    readonly socket: TLSSocket,
    onMessage: (message: NetworkMessage) => void,
  ) {
    socket.setNoDelay(true);
    socket.disableRenegotiation();
    socket.on('error', () => socket.destroy());
    socket.on('data', (data: Buffer) => {
      try {
        this.buffer = Buffer.concat([this.buffer, data]);
        while (this.buffer.length >= 4 && !socket.destroyed) {
          const size = this.buffer.readUInt32BE(0);
          if (size === 0 || size > MAX_FRAME) throw new Error('Frame limit');
          if (this.buffer.length < size + 4) break;
          if (Date.now() - this.rateStart >= 1000) {
            this.rateStart = Date.now();
            this.count = 0;
          }
          if (++this.count > 120) throw new Error('Rate limit');
          const raw: unknown = JSON.parse(
            this.buffer.subarray(4, size + 4).toString('utf8'),
          );
          this.buffer = this.buffer.subarray(size + 4);
          const message = networkMessageSchema.parse(raw);
          if (message.type === 'PING')
            this.send({ version: 1, type: 'PONG', nonce: message.nonce });
          else if (message.type === 'PONG') {
            if (message.nonce !== this.pendingPing?.nonce)
              throw new Error('Unexpected pong');
            this.pendingPing = null;
          } else onMessage(message);
        }
        if (this.buffer.length > MAX_FRAME + 4) throw new Error('Buffer limit');
      } catch {
        socket.destroy();
      }
    });
    this.heartbeat = setInterval(() => {
      if (this.pendingPing) {
        if (Date.now() - this.pendingPing.time > DEADLINE_MS) socket.destroy();
      } else {
        this.pendingPing = { nonce: randomUUID(), time: Date.now() };
        this.send({ version: 1, type: 'PING', nonce: this.pendingPing.nonce });
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
    socket.once('close', () => clearInterval(this.heartbeat));
  }
  send(message: NetworkMessage): void {
    if (this.socket.destroyed) return;
    const payload = Buffer.from(
      JSON.stringify(networkMessageSchema.parse(message)),
    );
    if (
      payload.length > MAX_FRAME ||
      this.socket.writableLength > MAX_FRAME * 4
    ) {
      this.socket.destroy();
      return;
    }
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length);
    this.socket.write(Buffer.concat([header, payload]));
  }
  close(): void {
    this.socket.destroy();
  }
}
