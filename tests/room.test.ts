import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, createServer } from 'node:tls';
import type { TLSSocket } from 'node:tls';
import { RoomHost } from '../src/main/room/host';
import { RoomClient } from '../src/main/room/client';
import {
  decodeInvite,
  encodeInvite,
  newRoomAccess,
} from '../src/main/room/invite';
import { IdentityStore } from '../src/main/room/identity';
import { RoomService } from '../src/main/room/service';
import { MAX_FRAME, TLS_OPTIONS } from '../src/main/transport/channel';
import { networkMessageSchema } from '../src/shared/protocols/network';
import type { Invite } from '../src/shared/schemas/room';
import {
  matchesCertificate,
  createCertificate,
} from '../src/main/transport/certificate';

const identity = (displayName: string) => ({
  peerId: randomUUID(),
  displayName,
});
async function until(predicate: () => boolean, timeout = 3000): Promise<void> {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('State transition timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
async function rawConnection(invite: Invite): Promise<TLSSocket> {
  return await new Promise((resolve, reject) => {
    const socket = connect(
      {
        ...TLS_OPTIONS,
        host: invite.host,
        port: invite.port,
        rejectUnauthorized: false,
      },
      () => {
        if (matchesCertificate(socket, invite.fingerprint)) resolve(socket);
        else {
          socket.destroy();
          reject(new Error('Pin mismatch'));
        }
      },
    );
    socket.once('error', reject);
  });
}
function frame(value: unknown): Buffer {
  const data = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  return Buffer.concat([header, data]);
}

test('wrong certificate pin fails before sending secret or identity', async () => {
  const certificate = await createCertificate();
  let received = 0;
  const sockets: TLSSocket[] = [];
  const server = createServer(
    { ...TLS_OPTIONS, key: certificate.key, cert: certificate.cert },
    (socket) => {
      sockets.push(socket);
      socket.on('data', (data: Buffer) => {
        received += data.length;
      });
      socket.on('error', () => socket.destroy());
    },
  );
  server.on('tlsClientError', (_error, socket) => socket.destroy());
  const client = new RoomClient();
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await assert.rejects(
      client.join(
        {
          version: 1,
          host: '127.0.0.1',
          port: address.port,
          ...newRoomAccess(),
          fingerprint: '0'.repeat(64),
        },
        identity('Private'),
        () => {},
      ),
      /identidade do host/,
    );
    assert.equal(received, 0);
  } finally {
    client.close();
    sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('identity persists UUID, changes name and isolates profiles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-share-test-'));
  try {
    const store = new IdentityStore(directory);
    await store.load();
    assert.equal(store.get(), null);
    await store.save('Renan');
    const id = store.get()?.peerId;
    const reload = new IdentityStore(directory);
    await reload.load();
    assert.equal(reload.get()?.peerId, id);
    await reload.save('Renan 2');
    assert.equal(reload.get()?.peerId, id);
    const other = new IdentityStore(join(directory, 'other'));
    await other.save('Vitória');
    assert.notEqual(other.get()?.peerId, id);
    const service = new RoomService(reload);
    try {
      await service.execute({
        type: 'CREATE_ROOM',
        name: 'Teste',
        address: '127.0.0.1',
      });
      assert.equal(service.snapshot().room.status, 'HOSTING');
      await assert.rejects(
        service.execute({ type: 'SAVE_IDENTITY', displayName: 'Outro' }),
      );
      await service.execute({ type: 'LEAVE_ROOM' });
      assert.equal(service.snapshot().room.status, 'IDLE');
    } finally {
      await service.close();
    }
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('real TLS room: invite, 3 peers, duplicate refusal, wrong secret, leave and host shutdown', async () => {
  const hostIdentity = identity('Host');
  const host = new RoomHost(hostIdentity, 'Teste', () => {});
  const b = new RoomClient();
  const c = new RoomClient();
  const wrong = new RoomClient();
  const duplicate = new RoomClient();
  try {
    await host.listen('127.0.0.1');
    const invite = decodeInvite(host.invite);
    assert.equal(encodeInvite(invite), host.invite);
    assert.match(host.invite, /^PL1\.[A-Za-z0-9_-]{94}$/);
    assert.equal(host.invite.length, 98);
    assert.equal(Buffer.from(invite.secret, 'base64url').length, 32);
    const legacyCode =
      'VS1.' + Buffer.from(JSON.stringify(invite)).toString('base64url');
    assert.deepEqual(decodeInvite(legacyCode), invite);
    let cDisconnected = false;
    const bIdentity = identity('B');
    await b.join(invite, bIdentity, () => {});
    await c.join(invite, identity('C'), () => {
      cDisconnected = true;
    });
    await until(
      () =>
        b.room?.participants.length === 3 && c.room?.participants.length === 3,
    );
    assert.equal(host.snapshot().participants.length, 3);
    await assert.rejects(
      duplicate.join(invite, bIdentity, () => {}),
      /identidade/,
    );
    await assert.rejects(
      wrong.join(
        { ...invite, secret: randomBytes(32).toString('base64url') },
        identity('Wrong'),
        () => {},
      ),
      /convite/,
    );
    b.close();
    await until(() => c.room?.participants.length === 2);
    await host.close();
    await until(() => cDisconnected);
  } finally {
    b.close();
    c.close();
    wrong.close();
    duplicate.close();
    await host.close();
  }
});

test('untrusted schemas reject extra fields, malformed invitation and oversized SDP', () => {
  assert.throws(() => decodeInvite('VS1.invalid'));
  assert.throws(() => decodeInvite('VS2.invalid'));
  assert.throws(() => decodeInvite('a'.repeat(2000)));
  assert.equal(
    networkMessageSchema.safeParse({
      version: 1,
      type: 'PING',
      nonce: randomUUID(),
      extra: true,
    }).success,
    false,
  );
  assert.equal(
    networkMessageSchema.safeParse({
      version: 1,
      type: 'WEBRTC_OFFER',
      toPeerId: randomUUID(),
      streamId: randomUUID(),
      negotiationId: randomUUID(),
      sdp: 'x'.repeat(48001),
    }).success,
    false,
  );
});

test('host closes oversized and malformed frames, remains usable', async () => {
  const host = new RoomHost(identity('Host'), 'Validation', () => {});
  const sockets: TLSSocket[] = [];
  const client = new RoomClient();
  try {
    await host.listen('127.0.0.1');
    const invite = decodeInvite(host.invite);
    for (const packet of [
      Buffer.from([0, 1, 0, 1]),
      frame({ type: 'UNKNOWN' }),
    ]) {
      const socket = await rawConnection(invite);
      sockets.push(socket);
      socket.resume();
      socket.write(packet);
      await until(() => socket.destroyed);
    }
    assert.equal(MAX_FRAME, 65536);
    await client.join(invite, identity('Still works'), () => {});
    assert.equal(host.snapshot().participants.length, 2);
  } finally {
    sockets.forEach((socket) => socket.destroy());
    client.close();
    await host.close();
  }
});

test('room capacity is enforced at 8 participants', async () => {
  const host = new RoomHost(identity('Host'), 'Capacity', () => {});
  const clients = Array.from({ length: 8 }, () => new RoomClient());
  try {
    await host.listen('127.0.0.1');
    const invite = decodeInvite(host.invite);
    for (const client of clients.slice(0, 7))
      await client.join(invite, identity('Member'), () => {});
    const extra = clients[7];
    assert.ok(extra);
    await assert.rejects(
      extra.join(invite, identity('Extra'), () => {}),
      /limite/,
    );
    assert.equal(host.snapshot().participants.length, 8);
  } finally {
    clients.forEach((client) => client.close());
    await host.close();
  }
});

test(
  'heartbeat removes a peer that stops responding',
  { timeout: 25000 },
  async () => {
    const host = new RoomHost(identity('Host'), 'Heartbeat', () => {});
    let socket: TLSSocket | undefined;
    try {
      await host.listen('127.0.0.1');
      const invite = decodeInvite(host.invite);
      socket = await rawConnection(invite);
      socket.resume();
      socket.write(
        frame({
          version: 1,
          type: 'ROOM_JOIN',
          roomId: invite.roomId,
          identity: identity('Silent'),
          secret: invite.secret,
        }),
      );
      await until(() => host.snapshot().participants.length === 2);
      await until(() => host.snapshot().participants.length === 1, 22000);
    } finally {
      socket?.destroy();
      await host.close();
    }
  },
);
