import { createSocket } from 'node:dgram';
import type { RemoteInfo, Socket } from 'node:dgram';

const STUN_BINDING_REQUEST = 0x0001;
const STUN_BINDING_SUCCESS = 0x0101;
const STUN_MAGIC_COOKIE = 0x2112a442;
const XOR_MAPPED_ADDRESS = 0x0020;
const MAX_REQUEST_BYTES = 512;
const MAX_REQUESTS_PER_SECOND = 200;
const MAX_REQUESTS_PER_ADDRESS = 20;

export class LanStunServer {
  private socket: Socket | null = null;
  private windowStarted = Date.now();
  private requestCount = 0;
  private readonly addressCounts = new Map<string, number>();

  constructor(private readonly onFailure: () => void) {}

  async listen(address: string, port: number): Promise<void> {
    if (this.socket) throw new Error('STUN server already started');
    const socket = createSocket({ type: 'udp4', reuseAddr: false });
    this.socket = socket;
    socket.on('message', (message, remote) =>
      this.receive(socket, message, remote),
    );
    socket.on('error', () => {
      if (this.socket === socket) this.onFailure();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (): void => reject(new Error('STUN listener failed'));
        socket.once('error', failed);
        socket.bind(port, address, () => {
          socket.removeListener('error', failed);
          resolve();
        });
      });
    } catch (error: unknown) {
      if (this.socket === socket) this.socket = null;
      try {
        socket.close();
      } catch {
        // A failed bind can leave a socket that was never started.
      }
      throw error;
    }
  }

  private receive(socket: Socket, message: Buffer, remote: RemoteInfo): void {
    if (!this.allow(remote.address) || !this.isBindingRequest(message)) return;
    const octets = remote.address.split('.').map(Number);
    if (
      octets.length !== 4 ||
      octets.some(
        (value) => !Number.isInteger(value) || value < 0 || value > 255,
      )
    )
      return;

    const response = Buffer.alloc(32);
    response.writeUInt16BE(STUN_BINDING_SUCCESS, 0);
    response.writeUInt16BE(12, 2);
    response.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
    message.copy(response, 8, 8, 20);
    response.writeUInt16BE(XOR_MAPPED_ADDRESS, 20);
    response.writeUInt16BE(8, 22);
    response[24] = 0;
    response[25] = 0x01;
    response.writeUInt16BE(remote.port ^ (STUN_MAGIC_COOKIE >>> 16), 26);
    const cookie = [0x21, 0x12, 0xa4, 0x42];
    for (let index = 0; index < 4; index++)
      response[28 + index] = (octets[index] ?? 0) ^ (cookie[index] ?? 0);
    socket.send(response, remote.port, remote.address, () => {});
  }

  private isBindingRequest(message: Buffer): boolean {
    if (message.length < 20 || message.length > MAX_REQUEST_BYTES) return false;
    const bodyLength = message.readUInt16BE(2);
    return (
      message.readUInt16BE(0) === STUN_BINDING_REQUEST &&
      message.readUInt32BE(4) === STUN_MAGIC_COOKIE &&
      bodyLength % 4 === 0 &&
      bodyLength + 20 === message.length
    );
  }

  private allow(address: string): boolean {
    const now = Date.now();
    if (now - this.windowStarted >= 1000) {
      this.windowStarted = now;
      this.requestCount = 0;
      this.addressCounts.clear();
    }
    const addressCount = this.addressCounts.get(address) ?? 0;
    if (
      this.requestCount >= MAX_REQUESTS_PER_SECOND ||
      addressCount >= MAX_REQUESTS_PER_ADDRESS
    )
      return false;
    this.requestCount++;
    this.addressCounts.set(address, addressCount + 1);
    return true;
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    await new Promise<void>((resolve) => {
      try {
        socket.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}
