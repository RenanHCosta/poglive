import type { ChatMessage, RoomEvent } from '../../shared/schemas/chat';
import { CHAT_LOG_LIMIT, MAX_CHAT_LENGTH } from '../../shared/schemas/chat';
import { playSound } from './sounds';
import { Store } from './store';
import { pushToast } from './toasts';

const DELIVERY_TIMEOUT_MS = 10_000;
// A typing notice lasts a little longer than the senders' 3 s throttle.
const TYPING_VISIBLE_MS = 6_000;
const TYPING_SEND_INTERVAL_MS = 3_000;

export type ChatEntry =
  | (ChatMessage & {
      kind: 'MESSAGE';
      delivery: 'SENT' | 'PENDING' | 'FAILED';
      failure?: string;
    })
  | { kind: 'SYSTEM'; id: string; text: string; sentAt: number };

function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

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
  /** Peers currently typing, with the time their notice expires. */
  readonly typing = new Store<ReadonlyMap<string, number>>(new Map());
  private typingTimer: ReturnType<typeof setInterval> | undefined;
  private lastTypingSent = 0;
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
    if (event.type === 'TYPING' && event.roomId === this.roomId)
      this.markTyping(event.peerId);
    else if (event.type === 'CHAT_HISTORY' && event.roomId === this.roomId)
      void this.load();
    else if (event.type === 'CHAT_MESSAGE' && event.roomId === this.roomId)
      this.accept(event.message, true);
    else if (event.type === 'CHAT_UPDATED' && event.roomId === this.roomId)
      this.entries.update((entries) =>
        entries.map((item) =>
          item.kind === 'MESSAGE' && item.id === event.message.id
            ? { ...item, ...event.message }
            : item,
        ),
      );
    else if (event.type === 'CHAT_DELETED' && event.roomId === this.roomId)
      this.entries.update((entries) =>
        entries.filter((item) => item.id !== event.id),
      );
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

  /** Called on composer input; throttled so the host sees one notice per 3 s. */
  notifyTyping(): void {
    const now = Date.now();
    if (this.closed || now - this.lastTypingSent < TYPING_SEND_INTERVAL_MS)
      return;
    this.lastTypingSent = now;
    void window.pogLive.command({ type: 'TYPING' }).catch(() => {});
  }

  private markTyping(peerId: string): void {
    const next = new Map(this.typing.get());
    next.set(peerId, Date.now() + TYPING_VISIBLE_MS);
    this.typing.set(next);
    this.typingTimer ??= setInterval(() => this.expireTyping(), 1000);
  }

  private expireTyping(peerId?: string): void {
    const now = Date.now();
    const current = this.typing.get();
    const next = new Map(
      [...current].filter(([id, until]) => until > now && id !== peerId),
    );
    if (next.size !== current.size) this.typing.set(next);
    if (!next.size) {
      clearInterval(this.typingTimer);
      this.typingTimer = undefined;
    }
  }

  addSystem(text: string): void {
    this.push({
      kind: 'SYSTEM',
      id: crypto.randomUUID(),
      text,
      sentAt: Date.now(),
    });
  }

  send(
    text: string,
    replyTo: string | null = null,
    attachment: ChatMessage['attachment'] = null,
  ): boolean {
    const normalized = normalize(text);
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
      replyTo,
      attachment,
      editedAt: null,
      delivery: 'PENDING',
    });
    this.deliver(id, normalized, replyTo, attachment);
    this.lastTypingSent = 0;
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
    this.deliver(id, entry.text, entry.replyTo, entry.attachment);
  }

  /** Edits one of the user's delivered messages; the host confirms. */
  edit(id: string, text: string): boolean {
    const normalized = normalize(text);
    const entry = this.findMessage(id);
    if (
      !entry ||
      entry.authorId !== this.self.peerId ||
      entry.delivery !== 'SENT' ||
      !normalized ||
      normalized.length > MAX_CHAT_LENGTH
    )
      return false;
    if (normalized === entry.text) return true;
    const previous = entry;
    this.replace(id, { ...entry, text: normalized, editedAt: Date.now() });
    void window.pogLive
      .command({ type: 'EDIT_CHAT', id, text: normalized })
      .then((result) => {
        if (result.status === 'ERROR') {
          this.replace(id, previous);
          pushToast(result.message, 'error');
        }
      });
    return true;
  }

  /** Own messages for everyone; the host may also delete others'. */
  remove(id: string): void {
    const entry = this.findMessage(id);
    if (!entry) return;
    if (entry.delivery !== 'SENT') {
      this.discard(id);
      return;
    }
    void window.pogLive.command({ type: 'DELETE_CHAT', id }).then((result) => {
      if (result.status === 'ERROR') pushToast(result.message, 'error');
    });
  }

  findMessage(id: string): Extract<ChatEntry, { kind: 'MESSAGE' }> | undefined {
    const entry = this.entries.get().find((item) => item.id === id);
    return entry?.kind === 'MESSAGE' ? entry : undefined;
  }

  /** The user's latest delivered message, for "arrow up to edit". */
  lastOwnMessage(): Extract<ChatEntry, { kind: 'MESSAGE' }> | undefined {
    const entries = this.entries.get();
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (
        entry?.kind === 'MESSAGE' &&
        entry.authorId === this.self.peerId &&
        entry.delivery === 'SENT'
      )
        return entry;
    }
    return undefined;
  }

  private replace(id: string, next: ChatEntry): void {
    this.entries.update((entries) =>
      entries.map((item) => (item.id === id ? next : item)),
    );
  }

  discard(id: string): void {
    this.entries.update((entries) => entries.filter((item) => item.id !== id));
  }

  private deliver(
    id: string,
    text: string,
    replyTo: string | null,
    attachment: ChatMessage['attachment'] = null,
  ): void {
    this.timers.set(
      id,
      setTimeout(
        () => this.markFailed(id, 'Sem confirmação do host.'),
        DELIVERY_TIMEOUT_MS,
      ),
    );
    void window.pogLive
      .command({ type: 'SEND_CHAT', id, text, replyTo, attachment })
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
    if (live && this.typing.get().has(message.authorId))
      this.expireTyping(message.authorId);
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
    clearInterval(this.typingTimer);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
