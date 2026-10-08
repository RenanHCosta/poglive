import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebmClipBuffer } from '../src/renderer/services/clips/webm';

// Minimal EBML writer for synthetic MediaRecorder-like streams.
function id(value: number): number[] {
  const bytes: number[] = [];
  for (let rest = value; rest > 0; rest = Math.floor(rest / 256))
    bytes.unshift(rest % 256);
  return bytes;
}
function size(value: number): number[] {
  if (value < 0x7f) return [0x80 | value];
  return [0x40 | (value >> 8), value & 0xff];
}
function element(elementId: number, payload: number[]): number[] {
  return [...id(elementId), ...size(payload.length), ...payload];
}
function uint(elementId: number, value: number): number[] {
  const payload: number[] = [];
  for (let rest = value; ; rest = Math.floor(rest / 256)) {
    payload.unshift(rest % 256);
    if (rest < 256) break;
  }
  return element(elementId, payload);
}
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

function header(): number[] {
  return [
    ...element(0x1a45dfa3, uint(0x4286, 1)),
    ...id(0x18538067),
    ...UNKNOWN,
    ...element(0x1549a966, uint(0x2ad7b1, 1_000_000)),
    ...element(0x1654ae6b, [
      ...element(0xae, [...uint(0xd7, 1), ...uint(0x83, 1)]),
      ...element(0xae, [...uint(0xd7, 2), ...uint(0x83, 2)]),
    ]),
  ];
}
function block(track: number, relative: number, flags: number): number[] {
  return [0x80 | track, (relative >> 8) & 0xff, relative & 0xff, flags, 0x42];
}
function simple(track: number, relative: number, key: boolean): number[] {
  return element(0xa3, block(track, relative, key ? 0x80 : 0));
}
function group(relative: number, key: boolean): number[] {
  return element(0xa0, [
    ...element(0xa1, block(1, relative, 0)),
    ...(key ? [] : element(0xfb, [0xff])),
  ]);
}
/** One cluster per second; video every 100 ms, keyframe at second starts. */
function cluster(second: number, keyAt: number[]): number[] {
  const children: number[] = [];
  for (let ms = 0; ms < 1000; ms += 100) {
    children.push(...simple(2, ms, true));
    children.push(
      ...(ms % 200
        ? group(ms, keyAt.includes(ms))
        : simple(1, ms, keyAt.includes(ms))),
    );
  }
  return [
    ...id(0x1f43b675),
    ...UNKNOWN,
    ...uint(0xe7, second * 1000),
    ...children,
  ];
}

function stream(seconds: number): Uint8Array {
  const bytes = [...header()];
  for (let second = 0; second < seconds; second++)
    bytes.push(...cluster(second, [0, 500]));
  return Uint8Array.from(bytes);
}

function clusterTimecodes(file: Uint8Array): number[] {
  const parsed = new WebmClipBuffer(1e9);
  parsed.push(file);
  const times: number[] = [];
  // Read cluster timecodes straight from the bytes.
  for (let index = 0; index + 4 < file.length; index++)
    if (
      file[index] === 0x1f &&
      file[index + 1] === 0x43 &&
      file[index + 2] === 0xb6 &&
      file[index + 3] === 0x75 &&
      file[index + 12] === 0xe7
    ) {
      const length = file[index + 13]! & 0x7f;
      let value = 0;
      for (let k = 0; k < length; k++)
        value = value * 256 + file[index + 14 + k]!;
      times.push(value);
    }
  assert.equal(parsed.failed, false);
  return times;
}

test('chunk boundaries do not change the parsed stream', () => {
  const data = stream(6);
  const whole = new WebmClipBuffer(60_000);
  whole.push(data);
  const pieces = new WebmClipBuffer(60_000);
  for (let offset = 0; offset < data.length; offset += 7)
    pieces.push(data.slice(offset, offset + 7));
  assert.equal(pieces.failed, false);
  assert.equal(pieces.bufferedMs(), whole.bufferedMs());
  assert.deepEqual(pieces.clip(2000), whole.clip(2000));
});

test('clips start at a keyframe before the cutoff with rebased timecodes', () => {
  const buffer = new WebmClipBuffer(60_000);
  buffer.push(stream(6));
  // Latest media is at 5900 ms; a 2 s clip needs a keyframe at or before 3900.
  const clip = buffer.clip(2000);
  assert.ok(clip);
  const times = clusterTimecodes(clip);
  assert.equal(times[0], 0);
  // Keyframe at 3500 → clusters rebased from 3000: 0, 1000, 2000.
  assert.deepEqual(times, [0, 1000, 2000]);
  const reparsed = new WebmClipBuffer(60_000);
  reparsed.push(clip);
  // Starts mid-cluster at 3500: covers 3500..5900.
  assert.ok(reparsed.bufferedMs() >= 2000);
  // The header is preserved verbatim.
  assert.deepEqual(clip.slice(0, header().length), Uint8Array.from(header()));
});

test('memory is bounded to the retention window', () => {
  const buffer = new WebmClipBuffer(3000);
  buffer.push(stream(20));
  assert.ok(buffer.bufferedMs() <= 5000, String(buffer.bufferedMs()));
  assert.ok(buffer.clip(3000));
});

test('no clip before a keyframe arrives and corrupt input fails closed', () => {
  const empty = new WebmClipBuffer(60_000);
  empty.push(Uint8Array.from(header()));
  assert.equal(empty.clip(1000), null);
  const garbage = new WebmClipBuffer(60_000);
  garbage.push(
    Uint8Array.from([
      0x1a, 0x45, 0xdf, 0xa3, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ]),
  );
  assert.equal(garbage.failed, true);
  assert.equal(garbage.clip(1000), null);
});
