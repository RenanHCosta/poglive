import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MAX_CHAT_LENGTH } from '../../../shared/schemas/chat';
import type { Identity } from '../../../shared/schemas/room';
import type { ChatEntry } from '../../services/ChatController';
import { mentions } from '../../services/ChatController';
import type { RoomSession } from '../../services/RoomSession';
import { useStore } from '../../services/store';
import { Avatar } from '../common/Avatar';
import { Modal } from '../common/Modal';
import { Icon } from '../Icon';
import { MessageContent } from './MessageContent';

// Consecutive messages from one author within this window share a header.
const GROUP_WINDOW_MS = 7 * 60 * 1000;

const timeFormat = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
});
const dayFormat = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

type Message = Extract<ChatEntry, { kind: 'MESSAGE' }>;

function dayLabel(time: number): string {
  const date = new Date(time);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return dayFormat.format(date);
}

function excerpt(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}

export function ChatView({
  session,
  self,
  names,
  roomName,
  participants,
  moderator = false,
  compact = false,
}: {
  session: RoomSession;
  self: Identity;
  names: string[];
  roomName: string;
  participants: Identity[];
  moderator?: boolean;
  compact?: boolean;
}) {
  const entries = useStore(session.chat.entries);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    session.chat.setVisible(true);
    return () => session.chat.setVisible(false);
  }, [session]);
  useLayoutEffect(() => {
    const element = list.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [entries]);
  const byId = useMemo(
    () =>
      new Map(
        entries
          .filter((entry): entry is Message => entry.kind === 'MESSAGE')
          .map((entry) => [entry.id, entry]),
      ),
    [entries],
  );
  const jumpTo = (id: string) => {
    document
      .getElementById(`message-${id}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlash(id);
    setTimeout(
      () => setFlash((current) => (current === id ? null : current)),
      1600,
    );
  };
  return (
    <div className={`chat${compact ? ' compact' : ''}`}>
      <div
        className="chat-scroll"
        ref={list}
        onScroll={(event) => {
          const element = event.currentTarget;
          stick.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            80;
        }}
      >
        <div className="chat-welcome">
          <span className="chat-welcome-icon">
            <Icon name="hash" size={40} />
          </span>
          <h2>Boas-vindas ao #chat</h2>
          <p>
            Este é o começo do canal de texto da sala {roomName}. As mensagens
            ficam só na memória do anfitrião e somem quando a sala é encerrada.
          </p>
        </div>
        <ol className="messages" aria-live="polite">
          {entries.map((entry, index) => (
            <MessageRow
              key={entry.id}
              entry={entry}
              previous={entries[index - 1]}
              self={self}
              names={names}
              reference={
                entry.kind === 'MESSAGE' && entry.replyTo
                  ? (byId.get(entry.replyTo) ?? 'missing')
                  : null
              }
              editing={editing === entry.id}
              flash={flash === entry.id}
              canDelete={
                entry.kind === 'MESSAGE' &&
                (entry.authorId === self.peerId || moderator)
              }
              onReply={() => {
                if (entry.kind === 'MESSAGE') setReplyTo(entry);
              }}
              onEdit={() => setEditing(entry.id)}
              onEditDone={(text) => {
                if (text !== null) session.chat.edit(entry.id, text);
                setEditing(null);
              }}
              onDelete={(immediate) => {
                if (entry.kind !== 'MESSAGE') return;
                if (immediate) session.chat.remove(entry.id);
                else setDeleting(entry);
              }}
              onJump={jumpTo}
              onRetry={() => session.chat.retry(entry.id)}
              onDiscard={() => session.chat.discard(entry.id)}
            />
          ))}
        </ol>
      </div>
      <Composer
        roomName={roomName}
        names={names}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onEditLast={() => {
          const last = session.chat.lastOwnMessage();
          if (!last) return false;
          setEditing(last.id);
          return true;
        }}
        onTyping={() => session.chat.notifyTyping()}
        onSend={(text) => {
          stick.current = true;
          const sent = session.chat.send(text, replyTo?.id ?? null);
          if (sent) setReplyTo(null);
          return sent;
        }}
      />
      <TypingIndicator session={session} participants={participants} />
      {deleting && (
        <Modal
          title="Apagar mensagem?"
          subtitle="A mensagem some para todos na sala. Dica: segure Shift ao clicar para apagar sem confirmar."
          size="small"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button
                type="button"
                className="button link"
                onClick={() => setDeleting(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  session.chat.remove(deleting.id);
                  setDeleting(null);
                }}
              >
                Apagar
              </button>
            </>
          }
        >
          <blockquote className="delete-preview">
            <strong>{deleting.authorName}</strong>
            <span>{excerpt(deleting.text)}</span>
          </blockquote>
        </Modal>
      )}
    </div>
  );
}

function MessageRow({
  entry,
  previous,
  self,
  names,
  reference,
  editing,
  flash,
  canDelete,
  onReply,
  onEdit,
  onEditDone,
  onDelete,
  onJump,
  onRetry,
  onDiscard,
}: {
  entry: ChatEntry;
  previous: ChatEntry | undefined;
  self: Identity;
  names: string[];
  reference: Message | 'missing' | null;
  editing: boolean;
  flash: boolean;
  canDelete: boolean;
  onReply: () => void;
  onEdit: () => void;
  onEditDone: (text: string | null) => void;
  onDelete: (immediate: boolean) => void;
  onJump: (id: string) => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const newDay =
    !previous ||
    new Date(previous.sentAt).toDateString() !==
      new Date(entry.sentAt).toDateString();
  const divider = newDay ? (
    <li className="day-divider" role="separator">
      <span>{dayLabel(entry.sentAt)}</span>
    </li>
  ) : null;
  if (entry.kind === 'SYSTEM')
    return (
      <>
        {divider}
        <li className="message system">
          <Icon name="chevronRight" size={16} className="system-icon" />
          <span>{entry.text}</span>
          <time>{timeFormat.format(entry.sentAt)}</time>
        </li>
      </>
    );
  // A reply always shows its own header, so the reference reads naturally.
  const grouped =
    !newDay &&
    !reference &&
    previous?.kind === 'MESSAGE' &&
    previous.authorId === entry.authorId &&
    entry.sentAt - previous.sentAt < GROUP_WINDOW_MS;
  const own = entry.authorId === self.peerId;
  const mentioned =
    !own &&
    (mentions(entry.text, self.displayName) ||
      (reference !== null &&
        reference !== 'missing' &&
        reference.authorId === self.peerId));
  return (
    <>
      {divider}
      <li
        id={`message-${entry.id}`}
        className={`message${grouped ? ' grouped' : ''}${mentioned ? ' mentioned' : ''}${flash ? ' flash' : ''}${editing ? ' editing' : ''}${entry.delivery !== 'SENT' ? ` ${entry.delivery.toLowerCase()}` : ''}`}
      >
        {reference && (
          <button
            type="button"
            className="message-reference"
            disabled={reference === 'missing'}
            onClick={() => reference !== 'missing' && onJump(reference.id)}
          >
            <Icon name="reply" size={14} />
            {reference === 'missing' ? (
              <em>Mensagem original indisponível</em>
            ) : (
              <>
                <strong>@{reference.authorName}</strong>
                <span>{excerpt(reference.text)}</span>
              </>
            )}
          </button>
        )}
        <div className="message-main">
          {grouped ? (
            <time className="message-hover-time">
              {timeFormat.format(entry.sentAt)}
            </time>
          ) : (
            <Avatar peerId={entry.authorId} name={entry.authorName} size={40} />
          )}
          <div className="message-body">
            {!grouped && (
              <div className="message-header">
                <span className="message-author">{entry.authorName}</span>
                <time dateTime={new Date(entry.sentAt).toISOString()}>
                  {timeFormat.format(entry.sentAt)}
                </time>
              </div>
            )}
            {editing ? (
              <EditBox initial={entry.text} onDone={onEditDone} />
            ) : (
              <>
                <MessageContent
                  text={entry.text}
                  names={names}
                  selfName={self.displayName}
                />
                {entry.editedAt && (
                  <span
                    className="message-edited"
                    title={new Date(entry.editedAt).toLocaleString('pt-BR')}
                  >
                    (editada)
                  </span>
                )}
              </>
            )}
            {entry.delivery === 'FAILED' && (
              <div className="message-failed">
                <Icon name="alert" size={14} />
                <span>{entry.failure ?? 'Não enviada.'}</span>
                <button type="button" onClick={onRetry}>
                  Reenviar
                </button>
                <button type="button" onClick={onDiscard}>
                  Descartar
                </button>
              </div>
            )}
          </div>
        </div>
        {entry.delivery === 'SENT' && !editing && (
          <div className="message-actions" role="toolbar" aria-label="Ações">
            <button
              type="button"
              aria-label="Responder"
              data-tooltip="Responder"
              onClick={onReply}
            >
              <Icon name="reply" size={16} />
            </button>
            {own && (
              <button
                type="button"
                aria-label="Editar"
                data-tooltip="Editar"
                onClick={onEdit}
              >
                <Icon name="pencil" size={16} />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="danger"
                aria-label="Apagar"
                data-tooltip="Apagar"
                onClick={(event) => onDelete(event.shiftKey)}
              >
                <Icon name="trash" size={16} />
              </button>
            )}
          </div>
        )}
      </li>
    </>
  );
}

function EditBox({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (text: string | null) => void;
}) {
  const [text, setText] = useState(initial);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 260)}px`;
  }, [text]);
  useEffect(() => {
    const element = input.current;
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
  }, []);
  return (
    <div className="edit-box">
      <textarea
        ref={input}
        value={text}
        maxLength={MAX_CHAT_LENGTH}
        aria-label="Editar mensagem"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onDone(null);
          } else if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            onDone(text.trim() ? text : null);
          }
        }}
      />
      <span className="edit-hint">
        Esc para{' '}
        <button type="button" onClick={() => onDone(null)}>
          cancelar
        </button>{' '}
        · Enter para{' '}
        <button type="button" onClick={() => onDone(text.trim() ? text : null)}>
          salvar
        </button>
      </span>
    </div>
  );
}

