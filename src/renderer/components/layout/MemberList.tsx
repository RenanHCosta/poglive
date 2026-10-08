import type { Participant } from '../../../shared/schemas/room';
import type { RoomSession } from '../../services/RoomSession';
import { useStore } from '../../services/store';
import { Avatar } from '../common/Avatar';
import type { AvatarStatus } from '../common/Avatar';
import type { Anchor } from '../common/Popover';
import { Icon } from '../Icon';

export function MemberList({
  participants,
  selfId,
  session,
  onMember,
}: {
  participants: Participant[];
  selfId: string;
  session: RoomSession;
  onMember: (peerId: string, anchor: Anchor) => void;
}) {
  const speaking = useStore(session.voice.speaking);
  const mesh = useStore(session.mesh);
  const linkStatus = new Map(
    mesh.peers.map((peer) => [peer.peerId, peer.status]),
  );
  const groups: [string, Participant[]][] = [
    ['Na voz', participants.filter((peer) => peer.voice.connected)],
    ['Na sala', participants.filter((peer) => !peer.voice.connected)],
  ];
  return (
    <aside className="member-list" aria-label="Participantes">
      {groups.map(([title, members]) =>
        members.length ? (
          <section key={title}>
            <h3 className="member-group">
              {title} — {members.length}
            </h3>
            <ul>
              {members.map((peer) => {
                const status = linkStatus.get(peer.peerId);
                const avatarStatus: AvatarStatus = peer.voice.streaming
                  ? 'live'
                  : peer.voice.connected
                    ? 'voice'
                    : 'online';
                return (
                  <li key={peer.peerId}>
                    <button
                      type="button"
                      className="member"
                      onClick={(event) => {
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        onMember(peer.peerId, {
                          x: rect.left - 296,
                          y: rect.top,
                        });
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        onMember(peer.peerId, {
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                    >
                      <Avatar
                        peerId={peer.peerId}
                        name={peer.displayName}
                        size={32}
                        speaking={speaking.has(peer.peerId)}
                        status={avatarStatus}
                      />
                      <span className="member-text">
                        <span className="member-name">
                          {peer.displayName}
                          {peer.role === 'HOST' && (
                            <span title="Anfitrião da sala">
                              <Icon name="crown" size={14} className="crown" />
                            </span>
                          )}
                        </span>
                        <span className="member-activity">
                          {peer.peerId === selfId
                            ? 'Você'
                            : status === 'ERROR'
                              ? 'Sem conexão direta'
                              : status === 'CONNECTED'
                                ? peer.voice.streaming
                                  ? 'Transmitindo'
                                  : peer.voice.connected
                                    ? 'Na sala de voz'
                                    : 'Conectado'
                                : 'Conectando…'}
                        </span>
                      </span>
                      {status === 'ERROR' && (
                        <Icon
                          name="alert"
                          size={16}
                          className="member-warning"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null,
      )}
    </aside>
  );
}
