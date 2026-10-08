import { useCallback, useMemo, useState } from 'react';
import type { Identity, RoomState } from '../../../shared/schemas/room';
import type { RoomSession } from '../../services/RoomSession';
import { useStore } from '../../services/store';
import type { Anchor } from '../common/Popover';
import { Icon } from '../Icon';
import { MemberList } from '../layout/MemberList';
import { RoomSidebar, VoiceConnectionPanel } from '../layout/RoomSidebar';
import type { RoomChannel } from '../layout/RoomSidebar';
import { UserPanel } from '../layout/UserPanel';
import { ChatView } from './ChatView';
import { MemberPopover } from './MemberPopover';
import { VoiceStage } from './VoiceStage';

type ActiveRoom = Extract<RoomState, { status: 'HOSTING' | 'JOINED' }>;

export function RoomLayout({
  room,
  identity,
  session,
  onInvite,
  onLeave,
  onSettings,
  onShare,
}: {
  room: ActiveRoom;
  identity: Identity;
  session: RoomSession;
  onInvite: () => void;
  onLeave: () => void;
  onSettings: () => void;
  onShare: () => void;
}) {
  const [channel, setChannel] = useState<RoomChannel>('voice');
  const [showMembers, setShowMembers] = useState(true);
  const [voiceChat, setVoiceChat] = useState(false);
  const [member, setMember] = useState<{
    peerId: string;
    anchor: Anchor;
  } | null>(null);
  const unread = useStore(session.chat.unread);
  const participants = room.room.participants;
  // Presence updates replace the participants array; only a change in names
  // should re-parse chat messages.
  const namesKey = participants.map((peer) => peer.displayName).join('\n');
  const names = useMemo(() => namesKey.split('\n'), [namesKey]);
  const openMember = useCallback(
    (peerId: string, anchor: Anchor) => setMember({ peerId, anchor }),
    [],
  );
  const memberPeer = member
    ? participants.find((peer) => peer.peerId === member.peerId)
    : undefined;
  return (
    <>
      <RoomSidebar
        room={room}
        selfId={identity.peerId}
        session={session}
        channel={channel}
        onChannel={setChannel}
        onInvite={onInvite}
        onLeave={onLeave}
        onSettings={onSettings}
        onMember={openMember}
        footer={
          <>
            <VoiceConnectionPanel
              roomName={room.room.name}
              session={session}
              onShare={onShare}
            />
            <UserPanel
              identity={identity}
              session={session}
              onSettings={onSettings}
            />
          </>
        }
      />
      <main className="content">
        <header className="content-header">
          <Icon name={channel === 'chat' ? 'hash' : 'speaker'} size={22} />
          <h1>{channel === 'chat' ? 'chat' : 'Sala de voz'}</h1>
          <span className="content-topic">
            {channel === 'chat'
              ? 'Mensagens da sala, apagadas quando ela for encerrada'
              : `${room.room.name} · ${participants.length}/8 na sala`}
          </span>
          <div className="content-header-actions">
            {channel === 'voice' ? (
              <button
                type="button"
                className={`header-button${voiceChat ? ' active' : ''}${unread.count ? ' unread' : ''}`}
                aria-pressed={voiceChat}
                aria-label="Mostrar chat"
                data-tooltip={voiceChat ? 'Ocultar chat' : 'Mostrar chat'}
                onClick={() => setVoiceChat(!voiceChat)}
              >
                <Icon name="message" size={20} />
              </button>
            ) : (
              <button
                type="button"
                className={`header-button${showMembers ? ' active' : ''}`}
                aria-pressed={showMembers}
                aria-label="Lista de participantes"
                data-tooltip={
                  showMembers
                    ? 'Ocultar participantes'
                    : 'Mostrar participantes'
                }
                onClick={() => setShowMembers(!showMembers)}
              >
                <Icon name="users" size={20} />
              </button>
            )}
          </div>
        </header>
        <div className="content-body">
          {channel === 'chat' ? (
            <>
              <ChatView
                session={session}
                self={identity}
                names={names}
                roomName={room.room.name}
              />
              {showMembers && (
                <MemberList
                  participants={participants}
                  selfId={identity.peerId}
                  session={session}
                  onMember={openMember}
                />
              )}
            </>
          ) : (
            <>
              <VoiceStage
                participants={participants}
                selfId={identity.peerId}
                session={session}
                onShare={onShare}
              />
              {voiceChat && (
                <aside className="voice-chat">
                  <ChatView
                    session={session}
                    self={identity}
                    names={names}
                    roomName={room.room.name}
                    compact
                  />
                </aside>
              )}
            </>
          )}
        </div>
      </main>
      {member && memberPeer && (
        <MemberPopover
          peer={memberPeer}
          selfId={identity.peerId}
          session={session}
          anchor={member.anchor}
          onClose={() => setMember(null)}
        />
      )}
    </>
  );
}
