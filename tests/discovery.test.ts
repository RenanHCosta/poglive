import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { randomUUID } from 'node:crypto';
import {
  DiscoveryResponder,
  DiscoveryScanner,
  broadcastAddress,
  probeTargets,
  sameSubnet,
} from '../src/main/networking/discovery';
import type { RoomAnnouncement } from '../src/main/networking/discovery';
import { encodeInvite, newRoomAccess } from '../src/main/room/invite';
import {
  DISCOVERY_MAGIC,
  discoveryAnnouncementSchema,
  discoveryProbeSchema,
} from '../src/shared/schemas/discovery';
import { commandSchema, PROTOCOL_VERSION } from '../src/shared/schemas/room';

let nextPort = 46000 + Math.floor(Math.random() * 2000);
const freshPort = () => (nextPort += 1);

function announcement(host = '127.0.0.1'): RoomAnnouncement {
  const access = newRoomAccess();
  return {
    roomId: access.roomId,
    name: 'Sala LAN',
    hostName: 'Renan',
    members: 2,
    max: 8,
    invite: encodeInvite({
      version: 1,
      host,
      port: 50000,
      ...access,
      fingerprint: 'a'.repeat(64),
    }),
  };
}

async function scanUntil(
  scanner: DiscoveryScanner,
  predicate: (count: number) => boolean,
  timeout = 2000,
) {
  const end = Date.now() + timeout;
  let rooms = await scanner.scan();
  while (!predicate(rooms.length) && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    rooms = await scanner.scan();
  }
  return rooms;
}

test('broadcast and subnet helpers cover LAN and Radmin masks', () => {
  assert.equal(
    broadcastAddress('192.168.0.10', '255.255.255.0'),
    '192.168.0.255',
  );
  assert.equal(broadcastAddress('26.12.34.56', '255.0.0.0'), '26.255.255.255');
  assert.equal(broadcastAddress('10.1.2.3', '255.255.255.255'), null);
  assert.ok(sameSubnet('26.1.1.1', '26.200.3.4', '255.0.0.0'));
  assert.ok(!sameSubnet('192.168.1.2', '192.168.0.2', '255.255.255.0'));
  assert.deepEqual(
    probeTargets([
      { address: '192.168.0.10', netmask: '255.255.255.0' },
      { address: '192.168.0.11', netmask: '255.255.255.0' },
      { address: '26.12.34.56', netmask: '255.0.0.0' },
    ]),
    ['127.0.0.1', '192.168.0.255', '26.255.255.255'],
  );
});

test('discovery schemas validate probes and tolerate future fields', () => {
  assert.ok(
    !discoveryProbeSchema.safeParse({
      magic: DISCOVERY_MAGIC,
      v: 1,
      type: 'PROBE',
      nonce: 'short',
    }).success,
  );
  const parsed = discoveryAnnouncementSchema.safeParse({
    magic: DISCOVERY_MAGIC,
    v: 1,
    type: 'ROOM',
    nonce: 'a'.repeat(22),
    protocol: PROTOCOL_VERSION + 1,
    ...announcement(),
    future: true,
  });
  assert.ok(parsed.success);
  assert.ok(!('future' in parsed.data));
  const create = commandSchema.parse({
    type: 'CREATE_ROOM',
    name: 'Sala',
    address: '127.0.0.1',
    public: true,
  });
  assert.equal(create.type === 'CREATE_ROOM' && create.public, true);
});

test('scanner finds a public room and forgets it after it closes', async () => {
  const port = freshPort();
  const room = announcement();
  const responder = new DiscoveryResponder('127.0.0.1', () => room, port);
  const scanner = new DiscoveryScanner(port, () => ['127.0.0.1']);
  try {
    assert.ok(await responder.start());
    const rooms = await scanUntil(scanner, (count) => count > 0);
    assert.equal(rooms.length, 1);
    assert.deepEqual(rooms[0], { ...room, compatible: true });
    responder.close();
    assert.equal(scanner.list().length, 1);
  } finally {
    responder.close();
    scanner.close();
  }
});

test('scanner rejects invites pointing away from the responder', async () => {
  const port = freshPort();
  const responder = new DiscoveryResponder(
    '127.0.0.1',
    () => announcement('10.0.0.5'),
    port,
  );
  const scanner = new DiscoveryScanner(port, () => ['127.0.0.1']);
  try {
    assert.ok(await responder.start());
    const rooms = await scanUntil(scanner, () => false, 600);
    assert.equal(rooms.length, 0);
  } finally {
    responder.close();
    scanner.close();
  }
});

test('scanner ignores replies to probes it did not send', async () => {
  const port = freshPort();
  const fake = createSocket({ type: 'udp4' });
  await new Promise<void>((resolve) => fake.bind(port, '127.0.0.1', resolve));
  fake.on('message', (_message, remote) => {
    fake.send(
      JSON.stringify({
        magic: DISCOVERY_MAGIC,
        v: 1,
        type: 'ROOM',
        nonce: 'A'.repeat(22),
        protocol: PROTOCOL_VERSION,
        ...announcement(),
      }),
      remote.port,
      remote.address,
    );
  });
  const scanner = new DiscoveryScanner(port, () => ['127.0.0.1']);
  try {
    const rooms = await scanUntil(scanner, () => false, 600);
    assert.equal(rooms.length, 0);
  } finally {
    scanner.close();
    fake.close();
  }
});

test('incompatible rooms are listed without an invite', async () => {
  const port = freshPort();
  const fake = createSocket({ type: 'udp4' });
  await new Promise<void>((resolve) => fake.bind(port, '127.0.0.1', resolve));
  const roomId = randomUUID();
  fake.on('message', (message, remote) => {
    const probe = discoveryProbeSchema.parse(JSON.parse(message.toString()));
    fake.send(
      JSON.stringify({
        magic: DISCOVERY_MAGIC,
        v: 1,
        type: 'ROOM',
        nonce: probe.nonce,
        protocol: PROTOCOL_VERSION + 1,
        roomId,
        name: 'Sala nova',
        hostName: 'Ana',
        members: 1,
        max: 8,
        invite: 'PL99.xyz',
      }),
      remote.port,
      remote.address,
    );
  });
  const scanner = new DiscoveryScanner(port, () => ['127.0.0.1']);
  try {
    const rooms = await scanUntil(scanner, (count) => count > 0);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0]?.compatible, false);
    assert.equal(rooms[0]?.invite, '');
  } finally {
    scanner.close();
    fake.close();
  }
});

test('a LAN room does not answer probes from outside its subnet', async () => {
  const port = freshPort();
  const responder = new DiscoveryResponder(
    '192.168.50.10',
    () => announcement('192.168.50.10'),
    port,
    () => [{ address: '192.168.50.10', netmask: '255.255.255.0' }],
  );
  const scanner = new DiscoveryScanner(port, () => ['127.0.0.1']);
  try {
    assert.ok(await responder.start());
    const rooms = await scanUntil(scanner, () => false, 600);
    assert.equal(rooms.length, 0);
  } finally {
    responder.close();
    scanner.close();
  }
});
