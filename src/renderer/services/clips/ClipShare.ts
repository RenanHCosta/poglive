import type { ClipAttachment } from '../../../shared/schemas/chat';
import { Store } from '../store';

export type DownloadState =
  | { status: 'LOADING'; progress: number }
  | { status: 'READY'; url: string; bytes: Uint8Array }
  | { status: 'ERROR'; message: string };

interface Transport {
  requestFile: (peerId: string, fileId: string) => boolean;
  sendFile: (
    peerId: string,
    fileId: string,
    bytes: Uint8Array,
  ) => Promise<void>;
}

interface Pending {
  authorId: string;
  expected: number;
  chunks: Uint8Array[];
  received: number;
  timer: ReturnType<typeof setTimeout>;
}

// Clips offered to the room stay in memory for the session, within bounds.
const MAX_OFFERED = 8;
const MAX_OFFERED_BYTES = 400 * 1024 * 1024;
// No progress for this long aborts a download.
const IDLE_TIMEOUT_MS = 20_000;
const MAX_PARALLEL_UPLOADS = 3;

/**
 * Clips shared in chat travel peer to peer: the chat message only describes
 * the file, and whoever opens it downloads it straight from the author.
 */
export class ClipShare {
  readonly downloads = new Store<ReadonlyMap<string, DownloadState>>(new Map());
  private readonly offered = new Map<string, Uint8Array>();
  private readonly pending = new Map<string, Pending>();
  private uploads = 0;
  private closed = false;

  constructor(
    private readonly selfId: string,
    private readonly transport: Transport,
  ) {}

  /** Keeps a clip available to the room and describes it for chat. */
  offer(bytes: Uint8Array, name: string, durationMs: number): ClipAttachment {
    const id = crypto.randomUUID();
    this.offered.set(id, bytes);
    let total = [...this.offered.values()].reduce(
      (sum, item) => sum + item.length,
      0,
    );
    for (const [key, value] of this.offered) {
      if (this.offered.size <= MAX_OFFERED && total <= MAX_OFFERED_BYTES) break;
      if (key === id) break;
      this.offered.delete(key);
      total -= value.length;
    }
    return {
      kind: 'clip',
      id,
      name: name.slice(0, 120),
      size: bytes.length,
      durationMs: Math.max(0, Math.round(durationMs)),
    };
  }

  /** Starts (or reuses) a download; the author's own clips open instantly. */
  open(authorId: string, attachment: ClipAttachment): void {
    const current = this.downloads.get().get(attachment.id);
    if (current && current.status !== 'ERROR') return;
    const local = this.offered.get(attachment.id);
    if (authorId === this.selfId) {
      if (local) this.ready(attachment.id, local);
      else this.error(attachment.id, 'Este clipe não está mais na memória.');
      return;
    }
    if (!this.transport.requestFile(authorId, attachment.id)) {
      this.error(attachment.id, 'Sem conexão direta com quem enviou o clipe.');
      return;
    }
    this.set(attachment.id, { status: 'LOADING', progress: 0 });
    this.pending.set(attachment.id, {
      authorId,
      expected: attachment.size,
      chunks: [],
      received: 0,
      timer: this.idleTimer(attachment.id),
    });
  }

  /** A peer asked for one of our clips. Unknown IDs are ignored. */
  serve(peerId: string, fileId: string): void {
    const bytes = this.offered.get(fileId);
    if (!bytes || this.closed || this.uploads >= MAX_PARALLEL_UPLOADS) return;
    this.uploads++;
    void this.transport
      .sendFile(peerId, fileId, bytes)
      .catch(() => {})
      .finally(() => {
        this.uploads--;
      });
  }

  /** Incoming file channel; accepted only for a download we started. */
  receive(peerId: string, fileId: string, channel: RTCDataChannel): void {
    const pending = this.pending.get(fileId);
    if (!pending || pending.authorId !== peerId) {
      channel.close();
      return;
    }
    channel.binaryType = 'arraybuffer';
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (!this.pending.has(fileId)) return;
      if (data === 'END') {
        this.finish(fileId, channel);
        return;
      }
      if (!(data instanceof ArrayBuffer)) {
        this.abort(fileId, channel, 'O clipe chegou em um formato inesperado.');
        return;
      }
      pending.received += data.byteLength;
      if (pending.received > pending.expected) {
        this.abort(
          fileId,
          channel,
          'O clipe recebido é maior do que o anunciado.',
        );
        return;
      }
      pending.chunks.push(new Uint8Array(data));
      clearTimeout(pending.timer);
      pending.timer = this.idleTimer(fileId, channel);
      this.set(fileId, {
        status: 'LOADING',
        progress: pending.received / pending.expected,
      });
    };
    channel.onclose = () => {
      if (this.pending.has(fileId))
        this.abort(fileId, channel, 'A transferência foi interrompida.');
    };
  }

  private finish(fileId: string, channel: RTCDataChannel): void {
    const pending = this.pending.get(fileId);
    if (!pending) return;
    if (pending.received !== pending.expected) {
      this.abort(fileId, channel, 'O clipe chegou incompleto.');
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(fileId);
    channel.close();
    const bytes = new Uint8Array(pending.expected);
    let offset = 0;
    for (const chunk of pending.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    this.ready(fileId, bytes);
  }

  private abort(
    fileId: string,
    channel: RTCDataChannel | null,
    message: string,
  ): void {
    const pending = this.pending.get(fileId);
    if (pending) clearTimeout(pending.timer);
    this.pending.delete(fileId);
    channel?.close();
    this.error(fileId, message);
  }

  private idleTimer(fileId: string, channel: RTCDataChannel | null = null) {
    return setTimeout(
      () => this.abort(fileId, channel, 'O clipe demorou demais para chegar.'),
      IDLE_TIMEOUT_MS,
    );
  }

  private ready(fileId: string, bytes: Uint8Array): void {
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
      type: 'video/webm',
    });
    this.set(fileId, {
      status: 'READY',
      url: URL.createObjectURL(blob),
      bytes,
    });
  }

  private error(fileId: string, message: string): void {
    this.set(fileId, { status: 'ERROR', message });
  }

  private set(fileId: string, state: DownloadState): void {
    if (this.closed) return;
    const next = new Map(this.downloads.get());
    const previous = next.get(fileId);
    if (previous?.status === 'READY' && state.status !== 'READY')
      URL.revokeObjectURL(previous.url);
    next.set(fileId, state);
    this.downloads.set(next);
  }

  close(): void {
    this.closed = true;
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    for (const state of this.downloads.get().values())
      if (state.status === 'READY') URL.revokeObjectURL(state.url);
    this.offered.clear();
  }
}
