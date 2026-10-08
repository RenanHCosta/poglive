import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AppInfo } from '../../../shared/contracts';
import type { Identity, RoomCommand } from '../../../shared/schemas/room';
import type {
  Settings,
  ShortcutAction,
} from '../../../shared/schemas/settings';
import {
  acceleratorFromEvent,
  formatAccelerator,
} from '../../services/accelerators';
import { settingsStore, updateSettings } from '../../services/settings';
import { useStore } from '../../services/store';
import { pushToast } from '../../services/toasts';
import { Avatar } from '../common/Avatar';
import { Toggle } from '../common/Toggle';
import { Slider } from '../common/Slider';
import { Icon } from '../Icon';
import { UpdatePanel } from './UpdatePanel';
import { MicrophoneTest } from './MicrophoneTest';

type Section =
  | 'account'
  | 'voice'
  | 'shortcuts'
  | 'notifications'
  | 'stream'
  | 'clips'
  | 'about';

const SECTIONS: { id: Section; label: string; group: string }[] = [
  { id: 'account', label: 'Minha conta', group: 'Configurações de usuário' },
  { id: 'voice', label: 'Voz e áudio', group: 'Configurações do app' },
  { id: 'shortcuts', label: 'Atalhos', group: 'Configurações do app' },
  { id: 'notifications', label: 'Notificações', group: 'Configurações do app' },
  { id: 'stream', label: 'Transmissão', group: 'Configurações do app' },
  { id: 'clips', label: 'Clipes', group: 'Configurações do app' },
  { id: 'about', label: 'Atualizações e sobre', group: 'Poglive' },
];

export function SettingsModal({
  identity,
  inRoom,
  appInfo,
  command,
  onClose,
}: {
  identity: Identity;
  inRoom: boolean;
  appInfo: AppInfo | null;
  command: (command: RoomCommand) => Promise<boolean>;
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section>('account');
  const state = useStore(settingsStore);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (state.status !== 'READY') return null;
  const { settings, unavailableShortcuts } = state;
  return (
    <div
      className="settings"
      role="dialog"
      aria-modal="true"
      aria-label="Configurações"
    >
      <nav className="settings-nav">
        <div className="settings-nav-inner">
          {SECTIONS.map((item, index) => {
            const header =
              item.group !== SECTIONS[index - 1]?.group ? item.group : null;
            return (
              <div key={item.id}>
                {header && <div className="settings-nav-group">{header}</div>}
                <button
                  type="button"
                  className={`settings-nav-item${section === item.id ? ' selected' : ''}`}
                  aria-current={section === item.id ? 'page' : undefined}
                  onClick={() => setSection(item.id)}
                >
                  {item.label}
                </button>
              </div>
            );
          })}
          {appInfo && (
            <div className="settings-version">
              Poglive v{appInfo.version}
              <br />
              {appInfo.platform} {appInfo.arch}
            </div>
          )}
        </div>
      </nav>
      <main className="settings-content">
        <div className="settings-content-inner">
          {section === 'account' && (
            <AccountSection
              identity={identity}
              inRoom={inRoom}
              command={command}
            />
          )}
          {section === 'voice' && <VoiceSection settings={settings} />}
          {section === 'shortcuts' && (
            <ShortcutSection
              settings={settings}
              unavailable={unavailableShortcuts}
            />
          )}
          {section === 'notifications' && (
            <NotificationSection settings={settings} />
          )}
          {section === 'stream' && <StreamSection settings={settings} />}
          {section === 'clips' && <ClipSection settings={settings} />}
          {section === 'about' && (
            <UpdatePanel inRoom={inRoom} appInfo={appInfo} />
          )}
        </div>
        <div className="settings-close">
          <button
            type="button"
            aria-label="Fechar configurações"
            onClick={onClose}
          >
            <Icon name="close" size={20} />
          </button>
          <span>ESC</span>
        </div>
      </main>
    </div>
  );
}

function SettingsHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="settings-header">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </header>
  );
}

