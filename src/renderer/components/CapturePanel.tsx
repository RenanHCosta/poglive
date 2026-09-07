import { useEffect, useRef, useState } from 'react';
import { useCapture } from '../hooks/useCapture';
import type { CaptureOptions } from '../../shared/schemas/capture';

function VideoPreview({ stream }: { stream: MediaStream }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = stream;
    return () => {
      element.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      className="capture-video"
      ref={video}
      autoPlay
      muted
      playsInline
      aria-label="Preview local da captura"
    />
  );
}
export function CapturePanel({
  enabled,
  onStream,
}: {
  enabled: boolean;
  onStream?: (stream: MediaStream | null) => void;
}) {
  const { state, list, start, stop } = useCapture();
  const stream = state.status === 'PREVIEW' ? state.stream : null;
  useEffect(() => {
    onStream?.(stream);
    return () => onStream?.(null);
  }, [stream, onStream]);
  const [kind, setKind] = useState<'screen' | 'window'>('screen');
  const [options, setOptions] = useState<CaptureOptions>({
    quality: '720p',
    frameRate: 30,
    audioMode: 'NONE',
  });
  return (
    <section className="panel share-card" aria-labelledby="capture-title">
      <div className="section-heading">
        <h2 id="capture-title">Captura de tela</h2>
        <span className="eyebrow">
          {stream && onStream ? 'COMPARTILHANDO' : 'SUA TELA'}
        </span>
      </div>
      {!stream && (
        <fieldset
          className="capture-options"
          disabled={
            !enabled ||
            state.status === 'STARTING' ||
            state.status === 'LOADING'
          }
        >
          <legend>Qualidade e áudio</legend>
          <label>
            Resolução
            <select
              value={options.quality}
              onChange={(event) => {
                const quality = event.target.value;
                if (quality === '720p' || quality === '1080p')
                  setOptions({ ...options, quality });
              }}
            >
              <option value="720p">720p · menor uso de rede</option>
              <option value="1080p">1080p · mais detalhes</option>
            </select>
          </label>
          <label>
            Taxa de quadros
            <select
              value={options.frameRate}
              onChange={(event) => {
                const frameRate = Number(event.target.value);
                if (frameRate === 30 || frameRate === 60)
                  setOptions({ ...options, frameRate });
              }}
            >
              <option value={30}>30 FPS · menor uso de recursos</option>
              <option value={60}>60 FPS · mais fluidez</option>
            </select>
          </label>
          <p className="helper">
            60 FPS depende da fonte, rede e hardware. Para mudar, reinicie a
            captura.
          </p>
          <label>
            Áudio
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
                if (audioMode === 'WINDOW') setKind('window');
              }}
            >
              <option value="NONE">Sem áudio</option>
              <option value="WINDOW">Somente a janela escolhida</option>
              <option value="SYSTEM">Todo o áudio do sistema</option>
            </select>
          </label>
          <p className="helper">
            “Somente a janela” também inclui processos filhos e não transmite
            Discord ou notificações. Requer Windows 11/build 20348+. Áudio do
            sistema continua incluindo todos os aplicativos.
          </p>
        </fieldset>
      )}
      {state.status === 'PREVIEW' ? (
        <>
          <VideoPreview stream={state.stream} />
          <p className="capture-name">{state.sourceName}</p>
          <p>
            {state.quality} ·{' '}
            {state.stream
              .getAudioTracks()
              .some((track) => track.readyState === 'live')
              ? 'Com áudio'
              : 'Somente vídeo'}
          </p>
          {state.warning && (
            <p role="status" className="error-message">
              {state.warning}
            </p>
          )}
          <p className="helper">
            Para alterar qualidade ou áudio, encerre e selecione a fonte
            novamente.
          </p>
          <button className="secondary-button danger" onClick={stop}>
            Encerrar compartilhamento
          </button>
        </>
      ) : state.status === 'SELECTING_SOURCE' ? (
        <>
          <div className="room-tabs" role="group" aria-label="Tipo de fonte">
            <button
              className="secondary-button"
              aria-pressed={kind === 'screen'}
              disabled={options.audioMode === 'WINDOW'}
              onClick={() => setKind('screen')}
            >
              Monitores
            </button>
            <button
              className="secondary-button"
              aria-pressed={kind === 'window'}
              onClick={() => setKind('window')}
            >
              Janelas
            </button>
          </div>
          <p>Escolha uma fonte para compartilhar com a sala.</p>
          <div className="capture-sources">
            {state.sources
              .filter((source) => source.kind === kind)
              .map((source) => (
                <button
                  key={source.id}
                  className="capture-source"
                  onClick={() => {
                    void start(source, options);
                  }}
                >
                  <img src={source.thumbnail} alt="" />
                  <span>{source.name}</span>
                </button>
              ))}
            {!state.sources.some((source) => source.kind === kind) && (
              <p>
                Nenhuma fonte encontrada. Abra uma janela e atualize a lista.
              </p>
            )}
          </div>
          <div className="room-tabs">
            <button
              className="secondary-button"
              onClick={() => {
                void list();
              }}
            >
              Atualizar lista
            </button>
            <button className="secondary-button" onClick={stop}>
              Cancelar
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="preview-empty">
            <div className="screen-illustration" aria-hidden="true">
              <div>
                <span>↗</span>
              </div>
              <i />
            </div>
            <h3>Escolha o que mostrar.</h3>
            <p>Veja um monitor inteiro ou uma janela aqui no aplicativo.</p>
          </div>
          {state.status === 'ERROR' && (
            <p role="alert" className="error-message">
              {state.message}
            </p>
          )}
          {state.status === 'LOADING' || state.status === 'STARTING' ? (
            <>
              <p role="status">
                {state.status === 'LOADING'
                  ? 'Carregando fontes…'
                  : 'Iniciando captura…'}
              </p>
              <button className="secondary-button" onClick={stop}>
                Cancelar
              </button>
            </>
          ) : (
            <button
              className="primary-button"
              disabled={!enabled}
              onClick={() => {
                void list();
              }}
            >
              Compartilhar tela
            </button>
          )}
        </>
      )}
      <p className="helper">
        {enabled
          ? 'Ao selecionar, a fonte fica disponível na sala. Mídia enviada apenas a quem clicar em Assistir.'
          : 'Crie ou entre em uma sala para testar a captura.'}
      </p>
    </section>
  );
}
