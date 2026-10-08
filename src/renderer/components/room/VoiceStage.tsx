import { useState } from 'react';
import type { Participant } from '../../../shared/schemas/room';
import type { PeerConnectionView } from '../../services/PeerMesh';
import type { RoomSession } from '../../services/RoomSession';
import { settingsStore } from '../../services/settings';
import { useStore } from '../../services/store';
import { effectiveMuted } from '../../services/voice/VoiceController';
import { Avatar } from '../common/Avatar';
import { Icon } from '../Icon';
import { LocalPreview, StreamPlayer } from './StreamPlayer';

type TileKey = `stream:${string}` | `voice:${string}` | 'self-stream';

export function VoiceStage({
  participants,
  selfId,
  session,
  onShare,
}: {
  participants: Participant[];
  selfId: string;
  session: RoomSession;
  onShare: () => void;
}) {
  const voice = useStore(session.voice.view);
  const mesh = useStore(session.mesh);
  const share = useStore(session.share.state);
  const speaking = useStore(session.voice.speaking);
  const settings = useStore(settingsStore);
  const outputDeviceId =
    settings.status === 'READY' ? settings.settings.audio.outputDeviceId : null;
  const [focusChoice, setFocus] = useState<TileKey | null>(null);
  const connected = voice.status !== 'DISCONNECTED';
  const links = new Map(mesh.peers.map((peer) => [peer.peerId, peer]));
  const inVoice = participants.filter(
    (peer) => peer.voice.connected || (peer.peerId === selfId && connected),
  );
  const streams = mesh.peers.filter(
    (peer) => peer.streamId && peer.status === 'CONNECTED',
  );
  const viewers = mesh.peers.filter(
    (peer) => peer.watchingLocal && peer.status === 'CONNECTED',
  );
  const keys: TileKey[] = [
    ...(share.status === 'LIVE' ? (['self-stream'] as const) : []),
    ...streams.map((peer) => `stream:${peer.peerId}` as const),
    ...inVoice.map((peer) => `voice:${peer.peerId}` as const),
  ];
  // Focus falls back to the grid when the focused stream or person goes away.
  const focus = focusChoice && keys.includes(focusChoice) ? focusChoice : null;
  const renderTile = (key: TileKey) => {
    if (key === 'self-stream' && share.status === 'LIVE')
      return (
        <div
          key={key}
          className={`tile stream-tile self${focus === key ? ' focused' : ''}`}
          onClick={() => setFocus(focus === key ? null : key)}
        >
          <LocalPreview stream={share.stream} />
          <div className="stream-top">
            <span className="live-badge">AO VIVO</span>
            <span className="stream-quality">{share.settings}</span>
          </div>
          <div className="stream-bottom">
            <span className="tile-name">
              Sua transmissão · {share.source.name}
            </span>
            <span className="viewer-count" title="Quem está assistindo">
              <Icon name="eye" size={16} />
              {viewers.length}
            </span>
          </div>
        </div>
      );
    if (key.startsWith('stream:')) {
      const peer = links.get(key.slice(7));
      if (!peer) return null;
      return (
        <StreamTile
          key={key}
          peer={peer}
          focused={focus === key}
          deafened={voice.deafened}
          outputDeviceId={outputDeviceId}
          onFocus={() => setFocus(focus === key ? null : key)}
          onWatch={() => session.watch(peer.peerId)}
          onLeave={() => {
            session.stopWatching(peer.peerId);
            if (focus === key) setFocus(null);
          }}
        />
      );
    }
    const peer = inVoice.find((item) => `voice:${item.peerId}` === key);
    if (!peer) return null;
    const self = peer.peerId === selfId;
    const muted = self ? effectiveMuted(voice) : peer.voice.muted;
    const deafened = self ? voice.deafened : peer.voice.deafened;
    const link = links.get(peer.peerId);
    return (
      <div
        key={key}
        className={`tile voice-tile${speaking.has(peer.peerId) ? ' speaking' : ''}${focus === key ? ' focused' : ''}`}
        onClick={() => setFocus(focus === key ? null : key)}
      >
        <Avatar
          peerId={peer.peerId}
          name={peer.displayName}
          size={focus === key ? 112 : 80}
        />
        <div className="tile-footer">
          <span className="tile-name">
            {peer.displayName}
            {self && ' (você)'}
          </span>
          {(muted || deafened) && (
            <span className="tile-state">
              <Icon name={deafened ? 'headphonesOff' : 'micOff'} size={16} />
            </span>
          )}
        </div>
        {!self && link && link.status !== 'CONNECTED' && (
          <span
            className="tile-warning"
            title="Sem conexão direta com esta pessoa"
          >
            <Icon name="alert" size={16} />
            {link.status === 'ERROR' ? 'Sem conexão' : 'Conectando…'}
          </span>
        )}
      </div>
    );
  };
  const focusedTile = focus ? renderTile(focus) : null;
  const others = keys.filter((key) => key !== focus);
  return (
    <div className="stage">
      {keys.length === 0 ? (
        <div className="stage-empty">
          <span className="stage-empty-icon">
            <Icon name="speaker" size={44} />
          </span>
          <h2>Ninguém na sala de voz ainda</h2>
          <p>
            Entre para conversar. Transmissões de quem estiver na sala também
            aparecem aqui.
          </p>
        </div>
      ) : focusedTile ? (
        <div className="stage-focus">
          <div className="stage-focus-main">{focusedTile}</div>
          {others.length > 0 && (
            <div className="stage-strip">{others.map(renderTile)}</div>
          )}
        </div>
      ) : (
        <div className={`stage-grid count-${Math.min(keys.length, 9)}`}>
          {keys.map(renderTile)}
        </div>
      )}
      {connected && voice.error && (
        <div className="stage-notice" role="status">
          <Icon name="alert" size={16} />
          <span>{voice.error}</span>
          {voice.micUnavailable && (
            <button
              type="button"
              className="button small"
              onClick={() => void session.voice.retryMicrophone()}
            >
              Tentar de novo
            </button>
          )}
        </div>
      )}
      {share.status === 'LIVE' && share.warning && (
        <div className="stage-notice" role="status">
          <Icon name="alert" size={16} />
          <span>{share.warning}</span>
        </div>
      )}
      <div className="stage-controls">
        {connected ? (
          <>
            <button
              type="button"
              className={`control-button${effectiveMuted(voice) ? ' danger' : ''}`}
              aria-pressed={effectiveMuted(voice)}
              aria-label={
                effectiveMuted(voice) ? 'Ativar microfone' : 'Silenciar'
              }
              data-tooltip={
                effectiveMuted(voice) ? 'Ativar microfone' : 'Silenciar'
              }
              onClick={() => session.voice.toggleMute()}
            >
              <Icon name={effectiveMuted(voice) ? 'micOff' : 'mic'} size={24} />
            </button>
            <button
              type="button"
              className={`control-button${voice.deafened ? ' danger' : ''}`}
              aria-pressed={voice.deafened}
              aria-label={voice.deafened ? 'Ativar áudio' : 'Desativar áudio'}
              data-tooltip={voice.deafened ? 'Ativar áudio' : 'Desativar áudio'}
              onClick={() => session.voice.toggleDeafen()}
            >
              <Icon
                name={voice.deafened ? 'headphonesOff' : 'headphones'}
                size={24}
              />
            </button>
            <ShareButton live={share.status === 'LIVE'} onShare={onShare} />
            <button
              type="button"
              className="control-button hangup"
              aria-label="Sair da voz"
              data-tooltip="Sair da voz"
              onClick={() => session.voice.leave()}
            >
              <Icon name="hangup" size={26} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="button success large"
              disabled={voice.status !== 'DISCONNECTED'}
              onClick={() => void session.voice.join()}
            >
              <Icon name="speaker" size={20} />
              Entrar na voz
            </button>
            <ShareButton live={share.status === 'LIVE'} onShare={onShare} />
          </>
        )}
      </div>
    </div>
  );
}

