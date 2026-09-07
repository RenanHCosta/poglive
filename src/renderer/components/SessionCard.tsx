import type { LocalState, RoomCommand } from '../../shared/schemas/room';
import { StatusBadge } from './StatusBadge';
interface Props {
  data: LocalState;
  busy: boolean;
  command: (command: RoomCommand) => Promise<void>;
}
export function SessionCard({ data, busy, command }: Props) {
  const state = data.room;
  if (state.status !== 'HOSTING' && state.status !== 'JOINED') return null;
  return (
    <section className="panel session-card">
      <div className="section-heading">
        <h2>{state.room.name}</h2>
        <StatusBadge tone="success">
          {state.status === 'HOSTING' ? 'Sala criada' : 'Conectado'}
        </StatusBadge>
      </div>
      <div className="section-heading">
        <h3>Participantes</h3>
        <span className="count">{state.room.participants.length}/8</span>
      </div>
      <ul className="participants">
        {state.room.participants.map((peer) => (
          <li key={peer.peerId}>
            <span className="avatar" aria-hidden="true">
              {Array.from(peer.displayName)[0]?.toUpperCase()}
            </span>
            <span>
              {peer.displayName}
              {peer.peerId === data.identity?.peerId && <small> (você)</small>}
            </span>
            {peer.role === 'HOST' && <span className="host-label">Host</span>}
          </li>
        ))}
      </ul>
      {state.status === 'HOSTING' && (
        <div className="room-form">
          <label>
            Código de convite
            <input
              readOnly
              value={state.invite}
              spellCheck={false}
              aria-label="Código secreto de convite"
            />
          </label>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              void command({ type: 'COPY_INVITE' });
            }}
          >
            Copiar código
          </button>
          <p>Quem recebe este código pode entrar na sala. Não o publique.</p>
        </div>
      )}
      <button
        className="secondary-button danger"
        disabled={busy}
        onClick={() => {
          void command({ type: 'LEAVE_ROOM' });
        }}
      >
        {state.status === 'HOSTING'
          ? 'Encerrar sala para todos'
          : 'Sair da sala'}
      </button>
    </section>
  );
}
