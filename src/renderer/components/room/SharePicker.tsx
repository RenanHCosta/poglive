import { useEffect, useState } from 'react';
import type {
  CaptureOptions,
  CaptureSource,
} from '../../../shared/schemas/capture';
import type { RoomSession } from '../../services/RoomSession';
import { currentSettings, updateSettings } from '../../services/settings';
import { useStore } from '../../services/store';
import { DEFAULT_SETTINGS } from '../../../shared/schemas/settings';
import { Modal } from '../common/Modal';
import { Toggle } from '../common/Toggle';
import { Icon } from '../Icon';

export function SharePicker({
  session,
  onClose,
}: {
  session: RoomSession;
  onClose: () => void;
}) {
  const state = useStore(session.share.state);
  const [kind, setKind] = useState<'window' | 'screen'>('window');
  const [selected, setSelected] = useState<CaptureSource | null>(null);
  const [options, setOptions] = useState<CaptureOptions>(
    () => currentSettings()?.stream ?? DEFAULT_SETTINGS.stream,
  );
  useEffect(() => {
    void session.share.list();
  }, [session]);
  // The modal closes itself once the share is live or the session ends.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (started && state.status === 'LIVE') onClose();
  }, [started, state.status, onClose]);
  const sources = state.status === 'SELECTING_SOURCE' ? state.sources : [];
  const visible = sources.filter((source) => source.kind === kind);
  const close = () => {
    session.share.cancelSelection();
    onClose();
  };
  const start = () => {
    if (!selected) return;
    updateSettings((current) => ({ ...current, stream: options }));
    setStarted(true);
    void session.share.start(selected, options);
  };
  const windowAudioBlocked =
    options.audioMode === 'WINDOW' && selected?.kind === 'screen';
  return (
    <Modal
      title="Transmitir tela"
      subtitle="Escolha uma janela ou tela. Só quem clicar em Assistir recebe o vídeo."
      size="large"
      onClose={close}
      footer={
        <>
          <button type="button" className="button link" onClick={close}>
            Cancelar
          </button>
          <button
            type="button"
            className="button primary"
            disabled={
              !selected || state.status === 'STARTING' || windowAudioBlocked
            }
            onClick={start}
          >
            {state.status === 'STARTING' ? 'Iniciando…' : 'Transmitir'}
          </button>
        </>
      }
    >
      <div className="share-picker">
        <div className="segmented" role="tablist" aria-label="Tipo de fonte">
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'window'}
            onClick={() => setKind('window')}
          >
            <Icon name="window" size={16} /> Aplicativos
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'screen'}
            onClick={() => setKind('screen')}
          >
            <Icon name="monitor" size={16} /> Telas
          </button>
          <button
            type="button"
            className="segmented-refresh"
            aria-label="Atualizar lista"
            data-tooltip="Atualizar lista"
            onClick={() => {
              setSelected(null);
              void session.share.list();
            }}
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>
        {state.status === 'LOADING' && (
          <p className="muted">Carregando fontes…</p>
        )}
        {state.status === 'ERROR' && (
          <p className="form-error" role="alert">
            {state.message}
          </p>
        )}
        {state.status === 'LIVE' && state.warning && (
          <p className="form-error" role="alert">
            {state.warning}
          </p>
        )}
        <div className="source-grid">
          {visible.map((source) => (
            <button
              key={source.id}
              type="button"
              className={`source${selected?.id === source.id ? ' selected' : ''}`}
              aria-pressed={selected?.id === source.id}
              onClick={() => setSelected(source)}
              onDoubleClick={() => {
                setSelected(source);
                if (!(
                  options.audioMode === 'WINDOW' && source.kind === 'screen'
                )) {
                  updateSettings((current) => ({
                    ...current,
                    stream: options,
                  }));
                  setStarted(true);
                  void session.share.start(source, options);
                }
              }}
            >
              <img src={source.thumbnail} alt="" />
              <span>{source.name}</span>
            </button>
          ))}
          {state.status === 'SELECTING_SOURCE' && visible.length === 0 && (
            <p className="muted">
              Nenhuma {kind === 'window' ? 'janela' : 'tela'} encontrada. Abra o
              aplicativo e atualize a lista.
            </p>
          )}
        </div>
        <div className="share-options">
          <label className="field">
            <span className="field-label">Resolução</span>
            <select
              value={options.quality}
              onChange={(event) => {
                const quality = event.target.value;
                if (
                  quality === '720p' ||
                  quality === '1080p' ||
                  quality === 'native'
                )
                  setOptions({ ...options, quality });
              }}
            >
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
              <option value="native">Nativa (até 4K)</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Taxa de quadros</span>
            <select
              value={options.frameRate}
              onChange={(event) => {
                const frameRate = Number(event.target.value);
                if (frameRate === 30 || frameRate === 60)
                  setOptions({ ...options, frameRate });
              }}
            >
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Áudio</span>
            <select
              value={options.audioMode}
              onChange={(event) => {
                const audioMode = event.target.value;
                if (
                  audioMode === 'NONE' ||
                  audioMode === 'SYSTEM' ||
                  audioMode === 'WINDOW'
                )
                  setOptions({ ...options, audioMode });
              }}
            >
              <option value="SYSTEM">
                Áudio do computador (sem Poglive e Discord)
              </option>
              <option value="WINDOW">Somente o aplicativo</option>
              <option value="NONE">Sem áudio</option>
            </select>
          </label>
        </div>
        <Toggle
          checked={options.adaptiveQuality}
          onChange={(adaptiveQuality) =>
            setOptions({ ...options, adaptiveQuality })
          }
          label="Qualidade adaptativa"
          description="Reduz resolução e FPS para quem tiver rede ou computador mais fraco. A escolha acima é o máximo."
        />
        {options.quality === 'native' && (
          <p className="field-hint">
            A resolução nativa usa o tamanho real da tela ou janela (até 4K) e
            consome mais rede: cerca de {options.frameRate === 60 ? '20' : '10'}{' '}
            Mbps por pessoa assistindo. Se a rede não aguentar, a qualidade
            adaptativa desce para 1080p.
          </p>
        )}
        <p className="field-hint">
          {windowAudioBlocked
            ? '“Somente o aplicativo” exige uma janela. Escolha uma janela ou outro modo de áudio.'
            : options.audioMode === 'SYSTEM'
              ? 'Transmite o som dos aplicativos do computador, exceto o Poglive e o Discord: nenhuma chamada volta pela transmissão.'
              : options.audioMode === 'WINDOW'
                ? 'Transmite apenas o som do aplicativo escolhido e dos processos dele.'
                : 'A transmissão terá somente vídeo.'}
        </p>
      </div>
    </Modal>
  );
}