function TypingIndicator({
  session,
  participants,
}: {
  session: RoomSession;
  participants: Identity[];
}) {
  const typing = useStore(session.chat.typing);
  const names = participants
    .filter((peer) => typing.has(peer.peerId))
    .map((peer) => peer.displayName);
  const text =
    names.length === 0
      ? ''
      : names.length === 1
        ? `${names[0]} está digitando…`
        : names.length <= 3
          ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]} estão digitando…`
          : 'Várias pessoas estão digitando…';
  return (
    <div className="typing" aria-live="polite">
      {text && (
        <>
          <span className="typing-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>{text}</span>
        </>
      )}
    </div>
  );
}

function Composer({
  roomName,
  names,
  replyTo,
  onCancelReply,
  onEditLast,
  onTyping,
  onSend,
}: {
  roomName: string;
  names: string[];
  replyTo: Message | null;
  onCancelReply: () => void;
  onEditLast: () => boolean;
  onTyping: () => void;
  onSend: (text: string) => boolean;
}) {
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const [suggestion, setSuggestion] = useState(0);
  const query = /(?:^|\s)@([^\s@]{0,32})$/u.exec(text)?.[1];
  const matches = useMemo(
    () =>
      query === undefined
        ? []
        : names
            .filter((name) =>
              name.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()),
            )
            .slice(0, 6),
    [names, query],
  );
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [text]);
  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);
  const complete = (name: string) => {
    setText((current) => current.replace(/@([^\s@]{0,32})$/u, `@${name} `));
    setSuggestion(0);
    input.current?.focus();
  };
  const submit = () => {
    if (onSend(text)) setText('');
  };
  const remaining = MAX_CHAT_LENGTH - text.length;
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {matches.length > 0 && (
        <ul className="mention-suggestions" role="listbox">
          {matches.map((name, index) => (
            <li key={name}>
              <button
                type="button"
                role="option"
                aria-selected={index === suggestion}
                className={index === suggestion ? 'active' : ''}
                onMouseDown={(event) => {
                  event.preventDefault();
                  complete(name);
                }}
              >
                @{name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {replyTo && (
        <div className="reply-bar">
          <Icon name="reply" size={14} />
          <span>
            Respondendo a <strong>{replyTo.authorName}</strong>
          </span>
          <button
            type="button"
            aria-label="Cancelar resposta"
            onClick={onCancelReply}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      <div className={`composer-box${replyTo ? ' replying' : ''}`}>
        <textarea
          ref={input}
          rows={1}
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          placeholder={`Conversar em #chat · ${roomName}`}
          aria-label="Mensagem"
          onChange={(event) => {
            setText(event.target.value);
            setSuggestion(0);
            if (event.target.value.trim()) onTyping();
          }}
          onKeyDown={(event) => {
            if (matches.length) {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setSuggestion(
                  (current) =>
                    (current +
                      (event.key === 'ArrowDown' ? 1 : -1) +
                      matches.length) %
                    matches.length,
                );
                return;
              }
              if (event.key === 'Tab' || event.key === 'Enter') {
                event.preventDefault();
                complete(matches[suggestion] ?? matches[0]!);
                return;
              }
            }
            // Arrow up in an empty box edits the last message, a familiar shortcut.
            if (event.key === 'ArrowUp' && !text && onEditLast()) {
              event.preventDefault();
              return;
            }
            if (event.key === 'Escape' && replyTo) {
              event.preventDefault();
              onCancelReply();
              return;
            }
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {remaining < 200 && (
          <span className={`composer-count${remaining < 0 ? ' over' : ''}`}>
            {remaining}
          </span>
        )}
        <button
          type="submit"
          className="composer-send"
          aria-label="Enviar mensagem"
          disabled={!text.trim()}
        >
          <Icon name="send" size={20} />
        </button>
      </div>
    </form>
  );
}
