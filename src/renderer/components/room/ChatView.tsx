import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MAX_CHAT_LENGTH } from '../../../shared/schemas/chat';
import type { Identity } from '../../../shared/schemas/room';
import type { ChatEntry } from '../../services/ChatController';
import { mentions } from '../../services/ChatController';
import type { RoomSession } from '../../services/RoomSession';
import { useStore } from '../../services/store';
import { Avatar } from '../common/Avatar';
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

function dayLabel(time: number): string {
  const date = new Date(time);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return dayFormat.format(date);
}

export function ChatView({
  session,
  self,
  names,
  roomName,
  compact = false,
}: {
  session: RoomSession;
  self: Identity;
  names: string[];
  roomName: string;
  compact?: boolean;
}) {
  const entries = useStore(session.chat.entries);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    session.chat.setVisible(true);
    return () => session.chat.setVisible(false);
  }, [session]);
  useLayoutEffect(() => {
    const element = list.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [entries]);
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
              onRetry={() => session.chat.retry(entry.id)}
              onDiscard={() => session.chat.discard(entry.id)}
            />
          ))}
        </ol>
      </div>
      <Composer
        roomName={roomName}
        names={names}
        onSend={(text) => {
          stick.current = true;
          return session.chat.send(text);
        }}
      />
    </div>
  );
}

function MessageRow({
  entry,
  previous,
  self,
  names,
  onRetry,
  onDiscard,
}: {
  entry: ChatEntry;
  previous: ChatEntry | undefined;
  self: Identity;
  names: string[];
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
  const grouped =
    !newDay &&
    previous?.kind === 'MESSAGE' &&
    previous.authorId === entry.authorId &&
    entry.sentAt - previous.sentAt < GROUP_WINDOW_MS;
  const mentioned =
    entry.authorId !== self.peerId && mentions(entry.text, self.displayName);
  return (
    <>
      {divider}
      <li
        className={`message${grouped ? ' grouped' : ''}${mentioned ? ' mentioned' : ''}${entry.delivery !== 'SENT' ? ` ${entry.delivery.toLowerCase()}` : ''}`}
      >
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
          <MessageContent
            text={entry.text}
            names={names}
            selfName={self.displayName}
          />
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
      </li>
    </>
  );
}

function Composer({
  roomName,
  names,
  onSend,
}: {
  roomName: string;
  names: string[];
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
      <div className="composer-box">
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
