import { createSocket } from 'node:dgram';
import type { RemoteInfo, Socket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { decodeInvite } from '../room/invite';
import { PROTOCOL_VERSION } from '../../shared/schemas/room';
import {
  DISCOVERY_MAGIC,
  DISCOVERY_PORT,
  MAX_DISCOVERY_BYTES,
  discoveryAnnouncementSchema,
  discoveryProbeSchema,
} from '../../shared/schemas/discovery';
import type {
  DiscoveredRoom,
  DiscoveryAnnouncement,
  DiscoveryProbe,
} from '../../shared/schemas/discovery';

/** What a public room tells whoever probes its network. */
export type RoomAnnouncement = Pick<
  DiscoveryAnnouncement,
  'roomId' | 'name' | 'hostName' | 'members' | 'max' | 'invite'
>;
export interface InterfaceAddress {
  address: string;
  netmask: string;
}

const MAX_REPLIES_PER_SECOND = 100;
const MAX_REPLIES_PER_ADDRESS = 10;
const ROOM_TTL_MS = 8000;
const SCANNER_IDLE_MS = 10_000;
const FIRST_SCAN_WAIT_MS = 300;
const MAX_PENDING_NONCES = 8;
const MAX_ROOMS = 64;
const MAX_TARGETS = 64;

function ipToInt(ip: string): number {
  const [a = 0, b = 0, c = 0, d = 0] = ip.split('.').map(Number);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}
function intToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

export function ipv4Interfaces(): InterfaceAddress[] {
  const result: InterfaceAddress[] = [];
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? [])
      if (entry.family === 'IPv4' && !entry.internal)
        result.push({ address: entry.address, netmask: entry.netmask });
  return result;
}

/**
 * Subnet-directed broadcast. Windows sends 255.255.255.255 only through the
 * primary adapter, so each adapter (Wi-Fi, Ethernet, Radmin) gets its own.
 */
export function broadcastAddress(
  address: string,
  netmask: string,
): string | null {
  const mask = ipToInt(netmask);
  if (mask === 0 || mask === 0xffffffff) return null;
  return intToIp((ipToInt(address) | ~mask) >>> 0);
}

export function sameSubnet(a: string, b: string, netmask: string): boolean {
  const mask = ipToInt(netmask);
  return (ipToInt(a) & mask) >>> 0 === (ipToInt(b) & mask) >>> 0;
}

export function probeTargets(
  interfaces: InterfaceAddress[] = ipv4Interfaces(),
): string[] {
  const targets = new Set<string>(['127.0.0.1']);
  for (const entry of interfaces) {
    const target = broadcastAddress(entry.address, entry.netmask);
    if (target) targets.add(target);
  }
  return [...targets].slice(0, MAX_TARGETS);
}

function parsePacket(message: Buffer): unknown {
  if (message.length > MAX_DISCOVERY_BYTES) return null;
  try {
    return JSON.parse(message.toString('utf8'));
  } catch {
    return null;
  }
}
function bind(socket: Socket, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error): void => reject(error);
    socket.once('error', failed);
    socket.bind(port, '0.0.0.0', () => {
      socket.removeListener('error', failed);
      resolve();
    });
  });
}
function closeQuietly(socket: Socket): void {
  try {
    socket.close();
  } catch {
    // Already closed, or never bound.
  }
}

/**
 * Answers discovery probes for a public room. Replies are unicast to the
 * prober and only to sources on the room's own subnet, so the invite does not
 * leak to networks that could not reach the room anyway.
 */
export class DiscoveryResponder {
  private socket: Socket | null = null;
  private closed = false;
  private windowStarted = Date.now();
  private replies = 0;
  private readonly perAddress = new Map<string, number>();

  constructor(
    private readonly roomAddress: string,
    private readonly announce: () => RoomAnnouncement | null,
    private readonly port = DISCOVERY_PORT,
    private readonly interfaces: () => InterfaceAddress[] = ipv4Interfaces,
  ) {}