function ShareButton({
  live,
  onShare,
}: {
  live: boolean;
  onShare: () => void;
}) {
  return (
    <button
      type="button"
      className={`control-button${live ? ' active' : ''}`}
      aria-label={live ? 'Parar transmissão' : 'Transmitir tela'}
      data-tooltip={live ? 'Parar transmissão' : 'Transmitir tela'}
      onClick={onShare}
    >
      <Icon name={live ? 'screenOff' : 'screenShare'} size={24} />
    </button>
  );
}

function StreamTile({
  peer,
  focused,
  deafened,
  outputDeviceId,
  onFocus,
  onWatch,
  onLeave,
}: {
  peer: PeerConnectionView;
  focused: boolean;
  deafened: boolean;
  outputDeviceId: string | null;
  onFocus: () => void;
  onWatch: () => void;
  onLeave: () => void;
}) {
  if (
    peer.media &&
    (peer.watchState === 'WATCHING' || peer.watchState === 'CONNECTING')
  )
    return (
      <div className={`tile stream-tile${focused ? ' focused' : ''}`}>
        <StreamPlayer
          stream={peer.media}
          name={peer.displayName}
          quality={peer.quality}
          deafened={deafened}
          outputDeviceId={outputDeviceId}
          focused={focused}
          onFocus={onFocus}
          onLeave={onLeave}
        />
      </div>
    );
  return (
    <div className={`tile stream-tile preview${focused ? ' focused' : ''}`}>
      <Avatar peerId={peer.peerId} name={peer.displayName} size={64} />
      <div className="stream-top">
        <span className="live-badge">AO VIVO</span>
      </div>
      <div className="stream-invite">
        <span>{peer.displayName} está transmitindo</span>
        {peer.watchState === 'ERROR' && (
          <span className="stream-error">
            Não foi possível receber o vídeo.
          </span>
        )}
        <button
          type="button"
          className="button primary"
          disabled={peer.watchState === 'CONNECTING'}
          onClick={(event) => {
            event.stopPropagation();
            onWatch();
          }}
        >
          <Icon name="eye" size={18} />
          {peer.watchState === 'CONNECTING'
            ? 'Conectando…'
            : peer.watchState === 'ERROR'
              ? 'Tentar novamente'
              : 'Assistir transmissão'}
        </button>
      </div>
    </div>
  );
}
