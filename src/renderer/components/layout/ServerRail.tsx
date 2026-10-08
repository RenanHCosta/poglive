import { initials } from '../common/Avatar';
import { Icon } from '../Icon';

export function ServerRail({
  roomName,
  roomSelected,
  unread,
  onHome,
  onRoom,
  onCreate,
  onJoin,
}: {
  roomName: string | null;
  roomSelected: boolean;
  unread: { count: number; mentioned: boolean };
  onHome: () => void;
  onRoom: () => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <nav className="server-rail" aria-label="Salas">
      <RailButton
        label="Início"
        active={!roomSelected}
        onClick={onHome}
        className="rail-home"
      >
        <img src="./poglive.svg" alt="" />
      </RailButton>
      <div className="rail-separator" />
      {roomName && (
        <RailButton
          label={roomName}
          active={roomSelected}
          onClick={onRoom}
          badge={unread.mentioned ? '@' : null}
          dot={!roomSelected && unread.count > 0}
        >
          <span className="rail-initials">{initials(roomName)}</span>
        </RailButton>
      )}
      <RailButton
        label={roomName ? 'Saia da sala atual para criar outra' : 'Criar sala'}
        onClick={onCreate}
        disabled={!!roomName}
        className="rail-action"
      >
        <Icon name="plus" size={22} />
      </RailButton>
      <RailButton
        label={
          roomName
            ? 'Saia da sala atual para entrar em outra'
            : 'Entrar com convite'
        }
        onClick={onJoin}
        disabled={!!roomName}
        className="rail-action"
      >
        <Icon name="link" size={20} />
      </RailButton>
    </nav>
  );
}

function RailButton({
  label,
  active = false,
  disabled = false,
  onClick,
  className = '',
  children,
  badge,
  dot = false,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
  badge?: string | null;
  dot?: boolean;
}) {
  return (
    <div
      className={`rail-item${active ? ' active' : ''}${dot ? ' unread' : ''}`}
    >
      <span className="rail-pill" aria-hidden="true" />
      <button
        type="button"
        className={`rail-button ${className}`}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        data-tooltip={label}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
      {badge && <span className="rail-badge">{badge}</span>}
    </div>
  );
}