  /** Resolves false when the port is unavailable; the room keeps working unlisted. */
  async start(): Promise<boolean> {
    if (this.socket || this.closed) return !!this.socket;
    // reuseAddr lets several profiles or instances on one PC host public rooms.
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (message, remote) =>
      this.receive(socket, message, remote),
    );
    socket.on('error', () => {
      if (this.socket === socket) this.close();
    });
    try {
      await bind(socket, this.port);
    } catch {
      closeQuietly(socket);
      return false;
    }
    if (this.closed) {
      closeQuietly(socket);
      return false;
    }
    socket.unref();
    this.socket = socket;
    return true;
  }

  close(): void {
    this.closed = true;
    const socket = this.socket;
    this.socket = null;
    if (socket) closeQuietly(socket);
  }

  private receive(socket: Socket, message: Buffer, remote: RemoteInfo): void {
    if (this.socket !== socket || remote.family !== 'IPv4') return;
    const probe = discoveryProbeSchema.safeParse(parsePacket(message));
    if (
      !probe.success ||
      !this.reachable(remote.address) ||
      !this.allow(remote.address)
    )
      return;
    const room = this.announce();
    if (!room) return;
    const reply: DiscoveryAnnouncement = {
      magic: DISCOVERY_MAGIC,
      v: 1,
      type: 'ROOM',
      nonce: probe.data.nonce,
      protocol: PROTOCOL_VERSION,
      ...room,
    };
    socket.send(
      Buffer.from(JSON.stringify(reply)),
      remote.port,
      remote.address,
      () => {},
    );
  }

  private reachable(source: string): boolean {
    if (this.roomAddress === '127.0.0.1') return source.startsWith('127.');
    const local = this.interfaces().find(
      (entry) => entry.address === this.roomAddress,
    );
    return !!local && sameSubnet(source, local.address, local.netmask);
  }

  private allow(address: string): boolean {
    const now = Date.now();
    if (now - this.windowStarted >= 1000) {
      this.windowStarted = now;
      this.replies = 0;
      this.perAddress.clear();
    }
    const fromAddress = this.perAddress.get(address) ?? 0;
    if (
      this.replies >= MAX_REPLIES_PER_SECOND ||
      fromAddress >= MAX_REPLIES_PER_ADDRESS
    )
      return false;
    this.replies += 1;
    this.perAddress.set(address, fromAddress + 1);
    return true;
  }
}

/**
 * Probes every local network for public rooms while the home screen asks.
 * The socket closes itself after a few seconds without scans.
 */
export class DiscoveryScanner {
  private socket: Socket | null = null;
  private opening: Promise<Socket | null> | null = null;
  private readonly nonces: string[] = [];
  private readonly rooms = new Map<
    string,
    { room: DiscoveredRoom; seen: number }
  >();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly port = DISCOVERY_PORT,
    private readonly targets: () => string[] = () => probeTargets(),
  ) {}

  async scan(): Promise<DiscoveredRoom[]> {
    this.touch();
    const fresh = !this.socket;
    const socket = await this.open();
    if (!socket) return [];
    const nonce = randomBytes(16).toString('base64url');
    this.nonces.push(nonce);
    if (this.nonces.length > MAX_PENDING_NONCES) this.nonces.shift();
    const probe: DiscoveryProbe = {
      magic: DISCOVERY_MAGIC,
      v: 1,
      type: 'PROBE',
      nonce,
    };
    const payload = Buffer.from(JSON.stringify(probe));
    for (const target of this.targets())
      socket.send(payload, this.port, target, () => {});
    // The first scan waits briefly so the list is not empty on arrival.
    if (fresh)
      await new Promise((resolve) => setTimeout(resolve, FIRST_SCAN_WAIT_MS));
    return this.list();
  }

  list(): DiscoveredRoom[] {
    const now = Date.now();
    for (const [roomId, entry] of this.rooms)
      if (now - entry.seen > ROOM_TTL_MS) this.rooms.delete(roomId);
    return [...this.rooms.values()]
      .map((entry) => entry.room)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  close(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) closeQuietly(socket);
    this.rooms.clear();
    this.nonces.length = 0;
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(), SCANNER_IDLE_MS);
    this.idleTimer.unref();
  }

  private open(): Promise<Socket | null> {
    if (this.socket) return Promise.resolve(this.socket);
    this.opening ??= (async () => {
      const socket = createSocket({ type: 'udp4' });
      socket.on('message', (message, remote) =>
        this.receive(socket, message, remote),
      );
      socket.on('error', () => {
        if (this.socket === socket) this.close();
      });
      try {
        await bind(socket, 0);
        socket.setBroadcast(true);
        socket.unref();
        this.socket = socket;
        return socket;
      } catch {
        closeQuietly(socket);
        return null;
      } finally {
        this.opening = null;
      }
    })();
    return this.opening;
  }

  private receive(socket: Socket, message: Buffer, remote: RemoteInfo): void {
    if (this.socket !== socket || remote.family !== 'IPv4') return;
    const parsed = discoveryAnnouncementSchema.safeParse(parsePacket(message));
    if (!parsed.success || !this.nonces.includes(parsed.data.nonce)) return;
    const room = parsed.data;
    const compatible = room.protocol === PROTOCOL_VERSION;
    if (compatible) {
      // The invite must point back at whoever answered, so a reply cannot
      // send the user to some other machine.
      try {
        const invite = decodeInvite(room.invite);
        if (invite.host !== remote.address || invite.roomId !== room.roomId)
          return;
      } catch {
        return;
      }
    }
    if (!this.rooms.has(room.roomId) && this.rooms.size >= MAX_ROOMS) return;
    this.rooms.set(room.roomId, {
      seen: Date.now(),
      room: {
        roomId: room.roomId,
        name: room.name,
        hostName: room.hostName,
        members: room.members,
        max: room.max,
        compatible,
        invite: compatible ? room.invite : '',
      },
    });
  }
}
