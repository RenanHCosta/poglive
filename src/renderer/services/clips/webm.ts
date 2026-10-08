/**
 * Rolling WebM buffer for clips. MediaRecorder emits one endless live WebM
 * (Segment and Clusters of unknown size). This parser keeps the header and
 * the most recent clusters, and can cut a standalone file that starts at a
 * video keyframe with timecodes rebased to zero.
 */

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Cluster: 0x1f43b675,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ReferenceBlock: 0xfb,
} as const;

// Elements that end a cluster of unknown size when they appear.
const SEGMENT_LEVEL = new Set<number>([
  ID.Cluster,
  ID.Info,
  ID.Tracks,
  0x1c53bb6b, // Cues
  0x1254c367, // Tags
  0x114d9b74, // SeekHead
  0x1941a469, // Attachments
  0x1043a770, // Chapters
]);

const MAX_ELEMENT_BYTES = 32 * 1024 * 1024;

interface VInt {
  value: number;
  length: number;
  unknown: boolean;
}

/** Reads an EBML variable-length integer; `raw` keeps the marker (IDs). */
function readVInt(
  bytes: Uint8Array,
  offset: number,
  raw: boolean,
): VInt | null {
  const first = bytes[offset];
  if (first === undefined) return null;
  let length = 1;
  let marker = 0x80;
  while (length <= 8 && !(first & marker)) {
    marker >>= 1;
    length++;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  let value = raw ? first : first & (marker - 1);
  let allOnes = (first & (marker - 1)) === marker - 1;
  for (let index = 1; index < length; index++) {
    const byte = bytes[offset + index]!;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !raw && allOnes };
}

function readUint(bytes: Uint8Array): number {
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return value;
}

function encodeUintElement(id: number, value: number): Uint8Array {
  const payload: number[] = [];
  let rest = Math.max(0, Math.floor(value));
  do {
    payload.unshift(rest % 256);
    rest = Math.floor(rest / 256);
  } while (rest > 0);
  return Uint8Array.from([...encodeId(id), 0x80 | payload.length, ...payload]);
}

function encodeId(id: number): number[] {
  const bytes: number[] = [];
  let rest = id;
  while (rest > 0) {
    bytes.unshift(rest % 256);
    rest = Math.floor(rest / 256);
  }
  return bytes;
}

const CLUSTER_UNKNOWN = Uint8Array.from([
  0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
]);

type BlockKind = 'videoKey' | 'video' | 'audio' | 'other';

interface Child {
  bytes: Uint8Array;
  kind: BlockKind;
  relative: number;
}

interface Cluster {
  timecode: number;
  children: Child[];
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export class WebmClipBuffer {
  private pending: Uint8Array = new Uint8Array(0);
  private header: Uint8Array[] = [];
  private stage: 'HEADER' | 'SEGMENT' | 'CLUSTER' = 'HEADER';
  private readonly trackTypes = new Map<number, number>();
  private timecodeScaleNs = 1_000_000;
  private readonly clusters: Cluster[] = [];
  private current: Cluster | null = null;
  private broken = false;

  /** `retainMs`: how much recent media to keep in memory. */
  constructor(private readonly retainMs: number) {}

  get failed(): boolean {
    return this.broken;
  }

  push(chunk: Uint8Array): void {
    if (this.broken) return;
    this.pending = this.pending.length ? concat([this.pending, chunk]) : chunk;
    try {
      this.parse();
    } catch {
      this.broken = true;
      this.pending = new Uint8Array(0);
    }
    this.trim();
  }

  /** Duration of buffered media, in ms. */
  bufferedMs(): number {
    const clusters = this.all();
    const first = clusters[0];
    const last = this.latestTime();
    return first && last !== null ? last - this.toMs(first.timecode) : 0;
  }

  /**
   * A standalone WebM with the last `durationMs`, starting at a video
   * keyframe; null when no keyframe is buffered yet.
   */
  clip(durationMs: number): Uint8Array | null {
    const latest = this.latestTime();
    if (latest === null || !this.header.length) return null;
    const clusters = this.all();
    const cutoff = latest - durationMs;
    // Start at the last keyframe at or before the cutoff so the clip is at
    // least as long as requested; with nothing that old, use the first one.
    let before: { cluster: number; child: number } | null = null;
    let after: { cluster: number; child: number } | null = null;
    for (const [clusterIndex, cluster] of clusters.entries())
      for (const [childIndex, child] of cluster.children.entries()) {
        if (child.kind !== 'videoKey') continue;
        const time = this.toMs(cluster.timecode + child.relative);
        if (time <= cutoff)
          before = { cluster: clusterIndex, child: childIndex };
        else after ??= { cluster: clusterIndex, child: childIndex };
      }
    const from = before ?? after;
    if (!from) return null;
    const base = clusters[from.cluster]!.timecode;
    const parts: Uint8Array[] = [...this.header];
    for (let index = from.cluster; index < clusters.length; index++) {
      const cluster = clusters[index]!;
      const children =
        index === from.cluster
          ? cluster.children.slice(from.child)
          : cluster.children;
      if (!children.length) continue;
      parts.push(
        CLUSTER_UNKNOWN,
        encodeUintElement(ID.Timecode, cluster.timecode - base),
      );
      for (const child of children) parts.push(child.bytes);
    }
    return concat(parts);
  }

  private toMs(timecode: number): number {
    return (timecode * this.timecodeScaleNs) / 1_000_000;
  }

  /** Closed clusters plus the one still being written. */
  private all(): Cluster[] {
    return this.current?.children.length
      ? [...this.clusters, this.current]
      : this.clusters;
  }

  private latestTime(): number | null {
    const clusters = this.all();
    for (let index = clusters.length - 1; index >= 0; index--) {
      const cluster = clusters[index]!;
      const last = cluster.children[cluster.children.length - 1];
      if (last) return this.toMs(cluster.timecode + last.relative);
    }
    return null;
  }

  private trim(): void {
    const latest = this.latestTime();
    if (latest === null) return;
    // Keep whole clusters newer than the window plus one keyframe before it.
    while (this.clusters.length > 2) {
      const second = this.clusters[1]!;
      if (latest - this.toMs(second.timecode) <= this.retainMs) break;
      const hasKeyAfter = this.clusters
        .slice(1)
        .some((cluster) =>
          cluster.children.some((child) => child.kind === 'videoKey'),
        );
      if (!hasKeyAfter) break;
      this.clusters.shift();
    }
  }

  private parse(): void {
    let offset = 0;
    const bytes = this.pending;
    for (;;) {
      const id = readVInt(bytes, offset, true);
      if (!id) break;
      const size = readVInt(bytes, offset + id.length, false);
      if (!size) break;
      const headerLength = id.length + size.length;
      if (this.stage === 'HEADER') {
        if (id.value === ID.Segment) {
          this.header.push(bytes.slice(offset, offset + headerLength));
          offset += headerLength;
          this.stage = 'SEGMENT';
          continue;
        }
        if (size.unknown || size.value > MAX_ELEMENT_BYTES)
          throw new Error('Unexpected header element');
        const end = offset + headerLength + size.value;
        if (end > bytes.length) break;
        this.header.push(bytes.slice(offset, end));
        offset = end;
        continue;
      }
      if (this.stage === 'CLUSTER' && SEGMENT_LEVEL.has(id.value)) {
        this.closeCluster();
        continue;
      }
      if (this.stage === 'SEGMENT' && id.value === ID.Cluster) {
        if (!size.unknown) throw new Error('Sized clusters are not supported');
        this.current = { timecode: 0, children: [] };
        this.stage = 'CLUSTER';
        offset += headerLength;
        continue;
      }
      if (size.unknown || size.value > MAX_ELEMENT_BYTES)
        throw new Error('Unexpected element size');
      const end = offset + headerLength + size.value;
      if (end > bytes.length) break;
      const element = bytes.subarray(offset, end);
      const payload = bytes.subarray(offset + headerLength, end);
      if (this.stage === 'SEGMENT') {
        // Segment-level metadata before the first cluster belongs to the header.
        if (!this.clusters.length && !this.current) {
          this.header.push(element.slice());
          if (id.value === ID.Tracks) this.readTracks(payload);
          if (id.value === ID.Info) this.readInfo(payload);
        }
      } else {
        this.readClusterChild(id.value, element, payload);
      }
      offset = end;
    }
    this.pending = this.pending.slice(offset);
  }

  private closeCluster(): void {
    if (this.current?.children.length) this.clusters.push(this.current);
    this.current = null;
    this.stage = 'SEGMENT';
  }

  private readClusterChild(
    id: number,
    element: Uint8Array,
    payload: Uint8Array,
  ): void {
    const cluster = this.current;
    if (!cluster) return;
    if (id === ID.Timecode) {
      cluster.timecode = readUint(payload);
      return;
    }
    if (id === ID.SimpleBlock) {
      const block = this.readBlockHeader(payload);
      if (!block) return;
      const video = this.trackTypes.get(block.track) === 1;
      cluster.children.push({
        bytes: element.slice(),
        kind: video ? (block.flags & 0x80 ? 'videoKey' : 'video') : 'audio',
        relative: block.relative,
      });
    } else if (id === ID.BlockGroup) {
      let block: ReturnType<WebmClipBuffer['readBlockHeader']> = null;
      let referenced = false;
      for (let offset = 0; offset < payload.length;) {
        const childId = readVInt(payload, offset, true);
        const childSize =
          childId && readVInt(payload, offset + childId.length, false);
        if (!childId || !childSize) break;
        const start = offset + childId.length + childSize.length;
        if (childId.value === ID.Block)
          block = this.readBlockHeader(
            payload.subarray(start, start + childSize.value),
          );
        if (childId.value === ID.ReferenceBlock) referenced = true;
        offset = start + childSize.value;
      }
      if (!block) return;
      const video = this.trackTypes.get(block.track) === 1;
      cluster.children.push({
        bytes: element.slice(),
        kind: video ? (referenced ? 'video' : 'videoKey') : 'audio',
        relative: block.relative,
      });
    }
    // Other cluster children (Void, Position, PrevSize) are not needed in clips.
  }

  private readBlockHeader(
    payload: Uint8Array,
  ): { track: number; relative: number; flags: number } | null {
    const track = readVInt(payload, 0, false);
    if (!track || payload.length < track.length + 3) return null;
    const high = payload[track.length]!;
    const low = payload[track.length + 1]!;
    let relative = (high << 8) | low;
    if (relative & 0x8000) relative -= 0x10000;
    return { track: track.value, relative, flags: payload[track.length + 2]! };
  }

  private readTracks(payload: Uint8Array): void {
    this.forEachChild(payload, (id, entry) => {
      if (id !== ID.TrackEntry) return;
      let number = 0;
      let type = 0;
      this.forEachChild(entry, (childId, value) => {
        if (childId === ID.TrackNumber) number = readUint(value);
        if (childId === ID.TrackType) type = readUint(value);
      });
      if (number) this.trackTypes.set(number, type);
    });
  }

  private readInfo(payload: Uint8Array): void {
    this.forEachChild(payload, (id, value) => {
      if (id === ID.TimecodeScale)
        this.timecodeScaleNs = readUint(value) || 1_000_000;
    });
  }

  private forEachChild(
    payload: Uint8Array,
    visit: (id: number, value: Uint8Array) => void,
  ): void {
    for (let offset = 0; offset < payload.length;) {
      const id = readVInt(payload, offset, true);
      const size = id && readVInt(payload, offset + id.length, false);
      if (!id || !size || size.unknown) return;
      const start = offset + id.length + size.length;
      visit(id.value, payload.subarray(start, start + size.value));
      offset = start + size.value;
    }
  }
}
