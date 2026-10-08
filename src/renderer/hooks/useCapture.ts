import { useEffect, useRef, useState } from 'react';
import { CAPTURE_PROFILES } from '../../shared/schemas/capture';
import type {
  CaptureSource,
  CaptureOptions,
} from '../../shared/schemas/capture';
import {
  startProcessAudio,
  stopProcessAudio,
} from '../services/ProcessAudioTrack';

type CaptureState =
  | { status: 'IDLE' }
  | { status: 'LOADING' }
  | { status: 'SELECTING_SOURCE'; sources: CaptureSource[] }
  | { status: 'STARTING' }
  | {
      status: 'PREVIEW';
      stream: MediaStream;
      sourceName: string;
      quality: string;
      options: CaptureOptions;
      warning: string | null;
    }
  | { status: 'ERROR'; message: string };

function release(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
}
export function useCapture() {
  const [state, setState] = useState<CaptureState>({ status: 'IDLE' });
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const locked = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
      release(stream.current);
      stream.current = null;
      void stopProcessAudio();
      void window.pogLive.captureCancel().catch(() => {});
    },
    [],
  );
  function stop(): void {
    generation.current++;
    locked.current = false;
    release(stream.current);
    stream.current = null;
    void stopProcessAudio();
    void window.pogLive.captureCancel().catch(() => {});
    setState({ status: 'IDLE' });
  }
  async function list(): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    const current = ++generation.current;
    setState({ status: 'LOADING' });
    try {
      const result = await window.pogLive.captureSources();
      if (generation.current !== current) return;
      setState(
        result.status === 'OK'
          ? { status: 'SELECTING_SOURCE', sources: result.sources }
          : result,
      );
    } catch {
      if (generation.current === current)
        setState({
          status: 'ERROR',
          message: 'Não foi possível carregar as fontes de captura.',
        });
    } finally {
      if (generation.current === current) locked.current = false;
    }
  }
  async function start(
    source: CaptureSource,
    options: CaptureOptions,
  ): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    const current = ++generation.current;
    setState({ status: 'STARTING' });
    try {
      const result = await window.pogLive.captureSelect(source.id, options);
      if (generation.current !== current) return;
      if (result.status === 'ERROR') {
        setState(result);
        return;
      }
      const profile = CAPTURE_PROFILES[options.quality];
      const constraints = {
        width: { ideal: profile.width, max: profile.width },
        height: { ideal: profile.height, max: profile.height },
        frameRate: { ideal: options.frameRate, max: options.frameRate },
      };
      const media = await navigator.mediaDevices.getDisplayMedia({
        video: constraints,
        audio: false,
      });
      if (generation.current !== current) {
        release(media);
        return;
      }
      // Audio is optional: a failure keeps the video share running with a warning.
      let audioWarning: string | null = null;
      if (options.audioMode !== 'NONE') {
        try {
          if (options.audioMode === 'WINDOW' && source.kind !== 'window')
            throw new Error('Window audio requires a window source');
          const audioTrack = await startProcessAudio(
            options.audioMode === 'WINDOW'
              ? { mode: 'WINDOW', sourceId: source.id }
              : { mode: 'SYSTEM' },
          );
          if (generation.current !== current) {
            audioTrack.stop();
            release(media);
            return;
          }
          media.addTrack(audioTrack);
        } catch {
          audioWarning =
            'Não foi possível capturar o áudio (requer Windows 10 build 20348 ou mais recente). A transmissão segue somente com vídeo.';
        }
      }
      stream.current = media;
      const track = media.getVideoTracks()[0];
      if (!track || track.readyState === 'ended')
        throw new Error('Source ended');
      await track.applyConstraints(constraints);
      if (generation.current !== current) {
        release(media);
        return;
      }
      if (media.getVideoTracks().every((item) => item.readyState !== 'live'))
        throw new Error('Source ended during configuration');
      track.onended = () => {
        if (generation.current !== current) return;
        stop();
        setState({
          status: 'ERROR',
          message:
            'A captura foi encerrada. Selecione um monitor ou janela novamente.',
        });
      };
      const settings = track.getSettings();
      const audio = media.getAudioTracks()[0];
      const preview = {
        status: 'PREVIEW' as const,
        stream: media,
        sourceName: source.name,
        quality: `${settings.width ?? '?'} × ${settings.height ?? '?'} · ${settings.frameRate === undefined ? '?' : Math.round(settings.frameRate)} FPS (configuração da captura; solicitado ${options.frameRate})`,
        options,
        warning: audioWarning,
      };
      if (audio)
        audio.onended = () => {
          if (generation.current === current)
            setState({
              ...preview,
              warning:
                'O áudio foi encerrado. Reinicie a captura para tentar novamente.',
            });
        };
      setState(preview);
    } catch (error: unknown) {
      if (generation.current !== current) return;
      release(stream.current);
      stream.current = null;
      await stopProcessAudio();
      const denied =
        error instanceof DOMException && error.name === 'NotAllowedError';
      setState({
        status: 'ERROR',
        message: denied
          ? 'Captura não autorizada ou seleção expirada. Tente selecionar a fonte novamente.'
          : 'Não foi possível iniciar a captura. Tente outra fonte ou qualidade; se habilitou áudio, tente novamente sem ele.',
      });
    } finally {
      if (generation.current === current) {
        locked.current = false;
        void window.pogLive.captureCancel().catch(() => {});
      }
    }
  }
  return { state, list, start, stop };
}
