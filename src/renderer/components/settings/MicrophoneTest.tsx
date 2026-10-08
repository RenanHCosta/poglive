import { useEffect, useRef, useState } from 'react';
import type { AudioSettings } from '../../services/voice/MicrophoneInput';
import {
  MicrophoneError,
  MicrophoneInput,
} from '../../services/voice/MicrophoneInput';

// Maps -100..0 dBFS onto the meter width.
function percent(db: number): number {
  return Math.max(0, Math.min(100, db + 100));
}

/**
 * Live input meter with the sensitivity threshold, like a "mic test". Opens
 * its own capture so it works with or without an active voice connection.
 */
export function MicrophoneTest({
  audio,
  onThreshold,
}: {
  audio: AudioSettings;
  onThreshold: (db: number) => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meter = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const input = useRef<MicrophoneInput | null>(null);
  const restartKey = `${audio.inputDeviceId}|${audio.echoCancellation}|${audio.noiseSuppression}|${audio.autoGainControl}`;
  useEffect(() => {
    if (!running) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    void MicrophoneInput.open(audio)
      .then((opened) => {
        if (!active) {
          opened.close();
          return;
        }
        input.current = opened;
        timer = setInterval(() => {
          const sample = opened.sample(performance.now());
          if (meter.current) {
            meter.current.style.width = `${percent(sample.levelDb)}%`;
            meter.current.classList.toggle('open', sample.gateOpen);
          }
          if (marker.current)
            marker.current.style.left = `${percent(sample.thresholdDb)}%`;
        }, 40);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof MicrophoneError
            ? cause.message
            : 'Não foi possível abrir o microfone.',
        );
        setRunning(false);
      });
    return () => {
      active = false;
      clearInterval(timer);
      input.current?.close();
      input.current = null;
    };
    // Volume and sensitivity apply live below; device/DSP changes reopen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, restartKey]);
  useEffect(() => {
    input.current?.update(audio);
  }, [audio]);
  return (
    <div className="mic-test">
      <div
        className="meter"
        onClick={(event) => {
          if (audio.automaticSensitivity) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onThreshold(
            Math.round(((event.clientX - rect.left) / rect.width) * 100 - 100),
          );
        }}
      >
        <div className="meter-fill" ref={meter} />
        <div className="meter-marker" ref={marker} />
      </div>
      <div className="mic-test-actions">
        <button
          type="button"
          className={`button ${running ? 'secondary' : 'primary'}`}
          onClick={() => {
            setError(null);
            setRunning(!running);
          }}
        >
          {running ? 'Parar teste' : 'Testar microfone'}
        </button>
        <span className="field-hint">
          {running
            ? 'Fale normalmente. A barra fica verde quando sua voz seria transmitida.'
            : 'Veja o nível do microfone e ajuste a sensibilidade.'}
        </span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