function AccountSection({
  identity,
  inRoom,
  command,
}: {
  identity: Identity;
  inRoom: boolean;
  command: (command: RoomCommand) => Promise<boolean>;
}) {
  const [name, setName] = useState(identity.displayName);
  return (
    <>
      <SettingsHeader title="Minha conta" />
      <div className="account-card">
        <div className="account-banner" />
        <div className="account-row">
          <Avatar
            peerId={identity.peerId}
            name={identity.displayName}
            size={80}
          />
          <div>
            <h3>{identity.displayName}</h3>
            <p className="muted">Perfil local deste computador</p>
          </div>
        </div>
        <form
          className="account-form"
          onSubmit={(event) => {
            event.preventDefault();
            void command({ type: 'SAVE_IDENTITY', displayName: name }).then(
              (ok) => {
                if (ok) pushToast('Nome atualizado.', 'success');
              },
            );
          }}
        >
          <label className="field">
            <span className="field-label">Nome de exibição</span>
            <input
              value={name}
              maxLength={32}
              required
              disabled={inRoom}
              onChange={(event) => setName(event.target.value)}
            />
            {inRoom && (
              <span className="field-hint">
                Saia da sala para alterar seu nome.
              </span>
            )}
          </label>
          <button
            type="submit"
            className="button primary"
            disabled={
              inRoom || !name.trim() || name.trim() === identity.displayName
            }
          >
            Salvar
          </button>
        </form>
      </div>
      <p className="field-hint">
        Não existe conta nem senha: seu nome e um identificador aleatório ficam
        salvos apenas neste computador. Quem tem o convite de uma sala vê seu
        nome enquanto você estiver nela.
      </p>
    </>
  );
}

function useAudioDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    let active = true;
    const load = () =>
      void navigator.mediaDevices
        .enumerateDevices()
        .then((list) => {
          if (active) setDevices(list);
        })
        .catch(() => {});
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener('devicechange', load);
    };
  }, []);
  const usable = (kind: MediaDeviceKind) =>
    devices.filter(
      (device) =>
        device.kind === kind &&
        device.deviceId &&
        device.deviceId !== 'default' &&
        device.deviceId !== 'communications',
    );
  return { inputs: usable('audioinput'), outputs: usable('audiooutput') };
}

function VoiceSection({ settings }: { settings: Settings }) {
  const { inputs, outputs } = useAudioDevices();
  const audio = settings.audio;
  const setAudio = (change: Partial<Settings['audio']>) =>
    updateSettings((current) => ({
      ...current,
      audio: { ...current.audio, ...change },
    }));
  return (
    <>
      <SettingsHeader title="Voz e áudio" />
      <div className="settings-grid">
        <label className="field">
          <span className="field-label">Dispositivo de entrada</span>
          <select
            value={audio.inputDeviceId ?? ''}
            onChange={(event) =>
              setAudio({ inputDeviceId: event.target.value || null })
            }
          >
            <option value="">Padrão do Windows</option>
            {inputs.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microfone ${index + 1}`}
              </option>
            ))}
            {audio.inputDeviceId &&
              !inputs.some(
                (device) => device.deviceId === audio.inputDeviceId,
              ) && (
                <option value={audio.inputDeviceId}>
                  Dispositivo desconectado
                </option>
              )}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Dispositivo de saída</span>
          <select
            value={audio.outputDeviceId ?? ''}
            onChange={(event) =>
              setAudio({ outputDeviceId: event.target.value || null })
            }
          >
            <option value="">Padrão do Windows</option>
            {outputs.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Saída ${index + 1}`}
              </option>
            ))}
            {audio.outputDeviceId &&
              !outputs.some(
                (device) => device.deviceId === audio.outputDeviceId,
              ) && (
                <option value={audio.outputDeviceId}>
                  Dispositivo desconectado
                </option>
              )}
          </select>
        </label>
        <label className="field">
          <span className="field-label">
            Volume de entrada <output>{audio.inputVolume}%</output>
          </span>
          <Slider
            min={0}
            max={200}
            step={5}
            value={audio.inputVolume}
            label="Volume de entrada"
            onChange={(value) => setAudio({ inputVolume: value })}
          />
        </label>
        <label className="field">
          <span className="field-label">
            Volume de saída <output>{audio.outputVolume}%</output>
          </span>
          <Slider
            min={0}
            max={200}
            step={5}
            value={audio.outputVolume}
            label="Volume de saída"
            onChange={(value) => setAudio({ outputVolume: value })}
          />
        </label>
      </div>
      <div className="settings-divider" />
      <h3 className="settings-subtitle">Sensibilidade de entrada</h3>
      <Toggle
        checked={audio.automaticSensitivity}
        onChange={(automaticSensitivity) => setAudio({ automaticSensitivity })}
        label="Determinar automaticamente a sensibilidade"
        description="Acompanha o ruído do ambiente e transmite apenas quando você fala."
      />
      {!audio.automaticSensitivity && (
        <label className="field">
          <span className="field-label">
            Limite manual <output>{Math.round(audio.sensitivityDb)} dB</output>
          </span>
          <Slider
            min={-100}
            max={0}
            step={1}
            value={audio.sensitivityDb}
            label="Limite manual de sensibilidade"
            onChange={(value) => setAudio({ sensitivityDb: value })}
          />
        </label>
      )}
      <MicrophoneTest
        audio={audio}
        onThreshold={(sensitivityDb) => setAudio({ sensitivityDb })}
      />
      <div className="settings-divider" />
      <h3 className="settings-subtitle">Processamento de voz</h3>
      <Toggle
        checked={audio.noiseSuppression}
        onChange={(noiseSuppression) => setAudio({ noiseSuppression })}
        label="Supressão de ruído"
        description="Reduz ventiladores, teclado e ruído de fundo."
      />
      <Toggle
        checked={audio.echoCancellation}
        onChange={(echoCancellation) => setAudio({ echoCancellation })}
        label="Cancelamento de eco"
        description="Evita que quem fala ouça a própria voz quando você usa caixas de som."
      />
      <Toggle
        checked={audio.autoGainControl}
        onChange={(autoGainControl) => setAudio({ autoGainControl })}
        label="Controle automático de ganho"
        description="Equilibra o volume quando você se aproxima ou se afasta do microfone."
      />
    </>
  );
}

