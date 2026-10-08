import type { Identity } from '../../../shared/schemas/room';
import type { RoomSession } from '../../services/RoomSession';
import { useStore } from '../../services/store';
import {
  toggleDeafenPref,
  toggleMutePref,
  voicePrefs,
} from '../../services/voice/prefs';
import { Avatar } from '../common/Avatar';
import { Icon } from '../Icon';
import {
  IDLE_SPEAKING,
  IDLE_VOICE_VIEW,
} from '../../services/voice/VoiceController';

const DISCONNECTED_VIEW = {
  status: 'DISCONNECTED' as const,
  micUnavailable: false,
  error: null,
};

export function UserPanel({
  identity,
  session,
  onSettings,
}: {
  identity: Identity;
  session: RoomSession | null;
  onSettings: () => void;
}) {
  const prefs = useStore(voicePrefs);
  const live = useStore(session?.voice.view ?? IDLE_VOICE_VIEW);
  const speaking = useStore(session?.voice.speaking ?? IDLE_SPEAKING);
  const view = session ? live : { ...DISCONNECTED_VIEW, ...prefs };
  const muted = view.selfMuted || view.deafened || view.micUnavailable;
  const status =
    view.status === 'CONNECTED'
      ? 'Na voz'
      : view.status === 'CONNECTING'
        ? 'Conectando…'
        : 'Online';
  return (
    <section className="user-panel" aria-label="Seu perfil">
      <div className="user-panel-identity">
        <Avatar
          peerId={identity.peerId}
          name={identity.displayName}
          size={32}
          speaking={speaking.has(identity.peerId)}
          status={view.status === 'CONNECTED' ? 'voice' : 'online'}
        />
        <div className="user-panel-text">
          <span className="user-panel-name">{identity.displayName}</span>
          <span className="user-panel-status">{status}</span>
        </div>
      </div>
      <div className="user-panel-actions">
        <button
          type="button"
          className={`panel-button${muted ? ' danger' : ''}`}
          aria-pressed={muted}
          aria-label={muted ? 'Ativar microfone' : 'Silenciar microfone'}
          data-tooltip={
            view.micUnavailable
              ? 'Microfone indisponível'
              : muted
                ? 'Ativar microfone'
                : 'Silenciar'
          }
          onClick={() =>
            session ? session.voice.toggleMute() : toggleMutePref()
          }
        >
          <Icon name={muted ? 'micOff' : 'mic'} size={20} />
        </button>
        <button
          type="button"
          className={`panel-button${view.deafened ? ' danger' : ''}`}
          aria-pressed={view.deafened}
          aria-label={view.deafened ? 'Ativar áudio' : 'Desativar áudio'}
          data-tooltip={view.deafened ? 'Ativar áudio' : 'Desativar áudio'}
          onClick={() =>
            session ? session.voice.toggleDeafen() : toggleDeafenPref()
          }
        >
          <Icon
            name={view.deafened ? 'headphonesOff' : 'headphones'}
            size={20}
          />
        </button>
        <button
          type="button"
          className="panel-button"
          aria-label="Configurações de usuário"
          data-tooltip="Configurações"
          onClick={onSettings}
        >
          <Icon name="settings" size={20} />
        </button>
      </div>
    </section>
  );
}
