import { useEffect, useRef, useState } from 'react';

export function RemoteVideo({
  stream,
  name,
  leave,
}: {
  stream: MediaStream;
  name: string;
  leave: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [playback, setPlayback] = useState<'LOADING' | 'PLAYING' | 'ERROR'>(
    'LOADING',
  );
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let active = true;
    element.srcObject = stream;
    const timeout = setTimeout(() => {
      if (active) setPlayback('ERROR');
    }, 15000);
    element.onplaying = () => {
      clearTimeout(timeout);
      setPlayback('PLAYING');
    };
    void element.play().catch(() => {
      if (active) setPlayback('ERROR');
    });
    return () => {
      active = false;
      clearTimeout(timeout);
      element.onplaying = null;
      element.srcObject = null;
    };
  }, [stream]);
  return (
    <div className="remote-player" ref={container}>
      <h3>{name}</h3>
      <video
        className="capture-video"
        ref={video}
        autoPlay
        muted={muted}
        playsInline
        aria-label={`Tela de ${name}`}
      />
      {playback === 'LOADING' && <p role="status">Aguardando vídeo…</p>}
      {playback === 'ERROR' && (
        <p role="alert" className="error-message">
          O vídeo não iniciou. Saia da transmissão e tente assistir novamente.
        </p>
      )}
      <div className="room-tabs">
        <button
          className="secondary-button"
          aria-pressed={!muted}
          onClick={() => {
            const element = video.current;
            if (!element) return;
            element.muted = !muted;
            setMuted(!muted);
            void element
              .play()
              .catch(() =>
                setError(
                  'Não foi possível reproduzir. Tente silenciar e ativar o áudio novamente.',
                ),
              );
          }}
        >
          {muted ? 'Ativar áudio' : 'Silenciar'}
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            const task = document.fullscreenElement
              ? document.exitFullscreen()
              : container.current?.requestFullscreen();
            void task?.catch(() =>
              setError('Não foi possível abrir tela cheia.'),
            );
          }}
        >
          Tela cheia
        </button>
        <button className="secondary-button" onClick={leave}>
          Sair da transmissão
        </button>
      </div>
      <p className="helper">
        Som disponível apenas se o transmissor habilitou áudio. Ao compartilhar
        e assistir ao mesmo tempo, silenciar evita recapturar o áudio recebido.
      </p>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </div>
  );
}
