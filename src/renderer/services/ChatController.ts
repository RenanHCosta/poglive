import type { ChatMessage, RoomEvent } from '../../shared/schemas/chat';
import { CHAT_LOG_LIMIT, MAX_CHAT_LENGTH } from '../../shared/schemas/chat';
import { playSound } from './sounds';
import { Store } from './store';

const DELIVERY_TIMEOUT_MS = 10_000;

export type ChatEntry =
  | (ChatMessage & {
      kind: 'MESSAGE';
      delivery: 'SENT' | 'PENDING' | 'FAILED';
      failure?: string;
    })
  | { kind: 'SYSTEM'; id: string; text: string; sentAt: number };

export function mentions(text: string, displayName: string): boolean {
  const escaped = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)@${escaped}(?=$|[\\s.,!?:;])`, 'iu').test(text);
}

/** Room text channel: host-confirmed messages plus local pending/failed ones. */
export class ChatController {
  readonly entries = new Store<ChatEntry[]>([]);
  readonly unread = new Store<{ count: number; mentioned: boolean }>({
    count: 0,
    mentioned: false,
  });
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private visible = false;
  private closed = false;

  constructor(
    private readonly roomId: string,
    private readonly self: { peerId: string; displayName: string },
  ) {}

  async load(): Promise<void> {
    try {
      const history = await window.pogLive.getChatHistory();
      if (this.closed || history.roomId !== this.roomId) return;
      for (const message of history.messages) this.accept(message, false);
    } catch {
      // History is a convenience; live messages still arrive.
    }
  }

  handle(event: RoomEvent): void {
    if (this.closed) return;
    if (event.type === 'CHAT_HISTORY' && event.roomId === this.roomId)
      void this.load();
    else if (event.type === 'CHAT_MESSAGE' && event.roomId === this.roomId)
      this.accept(event.message, true);
    else if (event.type === 'CHAT_REJECTED' && event.roomId === this.roomId)
      this.markFailed(
        event.id,
        event.reason === 'RATE_LIMITED'
          ? 'Você está enviando mensagens rápido demais.'
          : 'A mensagem não pôde ser entregue.',
      );
  }

  /** Visible chat counts as read; hidden chat accumulates unread messages. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.unread.set({ count: 0, mentioned: false });
  }

  addSystem(text: string): void {
    this.push({
      kind: 'SYSTEM',
      id: crypto.randomUUID(),
      text,
      sentAt: Date.now(),
    });
  }

  send(text: string): boolean {
    const normalized = text.replace(/\r\n?/g, '\n').trim();
    if (!normalized || normalized.length > MAX_CHAT_LENGTH || this.closed)
      return false;
    const id = crypto.randomUUID();
    this.push({
      kind: 'MESSAGE',
      id,
      authorId: this.self.peerId,
      authorName: this.self.displayName,
      text: normalized,
      sentAt: Date.now(),
      delivery: 'PENDING',
    });
    this.deliver(id, normalized);
    return true;
  }

  retry(id: string): void {
    const entry = this.entries
      .get()
      .find((item) => item.kind === 'MESSAGE' && item.id === id);
    if (entry?.kind !== 'MESSAGE' || entry.delivery !== 'FAILED') return;
    // Same ID: if the first attempt did arrive, the host only re-confirms it
    // to us instead of posting the message twice.
    this.entries.update((entries) =>
      entries.map((item) =>
        item.kind === 'MESSAGE' && item.id === id
          ? { ...item, delivery: 'PENDING', sentAt: Date.now() }
          : item,
      ),
    );
    this.deliver(id, entry.text);
  }

  discard(id: string): void {
    this.entries.update((entries) => entries.filter((item) => item.id !== id));
  }

  private deliver(id: string, text: string): void {
    this.timers.set(
      id,
      setTimeout(
        () => this.markFailed(id, 'Sem confirmação do host.'),
        DELIVERY_TIMEOUT_MS,
      ),
    );
    void window.pogLive
      .command({ type: 'SEND_CHAT', id, text })
      .then((result) => {
        if (result.status === 'ERROR') this.markFailed(id, result.message);
      })
      .catch(() => this.markFailed(id, 'A mensagem não pôde ser enviada.'));
  }

  private markFailed(id: string, failure: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.entries.update((entries) =>
      entries.map((item) =>
        item.kind === 'MESSAGE' && item.id === id && item.delivery === 'PENDING'
          ? { ...item, delivery: 'FAILED', failure }
          : item,
      ),
    );
  }

  private accept(message: ChatMessage, live: boolean): void {
    clearTimeout(this.timers.get(message.id));
    this.timers.delete(message.id);
    const entries = this.entries.get();
    const index = entries.findIndex((item) => item.id === message.id);
    const confirmed: ChatEntry = {
      ...message,
      kind: 'MESSAGE',
      delivery: 'SENT',
    };
    if (index >= 0) {
      // Our own pending message: replace in place to keep scroll position stable.
      const next = [...entries];
      next[index] = confirmed;
      this.entries.set(next);
      return;
    }
    this.push(confirmed);
    if (!live || message.authorId === this.self.peerId) return;
    const mentioned = mentions(message.text, this.self.displayName);
    if (!this.visible || !document.hasFocus()) {
      if (!this.visible)
        this.unread.update((unread) => ({
          count: unread.count + 1,
          mentioned: unread.mentioned || mentioned,
        }));
      if (mentioned || !document.hasFocus()) void playSound('message');
    }
  }

  private push(entry: ChatEntry): void {
    this.entries.update((entries) => {
      const next = [...entries, entry];
      // Host order is authoritative; local pending entries stay at the end.
      next.sort((a, b) => {
        const pendingA = a.kind === 'MESSAGE' && a.delivery !== 'SENT';
        const pendingB = b.kind === 'MESSAGE' && b.delivery !== 'SENT';
        if (pendingA !== pendingB) return pendingA ? 1 : -1;
        return a.sentAt - b.sentAt;
      });
      return next.length > CHAT_LOG_LIMIT + 50
        ? next.slice(next.length - CHAT_LOG_LIMIT - 50)
        : next;
    });
  }

  close(): void {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
