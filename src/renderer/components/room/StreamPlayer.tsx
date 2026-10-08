import { useEffect, useRef, useState } from 'react';
import type { RemoteVideoQuality } from '../../../shared/protocols/media';
import { Icon } from '../Icon';
import { Slider } from '../common/Slider';

type SinkVideo = HTMLVideoElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

export function qualityLabel(quality: RemoteVideoQuality | null): string {
  if (quality?.frameHeight)
    return `${quality.frameHeight}p${quality.framesPerSecond === null ? '' : ` · ${Math.round(quality.framesPerSecond)} FPS`}`;
  return quality?.tier ?? 'Medindo…';
}

function reasonLabel(quality: RemoteVideoQuality | null): string | null {
  switch (quality?.reason) {
    case 'NETWORK':
      return 'Qualidade reduzida pela rede';
    case 'CPU':
      return 'Qualidade reduzida pelo computador de quem transmite';
    case 'RECEIVER':
      return 'Qualidade reduzida pela reprodução';
    case 'STABLE':
      return quality.reduced ? 'Recuperando a qualidade' : null;
    default:
      return null;
  }
}

/** Remote screen with its own volume, fullscreen and picture-in-picture. */
export function StreamPlayer({
  stream,
  name,
  quality,
  deafened,
  outputDeviceId,
  focused,
  onFocus,
  onLeave,
}: {
  stream: MediaStream;
  name: string;
  quality: RemoteVideoQuality | null;
  deafened: boolean;
  outputDeviceId: string | null;
  focused: boolean;
  onFocus: () => void;
  onLeave: () => void;
}) {
  const video = useRef<SinkVideo>(null);
  const container = useRef<HTMLDivElement>(null);
  const [playback, setPlayback] = useState<'LOADING' | 'PLAYING' | 'ERROR'>(
    'LOADING',
  );
  const [volume, setVolume] = useState(100);
  const [pictureInPicture, setPictureInPicture] = useState(false);
  const hasAudio = stream.getAudioTracks().length > 0;
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
        void document.exitPictureInPicture().catch(() => {});
      if (document.fullscreenElement === player)
        void document.exitFullscreen().catch(() => {});
      element.srcObject = null;
    };
  }, [stream]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.volume = Math.min(1, volume / 100);
    element.muted = deafened || volume === 0;
  }, [volume, deafened]);
  useEffect(() => {
    void video.current?.setSinkId?.(outputDeviceId ?? '').catch(() => {});
  }, [outputDeviceId]);
  const reason = reasonLabel(quality);
  return (
    <div
      className={`stream-player${focused ? ' focused' : ''}`}
      ref={container}
      onDoubleClick={() => {
        const task = document.fullscreenElement
          ? document.exitFullscreen()
          : container.current?.requestFullscreen();
        void task?.catch(() => {});
      }}
    >
      <video
        ref={video}
        autoPlay
        playsInline
        aria-label={`Tela de ${name}`}
        onClick={onFocus}
      />
      {playback !== 'PLAYING' && (
        <div className="stream-overlay-message" role="status">
          {playback === 'LOADING'
            ? 'Carregando transmissão…'
            : 'A transmissão não iniciou. Saia e tente assistir novamente.'}
        </div>
      )}
      <div className="stream-top">
        <span className="live-badge">
          <i aria-hidden="true" />
          AO VIVO
        </span>
        <span className="stream-quality" title={reason ?? undefined}>
          {qualityLabel(quality)}
          {reason && <Icon name="alert" size={12} />}
        </span>
      </div>
      <div className="stream-bottom">
        <span className="tile-name">{name}</span>
        <div className="stream-controls">
          {hasAudio && (
            <label className="stream-volume" title="Volume da transmissão">
              <Icon
                name={deafened || volume === 0 ? 'speakerOff' : 'speaker'}
                size={18}
              />
              <Slider
                min={0}
                max={100}
                value={volume}
                label="Volume da transmissão"
                onChange={(value) => setVolume(value)}
              />
            </label>
          )}
          <button
            type="button"
            className="stream-button"
            aria-label={pictureInPicture ? 'Fechar mini player' : 'Mini player'}
            data-tooltip={
              pictureInPicture ? 'Fechar mini player' : 'Mini player'
            }
            disabled={
              playback !== 'PLAYING' || !document.pictureInPictureEnabled
            }
            onClick={() => {
              const element = video.current;
              if (!element) return;
              const task =
                document.pictureInPictureElement === element
                  ? document.exitPictureInPicture()
                  : element.requestPictureInPicture();
              void task.catch(() => {});
            }}
          >
            <Icon name="pip" size={18} />
          </button>
          <button
            type="button"
            className="stream-button"
            aria-label="Tela cheia"
            data-tooltip="Tela cheia"
            onClick={() => {
              const task = document.fullscreenElement
                ? document.exitFullscreen()
                : container.current?.requestFullscreen();
              void task?.catch(() => {});
            }}
          >
            <Icon name="expand" size={18} />
          </button>
          <button
            type="button"
            className="stream-button danger"
            aria-label="Parar de assistir"
            data-tooltip="Parar de assistir"
            onClick={() => {
              if (document.pictureInPictureElement === video.current)
                void document.exitPictureInPicture().catch(() => {});
              onLeave();
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function LocalPreview({ stream }: { stream: MediaStream }) {
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
      ref={video}
      autoPlay
      muted
      playsInline
      aria-label="Prévia da sua transmissão"
    />
  );
}
