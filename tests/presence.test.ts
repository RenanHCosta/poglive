import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:tls';
import type { TLSSocket } from 'node:tls';
import { RoomHost } from '../src/main/room/host';
import { RoomClient } from '../src/main/room/client';
import {
  ChatLog,
  HISTORY_TOTAL_BYTES,
  RateWindow,
} from '../src/main/room/chat';
import { decodeInvite } from '../src/main/room/invite';
import { TLS_OPTIONS } from '../src/main/transport/channel';
import { matchesCertificate } from '../src/main/transport/certificate';
import { networkMessageSchema } from '../src/shared/protocols/network';
import {
  chatTextSchema,
  CHAT_HISTORY_LIMIT,
  CHAT_LOG_LIMIT,
  roomEventSchema,
} from '../src/shared/schemas/chat';
import { commandSchema } from '../src/shared/schemas/room';
import type { ChatMessage } from '../src/shared/schemas/chat';

const identity = (displayName: string) => ({
  peerId: randomUUID(),
  displayName,
});
const voice = (overrides: Partial<Record<string, boolean>> = {}) => ({
  connected: true,
  muted: false,
  deafened: false,
  streaming: false,
  ...overrides,
});
async function until(predicate: () => boolean, timeout = 3000): Promise<void> {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('State transition timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('voice presence is bound to the authenticated member and broadcast', async () => {
  const hostIdentity = identity('Host');
  let hostChanges = 0;
  const host = new RoomHost(hostIdentity, 'Voz', () => {}, undefined, {
    onChange: () => hostChanges++,
  });
  let bChanges = 0;
  const b = new RoomClient({ onChange: () => bChanges++ });
  const c = new RoomClient();
  try {
    await host.listen('127.0.0.1');
    const invite = decodeInvite(host.invite);
    const bIdentity = identity('B');
    const cIdentity = identity('C');
    await b.join(invite, bIdentity, () => {});
    await c.join(invite, cIdentity, () => {});
    for (const participant of host.snapshot().participants)
      assert.equal(participant.voice.connected, false);

    b.updateVoice(voice({ muted: true }));
    await until(
      () =>
        c.room?.participants.find((peer) => peer.peerId === bIdentity.peerId)
          ?.voice.muted === true,
    );
    const seenByHost = host
      .snapshot()
      .participants.find((peer) => peer.peerId === bIdentity.peerId);
    assert.deepEqual(seenByHost?.voice, voice({ muted: true }));
    // A member can never change somebody else's presence.
    assert.equal(
      host
        .snapshot()
        .participants.find((peer) => peer.peerId === cIdentity.peerId)?.voice
        .connected,
      false,
    );

    host.updateVoice(voice({ streaming: true }));
    await until(
      () =>
        b.room?.participants.find((peer) => peer.role === 'HOST')?.voice
          .streaming === true,
    );
    assert.ok(hostChanges > 0);
    assert.ok(bChanges > 0);

    // Identical updates are ignored instead of rebroadcast.
    const before = bChanges;
    host.updateVoice(voice({ streaming: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(bChanges, before);
  } finally {
    b.close();
    c.close();
    await host.close();
  }
});

test('chat is stamped by the host, relayed to everyone and replayed on join', async () => {
  const hostIdentity = identity('Host');
  const hostSeen: ChatMessage[] = [];
  const host = new RoomHost(hostIdentity, 'Chat', () => {}, undefined, {
    onChat: (message) => hostSeen.push(message),
  });
  const bSeen: ChatMessage[] = [];
  const b = new RoomClient({ onChat: (message) => bSeen.push(message) });
  const late = new RoomClient();
  try {
    await host.listen('127.0.0.1');
    const invite = decodeInvite(host.invite);
    const bIdentity = identity('Bea');
    await b.join(invite, bIdentity, () => {});

    const first = randomUUID();
    b.sendChat(first, 'olá **sala**');
    await until(() => hostSeen.length === 1 && bSeen.length === 1);
    assert.equal(hostSeen[0]?.authorId, bIdentity.peerId);
    assert.equal(hostSeen[0]?.authorName, 'Bea');
    assert.equal(bSeen[0]?.id, first);

    host.sendChat(randomUUID(), 'resposta do host');
    await until(() => bSeen.length === 2);
    assert.equal(bSeen[1]?.authorId, hostIdentity.peerId);
    assert.ok((bSeen[1]?.sentAt ?? 0) > (bSeen[0]?.sentAt ?? 0));

    // Replaying an ID does not duplicate the message.
    b.sendChat(first, 'repetida');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(host.chatHistory().length, 2);

    await late.join(invite, identity('Late'), () => {});
    await until(() => late.chatHistory().length === 2);
    assert.deepEqual(
      late.chatHistory().map((message) => message.text),
      ['olá **sala**', 'resposta do host'],
    );
  } finally {
    b.close();
    late.close();
    await host.close();
  }
});

test('chat flood is rejected per member without closing the connection', async () => {
  const host = new RoomHost(identity('Host'), 'Flood', () => {});
  const rejected: string[] = [];
  const delivered: ChatMessage[] = [];
  const b = new RoomClient({
    onChat: (message) => delivered.push(message),
    onChatRejected: (id) => rejected.push(id),
  });
  try {
    await host.listen('127.0.0.1');
    await b.join(decodeInvite(host.invite), identity('Flood'), () => {});
    const ids = Array.from({ length: 7 }, () => randomUUID());
    for (const id of ids) b.sendChat(id, 'spam');
    await until(() => delivered.length + rejected.length === 7);
    assert.equal(delivered.length, 5);
    assert.deepEqual(rejected, ids.slice(5));
    assert.equal(host.snapshot().participants.length, 2);
  } finally {
    b.close();
    await host.close();
  }
});

test('presence bursts are coalesced and only abuse disconnects', async () => {
  const host = new RoomHost(identity('Host'), 'Abuse', () => {});
  let honestDisconnected = false;
  let abuserDisconnected = false;
  const honest = new RoomClient();
  const abuser = new RoomClient();
  try {
    await host.listen('127.0.0.1');
    const invite = decodeInvite(host.invite);
    const honestIdentity = identity('Rápido');
    await honest.join(invite, honestIdentity, () => {
      honestDisconnected = true;
    });
    await abuser.join(invite, identity('Abuser'), () => {
      abuserDisconnected = true;
    });
    // Fast toggling stays connected and converges on the last state.
    for (let index = 0; index < 25; index++)
      honest.updateVoice(voice({ muted: index % 2 === 0 }));
    await until(
      () =>
        host
          .snapshot()
          .participants.find((peer) => peer.peerId === honestIdentity.peerId)
          ?.voice.muted === true,
      2500,
    );
    assert.equal(honestDisconnected, false);
    for (let index = 0; index < 80; index++)
      abuser.updateVoice(voice({ muted: index % 2 === 0 }));
    await until(() => abuserDisconnected);
    await until(() => host.snapshot().participants.length === 2);
    assert.equal(honestDisconnected, false);
  } finally {
    honest.close();
    abuser.close();
    await host.close();
  }
});

test('retrying a delivered message confirms it without posting twice', async () => {
  const host = new RoomHost(identity('Host'), 'Retry', () => {});
  const seen: ChatMessage[] = [];
  const other: ChatMessage[] = [];
  const author = new RoomClient({ onChat: (message) => seen.push(message) });
  const watcher = new RoomClient({ onChat: (message) => other.push(message) });
  try {
    await host.listen('127.0.0.1');
    const invite = decodeInvite(host.invite);
    await author.join(invite, identity('Autor'), () => {});
    await watcher.join(invite, identity('Leitor'), () => {});
    const id = randomUUID();
    author.sendChat(id, 'uma vez');
    await until(() => other.length === 1);
    author.sendChat(id, 'uma vez');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(other.length, 1);
    assert.equal(host.chatHistory().length, 1);
    assert.equal(seen.length, 1);
  } finally {
    author.close();
    watcher.close();
    await host.close();
  }
});

test('members cannot send host-only messages', async () => {
  const host = new RoomHost(identity('Host'), 'Authority', () => {});
  let socket: TLSSocket | undefined;
  try {
    await host.listen('127.0.0.1');
    const invite = decodeInvite(host.invite);
    socket = await new Promise<TLSSocket>((resolve, reject) => {
      const value = connect(
        {
          ...TLS_OPTIONS,
          host: invite.host,
          port: invite.port,
          rejectUnauthorized: false,
        },
        () => {
          if (matchesCertificate(value, invite.fingerprint)) resolve(value);
          else reject(new Error('Pin mismatch'));
        },
      );
      value.once('error', reject);
    });
    const send = (message: unknown) => {
      const data = Buffer.from(JSON.stringify(message));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(data.length);
      socket?.write(Buffer.concat([header, data]));
    };
    socket.resume();
    const memberIdentity = identity('Forger');
    send({
      version: 2,
      type: 'ROOM_JOIN',
      roomId: invite.roomId,
      identity: memberIdentity,
      secret: invite.secret,
    });
    await until(() => host.snapshot().participants.length === 2);
    send({
      version: 2,
      type: 'CHAT_MESSAGE',
      message: {
        id: randomUUID(),
        authorId: host.snapshot().hostPeerId,
        authorName: 'Host',
        text: 'forjada',
        sentAt: 1,
      },
    });
    await until(() => socket?.destroyed === true);
    assert.equal(host.chatHistory().length, 0);
  } finally {
    socket?.destroy();
    await host.close();
  }
});

test('chat log is bounded and history batches fit the transport frame', () => {
  const now = 1000;
  const log = new ChatLog(() => now);
  const author = identity('Autor');
  for (let index = 0; index < CHAT_LOG_LIMIT + 20; index++) {
    log.append(author, randomUUID(), 'x'.repeat(2000));
  }
  const messages = log.messages();
  assert.equal(messages.length, CHAT_LOG_LIMIT);
  for (let index = 1; index < messages.length; index++)
    assert.ok(messages[index]!.sentAt > messages[index - 1]!.sentAt);
  const batches = log.historyBatches();
  const history = batches.flat();
  assert.ok(history.length > 0 && history.length <= CHAT_HISTORY_LIMIT);
  // The newest messages are kept, oldest first, within the byte budget.
  assert.equal(
    history[history.length - 1]?.id,
    messages[messages.length - 1]?.id,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(history)) <= HISTORY_TOTAL_BYTES);
  const small = new ChatLog();
  for (let index = 0; index < 150; index++)
    small.append(author, randomUUID(), `mensagem ${index}`);
  assert.equal(small.historyBatches().flat().length, CHAT_HISTORY_LIMIT);
  for (const batch of batches) {
    const frame = JSON.stringify({
      version: 2,
      type: 'CHAT_HISTORY',
      messages: batch,
    });
    assert.ok(Buffer.byteLength(frame) < 65536);
    assert.equal(
      networkMessageSchema.safeParse(JSON.parse(frame)).success,
      true,
    );
  }
});

test('rate window allows bursts up to the limit and recovers', () => {
  let now = 0;
  const window = new RateWindow(2, 1000, () => now);
  assert.equal(window.take(), true);
  assert.equal(window.take(), true);
  assert.equal(window.take(), false);
  now = 999;
  assert.equal(window.take(), false);
  now = 1000;
  assert.equal(window.take(), true);
});

test('chat text rejects disguising characters but keeps emoji sequences', () => {
  assert.equal(chatTextSchema.safeParse('linha 1\nlinha 2').success, true);
  assert.equal(chatTextSchema.safeParse('família 👨‍👩‍👧').success, true);
  assert.equal(chatTextSchema.safeParse('   \n ').success, false);
  assert.equal(chatTextSchema.safeParse('abc‮def').success, false);
  assert.equal(chatTextSchema.safeParse('bell\u0007').success, false);
  assert.equal(chatTextSchema.safeParse('x'.repeat(2001)).success, false);
  assert.equal(
    commandSchema.safeParse({
      type: 'SEND_CHAT',
      id: randomUUID(),
      text: 'oi',
      authorId: randomUUID(),
    }).success,
    false,
  );
  assert.equal(
    roomEventSchema.safeParse({ type: 'STATE', extra: true }).success,
    false,
  );
});

test('legacy invitations explain that the host must update', () => {
  assert.throws(
    () => decodeInvite(`PL1.${'A'.repeat(94)}`),
    /versão anterior do Poglive/,
  );
  assert.throws(() => decodeInvite('VS1.abc'), /versão anterior do Poglive/);
  assert.throws(() => decodeInvite('PL3.abc'), /inválido/);
});
