import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:tls';
import type { TLSSocket } from 'node:tls';
import { RoomHost } from '../src/main/room/host';
import { RoomClient } from '../src/main/room/client';
import { decodeInvite } from '../src/main/room/invite';
import { TLS_OPTIONS } from '../src/main/transport/channel';
import { matchesCertificate } from '../src/main/transport/certificate';
import { networkMessageSchema } from '../src/shared/protocols/network';
import { previewImageSchema } from '../src/shared/schemas/chat';
import type { ChatMessage } from '../src/shared/schemas/chat';

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
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('replies, edits and deletes follow authorship and host moderation', async () => {
  const hostSaw: { updated: ChatMessage[]; deleted: string[] } = {
    updated: [],
    deleted: [],
  };
  const host = new RoomHost(identity('Host'), 'Chat v3', () => {}, undefined, {
    onChatUpdated: (message) => hostSaw.updated.push(message),
    onChatDeleted: (id) => hostSaw.deleted.push(id),
  });
  const bSeen: ChatMessage[] = [];
  const bDeleted: string[] = [];
  const b = new RoomClient({
    onChat: (message) => bSeen.push(message),
    onChatDeleted: (id) => bDeleted.push(id),
  });
  const c = new RoomClient();
  try {
    await host.listen('127.0.0.1');
    const invite = decodeInvite(host.invite);
    const bIdentity = identity('Bea');
    await b.join(invite, bIdentity, () => {});
    await c.join(invite, identity('Caio'), () => {});
    const original = randomUUID();
    b.sendChat(original, 'primeira');
    await until(() => bSeen.length === 1);
    const reply = randomUUID();
    c.sendChat(reply, 'respondendo', original);
    const orphan = randomUUID();
    c.sendChat(orphan, 'sem pai', randomUUID());
    await until(() => bSeen.length === 3);
    assert.equal(bSeen[1]?.replyTo, original);
    // A reply to an unknown message degrades to a plain message.
    assert.equal(bSeen[2]?.replyTo, null);

    // Someone else cannot edit or delete Bea's message.
    c.editChat(original, 'forjada');
    c.deleteChat(original);
    await pause(150);
    assert.equal(hostSaw.updated.length, 0);
    assert.equal(hostSaw.deleted.length, 0);

    b.editChat(original, 'primeira (corrigida)');
    await until(() => hostSaw.updated.length === 1);
    assert.equal(hostSaw.updated[0]?.text, 'primeira (corrigida)');
    assert.ok(hostSaw.updated[0]?.editedAt);
    await until(() =>
      c.chatHistory().some((m) => m.text === 'primeira (corrigida)'),
    );

    // The host moderates anyone's message.
    host.deleteChat(reply);
    await until(() => bDeleted.includes(reply));
    assert.equal(
      host.chatHistory().some((m) => m.id === reply),
      false,
    );
    b.deleteChat(original);
    await until(() => bDeleted.includes(original));
    assert.equal(
      c.chatHistory().some((m) => m.id === original),
      false,
    );
  } finally {
    b.close();
    c.close();
    await host.close();
  }
});

test('reactions reach everyone else, are whitelisted and rate limited', async () => {
  const hostIdentity = identity('Host');
  const hostSaw: string[] = [];
  const host = new RoomHost(hostIdentity, 'Reações', () => {}, undefined, {
    onReaction: (_from, _target, emoji) => hostSaw.push(emoji),
  });
  const senderSaw: string[] = [];
  const watcherSaw: string[] = [];
  const sender = new RoomClient({
    onReaction: (_f, _t, e) => senderSaw.push(e),
  });
  const watcher = new RoomClient({
    onReaction: (_f, _t, e) => watcherSaw.push(e),
  });
  try {
    await host.listen('127.0.0.1');
    const invite = decodeInvite(host.invite);
    await sender.join(invite, identity('Fã'), () => {});
    await watcher.join(invite, identity('Outro'), () => {});
    for (let index = 0; index < 12; index++)
      sender.react(hostIdentity.peerId, '🔥');
    await until(() => watcherSaw.length === 8);
    await pause(150);
    assert.equal(watcherSaw.length, 8);
    assert.equal(hostSaw.length, 8);
    assert.equal(senderSaw.length, 0);
    // Targets must be in the room.
    sender.react(randomUUID(), '🔥');
    await pause(100);
    assert.equal(watcherSaw.length, 8);
    assert.equal(
      networkMessageSchema.safeParse({
        version: 3,
        type: 'REACT',
        targetPeerId: randomUUID(),
        emoji: '💩',
      }).success,
      false,
    );
  } finally {
    sender.close();
    watcher.close();
    await host.close();
  }
});

test('stream previews are relayed with the sender identity', async () => {
  const image = `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`;
  assert.equal(previewImageSchema.safeParse(image).success, true);
  assert.equal(
    previewImageSchema.safeParse('data:image/svg+xml;base64,PHN2Zz4=').success,
    false,
  );
  const host = new RoomHost(identity('Host'), 'Prévia', () => {});
  const previews: [string, string | null][] = [];
  const streamer = new RoomClient();
  const viewer = new RoomClient({
    onPreview: (peerId, value) => previews.push([peerId, value]),
  });
  try {
    await host.listen('127.0.0.1');
    const invite = decodeInvite(host.invite);
    const streamerIdentity = identity('Streamer');
    await streamer.join(invite, streamerIdentity, () => {});
    await viewer.join(invite, identity('Viewer'), () => {});
    streamer.setPreview(image);
    streamer.setPreview(image); // Inside the rate window: dropped.
    await until(() => previews.length === 1);
    assert.deepEqual(previews[0], [streamerIdentity.peerId, image]);
    await pause(150);
    assert.equal(previews.length, 1);
  } finally {
    streamer.close();
    viewer.close();
    await host.close();
  }
});

test('kicked members are disconnected and cannot rejoin', async () => {
  const host = new RoomHost(identity('Host'), 'Moderação', () => {});
  const target = new RoomClient();
  const again = new RoomClient();
  let disconnected = false;
  try {
    await host.listen('127.0.0.1');
    const invite = decodeInvite(host.invite);
    const targetIdentity = identity('Chato');
    await target.join(invite, targetIdentity, () => {
      disconnected = true;
    });
    assert.equal(host.kick(randomUUID()), false);
    assert.equal(host.kick(targetIdentity.peerId), true);
    await until(() => disconnected);
    assert.equal(target.kicked, true);
    await until(() => host.snapshot().participants.length === 1);
    await assert.rejects(
      again.join(invite, targetIdentity, () => {}),
      /removido/,
    );
  } finally {
    target.close();
    again.close();
    await host.close();
  }
});

test('unknown message types from newer builds are ignored, not fatal', async () => {
  const host = new RoomHost(identity('Host'), 'Futuro', () => {});
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
    send({
      version: 3,
      type: 'ROOM_JOIN',
      roomId: invite.roomId,
      identity: identity('Futurista'),
      secret: invite.secret,
    });
    await until(() => host.snapshot().participants.length === 2);
    send({ version: 3, type: 'HOLOGRAM_CALL', anything: true });
    await pause(200);
    assert.equal(socket.destroyed, false);
    assert.equal(host.snapshot().participants.length, 2);
    // A known type with a bad shape is still a protocol violation.
    send({ version: 3, type: 'CHAT_SEND', id: 'x' });
    await until(() => socket?.destroyed === true);
  } finally {
    socket?.destroy();
    await host.close();
  }
});
