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
  captureOptionsSchema,
  processAudioTargetSchema,
} from '../src/shared/schemas/capture';
import { mediaMessageSchema } from '../src/shared/protocols/media';
import {
  applyVideoQuality,
  evaluateQuality,
  initialQualityState,
  QUALITY_TIERS,
  qualityLadder,
} from '../src/renderer/services/adaptiveQuality';
import { collectMediaStats } from '../src/renderer/services/mediaStats';
import {
  matchesCertificate,
  createCertificate,
} from '../src/main/transport/certificate';
import { updateStateSchema } from '../src/shared/schemas/update';

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
  const directory = await mkdtemp(join(tmpdir(), 'poglive-test-'));
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
    captureOptionsSchema.safeParse({
      quality: '720p',
      frameRate: 30,
      adaptiveQuality: true,
      audioMode: 'SYSTEM_EXCEPT_DISCORD',
    }).success,
    true,
  );
  assert.equal(
    processAudioTargetSchema.safeParse({
      mode: 'SYSTEM_EXCEPT_DISCORD',
      sourceId: 'not-allowed',
    }).success,
    false,
  );
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

test('adaptive video quality degrades quickly and recovers with hysteresis', () => {
  const options = captureOptionsSchema.parse({
    quality: '1080p',
    frameRate: 60,
    adaptiveQuality: true,
    audioMode: 'NONE',
  });
  const ladder = qualityLadder(options);
  assert.deepEqual(
    ladder.map((tier) => tier.id),
    ['1080p60', '1080p30', '720p30', '540p30', '540p15'],
  );
  const bad = {
    receiver: {
      version: 1 as const,
      type: 'QUALITY_REPORT' as const,
      streamId: randomUUID(),
      lossRatio: 0.08,
      droppedRatio: 0,
      jitterMs: 100,
      jitterBufferMs: 80,
      roundTripMs: 100,
      framesPerSecond: 60,
      frameWidth: 1920,
      frameHeight: 1080,
      freezes: 0,
      stalled: false,
    },
    qualityLimitationReason: 'bandwidth' as const,
    availableOutgoingBitrate: 4_000_000,
    roundTripMs: 100,
  };
  let state = initialQualityState();
  state = evaluateQuality(state, ladder, bad);
  assert.equal(state.level, 0);
  state = evaluateQuality(state, ladder, bad);
  assert.equal(state.level, 1);
  assert.equal(state.reason, 'NETWORK');

  const stable = {
    receiver: {
      ...bad.receiver,
      lossRatio: 0,
      jitterMs: 5,
      framesPerSecond: 30,
    },
    qualityLimitationReason: 'none' as const,
    availableOutgoingBitrate: 15_000_000,
    roundTripMs: 40,
  };
  for (let index = 0; index < 9; index++)
    state = evaluateQuality(state, ladder, stable);
  assert.equal(state.level, 1);
  state = evaluateQuality(state, ladder, stable);
  assert.equal(state.level, 0);
  assert.equal(state.reason, 'STABLE');
});

test('quality telemetry messages are bounded and strictly validated', () => {
  const valid = {
    version: 1,
    type: 'QUALITY_REPORT',
    streamId: randomUUID(),
    lossRatio: 0.02,
    droppedRatio: 0.01,
    jitterMs: 12,
    jitterBufferMs: 35,
    roundTripMs: 50,
    framesPerSecond: 30,
    frameWidth: 1280,
    frameHeight: 720,
    freezes: 0,
    stalled: false,
  };
  assert.equal(mediaMessageSchema.safeParse(valid).success, true);
  assert.equal(
    mediaMessageSchema.safeParse({ ...valid, lossRatio: 2 }).success,
    false,
  );
  assert.equal(
    mediaMessageSchema.safeParse({ ...valid, extra: 'not-allowed' }).success,
    false,
  );
});