const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  TOGGLE_MUTE: 'Silenciar ou ativar o microfone',
  TOGGLE_DEAFEN: 'Desativar ou ativar o áudio',
  SAVE_CLIP: 'Salvar clipe da transmissão em foco',
};

function ShortcutSection({
  settings,
  unavailable,
}: {
  settings: Settings;
  unavailable: ShortcutAction[];
}) {
  return (
    <>
      <SettingsHeader title="Atalhos">
        Atalhos globais funcionam mesmo com um jogo ou outro aplicativo em foco.
        Use pelo menos uma tecla modificadora (Ctrl, Alt, Shift) ou F13–F24.
      </SettingsHeader>
      <div className="shortcut-list">
        {(Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).map((action) => (
          <ShortcutRow
            key={action}
            label={SHORTCUT_LABELS[action]}
            value={settings.shortcuts[action]}
            unavailable={unavailable.includes(action)}
            onChange={(accelerator) =>
              updateSettings((current) => ({
                ...current,
                shortcuts: { ...current.shortcuts, [action]: accelerator },
              }))
            }
          />
        ))}
      </div>
    </>
  );
}

function ShortcutRow({
  label,
  value,
  unavailable,
  onChange,
}: {
  label: string;
  value: string | null;
  unavailable: boolean;
  onChange: (accelerator: string | null) => void;
}) {
  const [recording, setRecording] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecording(false);
        return;
      }
      const accelerator = acceleratorFromEvent(event);
      if (accelerator) {
        onChange(accelerator);
        setRecording(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, onChange]);
  return (
    <div className="shortcut-row">
      <div>
        <span className="toggle-label">{label}</span>
        {unavailable && (
          <span className="form-error">
            Este atalho já está em uso por outro aplicativo.
          </span>
        )}
      </div>
      <div className="shortcut-actions">
        <button
          ref={button}
          type="button"
          className={`shortcut-key${recording ? ' recording' : ''}`}
          onClick={() => setRecording(!recording)}
          onBlur={() => setRecording(false)}
        >
          <Icon name="keyboard" size={16} />
          {recording
            ? 'Pressione a combinação…'
            : value
              ? formatAccelerator(value)
              : 'Sem atalho'}
        </button>
        {value && (
          <button
            type="button"
            className="icon-button"
            aria-label="Remover atalho"
            data-tooltip="Remover atalho"
            onClick={() => onChange(null)}
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function NotificationSection({ settings }: { settings: Settings }) {
  return (
    <>
      <SettingsHeader title="Notificações" />
      <Toggle
        checked={settings.notifications.sounds}
        onChange={(sounds) =>
          updateSettings((current) => ({
            ...current,
            notifications: { ...current.notifications, sounds },
          }))
        }
        label="Sons do aplicativo"
        description="Entrada e saída da voz, silenciar, transmissões e novas mensagens."
      />
      <p className="field-hint">
        Quando a janela está em segundo plano, novas mensagens também piscam o
        ícone na barra de tarefas.
      </p>
    </>
  );
}

function ClipSection({ settings }: { settings: Settings }) {
  const clips = settings.clips;
  const setClips = (change: Partial<Settings['clips']>) =>
    updateSettings((current) => ({
      ...current,
      clips: { ...current.clips, ...change },
    }));
  return (
    <>
      <SettingsHeader title="Clipes">
        Salve os últimos segundos de uma transmissão que você está assistindo,
        pelo botão de tesoura no player ou pelo atalho. Os arquivos ficam em
        Vídeos\Poglive.
      </SettingsHeader>
      <Toggle
        checked={clips.enabled}
        onChange={(enabled) => setClips({ enabled })}
        label="Manter clipes disponíveis"
        description="Enquanto você assiste, o Poglive guarda na memória os segundos mais recentes. Isso usa um pouco de CPU para cada transmissão aberta."
      />
      <label className="field">
        <span className="field-label">Duração do clipe</span>
        <select
          value={clips.durationSeconds}
          disabled={!clips.enabled}
          onChange={(event) => {
            const durationSeconds = Number(event.target.value);
            if (
              durationSeconds === 15 ||
              durationSeconds === 30 ||
              durationSeconds === 60
            )
              setClips({ durationSeconds });
          }}
        >
          <option value={15}>Últimos 15 segundos</option>
          <option value={30}>Últimos 30 segundos</option>
          <option value={60}>Último minuto</option>
        </select>
      </label>
      <Toggle
        checked={clips.recordOwnStream}
        disabled={!clips.enabled}
        onChange={(recordOwnStream) => setClips({ recordOwnStream })}
        label="Clipes da minha transmissão"
        description="Também guarda os últimos segundos do que você transmite, para salvar seus próprios momentos."
      />
      <div>
        <button
          type="button"
          className="button secondary"
          onClick={() =>
            void window.pogLive.openClipFolder().then((result) => {
              if (result.status === 'ERROR') pushToast(result.message, 'error');
            })
          }
        >
          <Icon name="folder" size={18} />
          Abrir pasta de clipes
        </button>
      </div>
      <p className="field-hint">
        Quem transmite é avisado quando alguém salva um clipe da transmissão
        dele. Clipes ficam só no seu computador; nada é enviado a servidores.
      </p>
    </>
  );
}

function StreamSection({ settings }: { settings: Settings }) {
  const stream = settings.stream;
  const setStream = (change: Partial<Settings['stream']>) =>
    updateSettings((current) => ({
      ...current,
      stream: { ...current.stream, ...change },
    }));
  return (
    <>
      <SettingsHeader title="Transmissão">
        Valores iniciais do seletor de transmissão. Você pode mudar a cada
        transmissão.
      </SettingsHeader>
      <div className="settings-grid">
        <label className="field">
          <span className="field-label">Resolução</span>
          <select
            value={stream.quality}
            onChange={(event) => {
              const quality = event.target.value;
              if (
                quality === '720p' ||
                quality === '1080p' ||
                quality === 'native'
              )
                setStream({ quality });
            }}
          >
            <option value="720p">720p · menor uso de rede</option>
            <option value="1080p">1080p · mais detalhes</option>
            <option value="native">
              Nativa · resolução do monitor, até 4K
            </option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Taxa de quadros</span>
          <select
            value={stream.frameRate}
            onChange={(event) => {
              const frameRate = Number(event.target.value);
              if (frameRate === 30 || frameRate === 60)
                setStream({ frameRate });
            }}
          >
            <option value={30}>30 FPS · textos e apresentações</option>
            <option value={60}>60 FPS · jogos e vídeos</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Áudio</span>
          <select
            value={stream.audioMode}
            onChange={(event) => {
              const audioMode = event.target.value;
              if (
                audioMode === 'NONE' ||
                audioMode === 'SYSTEM' ||
                audioMode === 'WINDOW'
              )
                setStream({ audioMode });
            }}
          >
            <option value="SYSTEM">
              Áudio do computador (sem Poglive e Discord)
            </option>
            <option value="WINDOW">Somente o aplicativo transmitido</option>
            <option value="NONE">Sem áudio</option>
          </select>
        </label>
      </div>
      <Toggle
        checked={stream.adaptiveQuality}
        onChange={(adaptiveQuality) => setStream({ adaptiveQuality })}
        label="Qualidade adaptativa por espectador"
        description="Reduz rapidamente sob perda de pacotes ou CPU alta e recupera aos poucos."
      />
      <p className="field-hint">
        Os modos de áudio usam a captura por processo do Windows 10 build 20348
        ou mais recente. Em versões anteriores, a transmissão segue sem áudio.
      </p>
    </>
  );
}
