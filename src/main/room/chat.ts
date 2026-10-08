import { CHAT_HISTORY_LIMIT, CHAT_LOG_LIMIT } from '../../shared/schemas/chat';
import type { ChatMessage } from '../../shared/schemas/chat';
import type { Identity } from '../../shared/schemas/room';

// Leaves room for the envelope inside the 64 KiB transport frame.
const HISTORY_BATCH_BYTES = 48 * 1024;
// The admission burst (accept + history + state) is written in one tick and
// must stay well under the 256 KiB backpressure cutoff in Channel.send.
export const HISTORY_TOTAL_BYTES = 160 * 1024;

/** Sliding-window limiter: at most `limit` events per `windowMs`. */
export class RateWindow {
  private readonly stamps: number[] = [];
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}
  static chat(): RateWindow {
    return new RateWindow(5, 5000);
  }
  take(): boolean {
    const time = this.now();
    while (this.stamps.length && time - this.stamps[0]! >= this.windowMs)
      this.stamps.shift();
    if (this.stamps.length >= this.limit) return false;
    this.stamps.push(time);
    return true;
  }
}

/** Host-owned, memory-only chat log. Nothing is written to disk. */
export class ChatLog {
  private readonly log: ChatMessage[] = [];
  private readonly ids = new Set<string>();
  private lastSentAt = 0;
  constructor(private readonly now: () => number = Date.now) {}
  append(author: Identity, id: string, text: string): ChatMessage | null {
    if (this.ids.has(id)) return null;
    // Strictly increasing timestamps keep ordering stable across clock steps.
    const sentAt = Math.max(this.now(), this.lastSentAt + 1);
    this.lastSentAt = sentAt;
    const message: ChatMessage = {
      id,
      authorId: author.peerId,
      authorName: author.displayName,
      text,
      sentAt,
    };
    this.log.push(message);
    this.ids.add(id);
    while (this.log.length > CHAT_LOG_LIMIT) {
      const removed = this.log.shift();
      if (removed) this.ids.delete(removed.id);
    }
    return message;
  }
  find(id: string): ChatMessage | undefined {
    return this.ids.has(id)
      ? this.log.find((message) => message.id === id)
      : undefined;
  }
  messages(): ChatMessage[] {
    return [...this.log];
  }
  /**
   * Most recent history, oldest first, bounded by count and total bytes and
   * split to respect the frame limit.
   */
  historyBatches(): ChatMessage[][] {
    const recent: ChatMessage[] = [];
    let total = 0;
    for (const message of this.log.slice(-CHAT_HISTORY_LIMIT).reverse()) {
      total += Buffer.byteLength(JSON.stringify(message)) + 1;
      if (total > HISTORY_TOTAL_BYTES) break;
      recent.unshift(message);
    }
    const batches: ChatMessage[][] = [];
    let current: ChatMessage[] = [];
    let bytes = 0;
    for (const message of recent) {
      const size = Buffer.byteLength(JSON.stringify(message)) + 1;
      if (current.length && bytes + size > HISTORY_BATCH_BYTES) {
        batches.push(current);
        current = [];
        bytes = 0;
      }
      current.push(message);
      bytes += size;
    }
    if (current.length) batches.push(current);
    return batches;
  }
}
