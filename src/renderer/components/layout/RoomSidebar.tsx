import { useState } from 'react';
import type { Participant, RoomState } from '../../../shared/schemas/room';
import type { RoomSession } from '../../services/RoomSession';
import { useStore } from '../../services/store';
import { Avatar } from '../common/Avatar';
import { Popover } from '../common/Popover';
import type { Anchor } from '../common/Popover';
import { Icon } from '../Icon';

export type RoomChannel = 'chat' | 'voice';

type ActiveRoom = Extract<RoomState, { status: 'HOSTING' | 'JOINED' }>;

export function RoomSidebar({
  room,
  selfId,
  session,
  channel,
  onChannel,
  onInvite,
  onLeave,
  onSettings,
  onMember,
  footer,
}: {
  room: ActiveRoom;
  selfId: string;
  session: RoomSession;
  channel: RoomChannel;
  onChannel: (channel: RoomChannel) => void;
  onInvite: () => void;
  onLeave: () => void;
  onSettings: () => void;
  onMember: (peerId: string, anchor: Anchor) => void;
  footer: React.ReactNode;
}) {
  const [menu, setMenu] = useState<Anchor | null>(null);
  const unread = useStore(session.chat.unread);
  const voice = useStore(session.voice.view);
  const speaking = useStore(session.voice.speaking);
  const inVoice = room.room.participants.filter(
    (peer) =>
      peer.voice.connected ||
      (peer.peerId === selfId && voice.status !== 'DISCONNECTED'),
  );
  const hosting = room.status === 'HOSTING';
  return (
    <aside className="sidebar">
      <button
        type="button"
        className={`sidebar-header room-header${menu ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu(menu ? null : { x: rect.left + 8, y: rect.bottom + 6 });
        }}
      >
        <span className="room-header-name">{room.room.name}</span>
        <Icon name={menu ? 'close' : 'chevronDown'} size={18} />
      </button>
      {menu && (
        <Popover
          anchor={menu}
          onClose={() => setMenu(null)}
          label="Menu da sala"
        >
          <div className="menu" role="menu">
            {hosting && (
              <button
                type="button"
                role="menuitem"
                className="menu-item brand"
                onClick={() => {
                  setMenu(null);
                  onInvite();
                }}
              >
                Convidar pessoas
                <Icon name="users" size={18} />
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setMenu(null);
                onSettings();
              }}
            >
              Configurações
              <Icon name="settings" size={18} />
            </button>
            <div className="menu-separator" />
            <button
              type="button"
              role="menuitem"
              className="menu-item danger"
              onClick={() => {
                setMenu(null);
                onLeave();
              }}
            >
              {hosting ? 'Encerrar sala' : 'Sair da sala'}
              <Icon name="logout" size={18} />
            </button>
          </div>
        </Popover>
      )}
      <div className="sidebar-scroll">
        {hosting && (
          <button type="button" className="invite-callout" onClick={onInvite}>
            <Icon name="users" size={18} />
            <span>Convide seus amigos</span>
            <Icon name="chevronRight" size={16} />
          </button>
        )}
        <div className="channel-category">Canais de texto</div>
        <button
          type="button"
          className={`channel${channel === 'chat' ? ' selected' : ''}${unread.count ? ' unread' : ''}`}
          onClick={() => onChannel('chat')}
        >
          <Icon name="hash" size={20} className="channel-icon" />
          <span className="channel-name">chat</span>
          {unread.mentioned && <span className="mention-badge">@</span>}
        </button>
        <div className="channel-category">Canais de voz</div>
        <button
          type="button"
          className={`channel${channel === 'voice' ? ' selected' : ''}`}
          onClick={() => {
            onChannel('voice');
            if (voice.status === 'DISCONNECTED') void session.voice.join();
          }}
          title={
            voice.status === 'DISCONNECTED'
              ? 'Entrar no canal de voz'
              : undefined
          }
        >
          <Icon name="speaker" size={20} className="channel-icon" />
          <span className="channel-name">Sala de voz</span>
          {inVoice.length > 0 && (
            <span className="channel-count">{inVoice.length}</span>
          )}
        </button>
        <ul className="voice-members">
          {inVoice.map((peer) => (
            <VoiceMember
              key={peer.peerId}
              peer={peer}
              self={peer.peerId === selfId}
              speaking={speaking.has(peer.peerId)}
              onOpen={(anchor) => onMember(peer.peerId, anchor)}
            />
          ))}
        </ul>
      </div>
      {footer}
    </aside>
  );
}

function VoiceMember({
  peer,
  self,
  speaking,
  onOpen,
}: {
  peer: Participant;
  self: boolean;
  speaking: boolean;
  onOpen: (anchor: Anchor) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="voice-member"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onOpen({ x: rect.right + 8, y: rect.top });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpen({ x: event.clientX, y: event.clientY });
        }}
      >
        <Avatar
          peerId={peer.peerId}
          name={peer.displayName}
          size={24}
          speaking={speaking}
        />
        <span className={`voice-member-name${speaking ? ' speaking' : ''}`}>
          {peer.displayName}
          {self && <span className="you"> (você)</span>}
        </span>
        <span className="voice-member-icons">
          {peer.voice.streaming && <span className="live-badge">AO VIVO</span>}
          {peer.voice.deafened ? (
            <Icon name="headphonesOff" size={16} className="state-icon" />
          ) : peer.voice.muted ? (
            <Icon name="micOff" size={16} className="state-icon" />
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function VoiceConnectionPanel({
  roomName,
  session,
  onShare,
}: {
  roomName: string;
  session: RoomSession;
  onShare: () => void;
}) {
  const voice = useStore(session.voice.view);
  const share = useStore(session.share.state);
  const mesh = useStore(session.mesh);
  if (voice.status === 'DISCONNECTED') return null;
  const peersInVoice = mesh.peers.filter((peer) => peer.presence.connected);
  const unhealthy = peersInVoice.filter((peer) => peer.status !== 'CONNECTED');
  const quality =
    voice.status === 'CONNECTING'
      ? 'connecting'
      : unhealthy.length === 0
        ? 'good'
        : unhealthy.length === peersInVoice.length
          ? 'bad'
          : 'partial';
  return (
    <section className="voice-panel" aria-label="Conexão de voz">
      <div className="voice-panel-row">
        <div className={`voice-panel-status ${quality}`}>
          <Icon name="signal" size={18} />
          <div>
            <strong>
              {quality === 'connecting'
                ? 'Conectando à voz…'
                : quality === 'good'
                  ? 'Voz conectada'
                  : quality === 'partial'
                    ? 'Conexão parcial'
                    : 'Sem conexão de voz'}
            </strong>
            <span>Sala de voz / {roomName}</span>
          </div>
        </div>
        <button
          type="button"
          className="panel-button"
          aria-label="Desconectar da voz"
          data-tooltip="Desconectar"
          onClick={() => session.voice.leave()}
        >
          <Icon name="hangup" size={20} />
        </button>
      </div>
      {voice.error && <p className="voice-panel-error">{voice.error}</p>}
      <div className="voice-panel-actions">
        <button
          type="button"
          className={`voice-panel-button${share.status === 'LIVE' ? ' active' : ''}`}
          onClick={onShare}
        >
          <Icon
            name={share.status === 'LIVE' ? 'screenOff' : 'screenShare'}
            size={18}
          />
          {share.status === 'LIVE' ? 'Parar' : 'Transmitir'}
        </button>
      </div>
    </section>
  );
}
