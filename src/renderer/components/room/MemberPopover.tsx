import type { Participant } from '../../../shared/schemas/room';
import type { RoomSession } from '../../services/RoomSession';
import { settingsStore, updateSettings } from '../../services/settings';
import { useStore } from '../../services/store';
import { Avatar } from '../common/Avatar';
import { Popover } from '../common/Popover';
import { Slider } from '../common/Slider';
import type { Anchor } from '../common/Popover';
import { Icon } from '../Icon';

const LINK_LABELS = {
  WAITING: 'Aguardando conexão direta',
  CONNECTING: 'Conectando…',
  CONNECTED: 'Conexão direta ativa',
  DISCONNECTED: 'Conexão interrompida',
  ERROR: 'Sem conexão direta',
} as const;

export function MemberPopover({
  peer,
  selfId,
  session,
  anchor,
  onClose,
}: {
  peer: Participant;
  selfId: string;
  session: RoomSession;
  anchor: Anchor;
  onClose: () => void;
}) {
  const settings = useStore(settingsStore);
  const mesh = useStore(session.mesh);
  const link = mesh.peers.find((item) => item.peerId === peer.peerId);
  const self = peer.peerId === selfId;
  const preference =
    settings.status === 'READY'
      ? (settings.settings.peers[peer.peerId] ?? { volume: 100, muted: false })
      : { volume: 100, muted: false };
  const setPreference = (next: typeof preference) =>
    updateSettings((current) => {
      const peers = { ...current.peers };
      if (next.volume === 100 && !next.muted) delete peers[peer.peerId];
      else peers[peer.peerId] = next;
      return { ...current, peers };
    });
  const incompatible = link?.diagnostic?.startsWith('INCOMPATIBLE_VERSION');
  return (
    <Popover anchor={anchor} onClose={onClose} label={peer.displayName}>
      <div className="profile-card">
        <div className="profile-banner" />
        <div className="profile-avatar">
          <Avatar peerId={peer.peerId} name={peer.displayName} size={72} />
        </div>
        <div className="profile-body">
          <h3>
            {peer.displayName}
            {peer.role === 'HOST' && (
              <Icon name="crown" size={16} className="crown" />
            )}
          </h3>
          <p className="profile-role">
            {self
              ? 'Você'
              : peer.role === 'HOST'
                ? 'Anfitrião da sala'
                : 'Participante'}
          </p>
          {!self && link && (
            <div className={`profile-link ${link.status.toLowerCase()}`}>
              <Icon name="signal" size={16} />
              <span>{LINK_LABELS[link.status]}</span>
              {link.status === 'ERROR' &&
                !incompatible &&
                selfId < peer.peerId && (
                  <button
                    type="button"
                    className="button small"
                    onClick={() => session.reconnect(peer.peerId)}
                  >
                    Tentar de novo
                  </button>
                )}
            </div>
          )}
          {link?.status === 'ERROR' &&
            !incompatible &&
            selfId > peer.peerId && (
              <p className="field-hint">
                O computador dessa pessoa refaz a conexão automaticamente em
                alguns segundos.
              </p>
            )}
          {incompatible && (
            <p className="profile-warning">
              Esta pessoa usa uma versão diferente do Poglive. Atualizem o app e
              entrem novamente.
            </p>
          )}
          {!self && (
            <div className="profile-audio">
              <label className="field">
                <span className="field-label">
                  Volume do usuário
                  <output>{preference.volume}%</output>
                </span>
                <Slider
                  min={0}
                  max={200}
                  step={5}
                  value={preference.volume}
                  label="Volume do usuário"
                  onChange={(value) =>
                    setPreference({
                      ...preference,
                      volume: value,
                    })
                  }
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={preference.muted}
                  onChange={(event) =>
                    setPreference({
                      ...preference,
                      muted: event.target.checked,
                    })
                  }
                />
                Silenciar para mim
              </label>
            </div>
          )}
          {!self && link?.diagnostic && (
            <details className="profile-diagnostic">
              <summary>Diagnóstico da conexão</summary>
              <code>{link.diagnostic}</code>
              <p>
                Contagens local/remoto, sem endereços. Útil para investigar
                firewall e rede.
              </p>
            </details>
          )}
        </div>
      </div>
    </Popover>
  );
}
