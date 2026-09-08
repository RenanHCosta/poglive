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
  const [volume, setVolume] = useState(100);
  const [pictureInPicture, setPictureInPicture] = useState(false);
  useEffect(() => {
    const element = video.current;
    const player = container.current;
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
    element.onenterpictureinpicture = () => setPictureInPicture(true);
    element.onleavepictureinpicture = () => setPictureInPicture(false);
    void element.play().catch(() => {
      if (active) setPlayback('ERROR');
    });
    return () => {
      active = false;
      clearTimeout(timeout);
      element.onplaying = null;
      element.onenterpictureinpicture = null;
      element.onleavepictureinpicture = null;
      if (document.pictureInPictureElement === element)
        void document.exitPictureInPicture();
      if (document.fullscreenElement === player)
        void document.exitFullscreen().catch(() => {});
      element.srcObject = null;
    };
  }, [stream]);
  useEffect(() => {
    if (video.current) {
      video.current.volume = volume / 100;
      video.current.muted = volume === 0;
    }
  }, [volume]);

  const togglePictureInPicture = async () => {
    const element = video.current;
    if (!element) return;
    try {
      setError(null);
      if (document.pictureInPictureElement === element) {
        await document.exitPictureInPicture();
      } else {
        await element.requestPictureInPicture();
      }
    } catch {
      setError('Não foi possível abrir o modo picture-in-picture.');
    }
  };

  const leaveTransmission = async () => {
    if (document.pictureInPictureElement === video.current) {
      await document.exitPictureInPicture().catch(() => {});
    }
    leave();
  };

  const pictureInPictureAvailable =
    document.pictureInPictureEnabled &&
    typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';
  return (
    <div className="remote-player" ref={container}>
      <h3>{name}</h3>
      <video
        className="capture-video"
        ref={video}
        autoPlay
        muted={volume === 0}
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
        <label className="volume-control">
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={volume}
            aria-label="Volume da transmissão"
            aria-valuetext={`${volume}%`}
            onChange={(event) => {
              const nextVolume = Number(event.target.value);
              setVolume(nextVolume);
              if (nextVolume > 0) {
                setError(null);
                void video.current
                  ?.play()
                  .catch(() =>
                    setError(
                      'Não foi possível reproduzir o áudio. Ajuste o volume e tente novamente.',
                    ),
                  );
              }
            }}
          />
          <output>{volume}%</output>
        </label>
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
        <button
          className="secondary-button"
          aria-pressed={pictureInPicture}
          disabled={!pictureInPictureAvailable || playback !== 'PLAYING'}
          title="Abre um player flutuante, redimensionável e sempre no topo"
          onClick={() => void togglePictureInPicture()}
        >
          {pictureInPicture ? 'Fechar mini player' : 'Mini player'}
        </button>
        <button
          className="secondary-button"
          onClick={() => void leaveTransmission()}
        >
          Sair da transmissão
        </button>
      </div>
      <p className="helper">
        Som disponível apenas se o transmissor habilitou áudio. Ao compartilhar
        e assistir ao mesmo tempo, reduza o volume a zero para evitar recapturar
        o áudio recebido. O mini player fica sempre no topo e pode ser
        redimensionado.
      </p>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </div>
  );
}