test('video sender tiers lower and restore per-peer encoding limits', async () => {
  const encoding: RTCRtpEncodingParameters = {};
  const parameters = { encodings: [encoding] } as RTCRtpSendParameters;
  const sender = {
    getParameters: () => parameters,
    setParameters: async () => undefined,
  } as unknown as RTCRtpSender;
  const track = {
    getSettings: () => ({ height: 1080 }),
  } as unknown as MediaStreamTrack;

  await applyVideoQuality(sender, track, QUALITY_TIERS['720p30']);
  assert.equal(encoding.maxBitrate, 2_500_000);
  assert.equal(encoding.maxFramerate, 30);
  assert.equal(encoding.scaleResolutionDownBy, 1.5);

  await applyVideoQuality(sender, track, QUALITY_TIERS['1080p60']);
  assert.equal(encoding.maxBitrate, 10_000_000);
  assert.equal(encoding.maxFramerate, 60);
  assert.equal(encoding.scaleResolutionDownBy, 1);
});

test('WebRTC stats are converted into interval quality metrics', () => {
  const createStats = (inbound: Record<string, unknown>): RTCStatsReport =>
    new Map<string, Record<string, unknown>>([
      [
        'inbound',
        { id: 'inbound', type: 'inbound-rtp', kind: 'video', ...inbound },
      ],
      [
        'outbound',
        {
          id: 'outbound',
          type: 'outbound-rtp',
          kind: 'video',
          qualityLimitationReason: 'bandwidth',
        },
      ],
      [
        'remote-inbound',
        {
          id: 'remote-inbound',
          type: 'remote-inbound-rtp',
          kind: 'video',
          roundTripTime: 0.04,
        },
      ],
      [
        'transport',
        {
          id: 'transport',
          type: 'transport',
          selectedCandidatePairId: 'candidate',
        },
      ],
      [
        'candidate',
        {
          id: 'candidate',
          type: 'candidate-pair',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.05,
          availableOutgoingBitrate: 2_000_000,
        },
      ],
    ]) as unknown as RTCStatsReport;
  const first = collectMediaStats(
    createStats({
      packetsReceived: 100,
      packetsLost: 5,
      framesDecoded: 100,
      framesDropped: 2,
      freezeCount: 0,
      bytesReceived: 1000,
      jitter: 0.012,
      jitterBufferDelay: 5,
      jitterBufferEmittedCount: 100,
      framesPerSecond: 30,
      frameWidth: 1280,
      frameHeight: 720,
    }),
    null,
  );
  const second = collectMediaStats(
    createStats({
      packetsReceived: 198,
      packetsLost: 7,
      framesDecoded: 158,
      framesDropped: 4,
      freezeCount: 1,
      bytesReceived: 2000,
      jitter: 0.012,
      jitterBufferDelay: 8,
      jitterBufferEmittedCount: 160,
      framesPerSecond: 29,
      frameWidth: 1280,
      frameHeight: 720,
    }),
    first.snapshot,
  );
  assert.ok(second.report);
  assert.equal(second.report.lossRatio, 0.02);
  assert.ok(Math.abs((second.report.droppedRatio ?? 0) - 2 / 60) < 0.001);
  assert.equal(second.report.jitterMs, 12);
  assert.equal(second.report.jitterBufferMs, 50);
  assert.equal(second.report.roundTripMs, 50);
  assert.equal(second.report.freezes, 1);
  assert.equal(second.report.stalled, false);
  assert.equal(second.sender.qualityLimitationReason, 'bandwidth');
  assert.equal(second.sender.availableOutgoingBitrate, 2_000_000);
  assert.equal(second.sender.roundTripMs, 40);
});

test('update states accept bounded progress and reject untrusted fields', () => {
  assert.equal(
    updateStateSchema.safeParse({
      status: 'DOWNLOADING',
      version: '0.2.0',
      percent: 42.5,
    }).success,
    true,
  );
  assert.equal(
    updateStateSchema.safeParse({
      status: 'DOWNLOADING',
      version: '0.2.0',
      percent: 101,
    }).success,
    false,
  );
  assert.equal(
    updateStateSchema.safeParse({
      status: 'READY',
      version: '0.2.0',
      downloadedFile: 'C:\\private\\update.exe',
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
