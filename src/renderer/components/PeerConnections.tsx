import { useEffect, useRef, useState } from 'react';
import { PeerMesh } from '../services/PeerMesh';
import type { PeerConnectionView } from '../services/PeerMesh';
import { RemoteVideo } from './RemoteVideo';
import { Icon } from './Icon';
import streamStartSound from '../assets/discord-stream-start.mp3';
import streamStopSound from '../assets/discord-stream-stop.mp3';

const labels = {
  WAITING: 'Aguardando conexão',
  CONNECTING: 'Conectando…',
  CONNECTED: 'WebRTC conectado',
  DISCONNECTED: 'Conexão interrompida',
  ERROR: 'Não foi possível conectar',
} as const;
export function PeerConnections({
  roomId,
  selfId,
  rtcEndpoint,
  capture,
  theater,
  onTheater,
}: {
  roomId: string;
  selfId: string;
  rtcEndpoint: { host: string; port: number };
  capture: MediaStream | null;
  theater: boolean;
  onTheater: (value: boolean) => void;
}) {
  const rtcHost = rtcEndpoint.host;
  const rtcPort = rtcEndpoint.port;
  const meshRef = useRef<PeerMesh | null>(null);
  const soundPlayers = useRef<{
    start: HTMLAudioElement;
    stop: HTMLAudioElement;
  } | null>(null);
  const previousStreams = useRef(new Map<string, string>());
  const [view, setView] = useState<{
    peers: PeerConnectionView[];
    error: string | null;
  }>({ peers: [], error: null });
  const hasVisibleStream = view.peers.some(
    (peer) => peer.streamId && peer.status === 'CONNECTED',
  );
  const viewers = view.peers.filter(
    (peer) => peer.watchingLocal && peer.status === 'CONNECTED',
  );
  useEffect(() => {
    const mesh = new PeerMesh(
      roomId,
      selfId,
      { host: rtcHost, port: rtcPort },
      (peers, error) => setView({ peers, error }),
    );
    meshRef.current = mesh;
    mesh.start();
    return () => {
      mesh.stop();
      meshRef.current = null;
    };
  }, [roomId, selfId, rtcHost, rtcPort]);
  useEffect(() => {
    meshRef.current?.setCapture(capture);
  }, [capture, roomId, selfId]);
  useEffect(() => {
    const players = {
      start: new Audio(streamStartSound),
      stop: new Audio(streamStopSound),
    };
    players.start.preload = 'auto';
    players.stop.preload = 'auto';
    soundPlayers.current = players;
    return () => {
      players.start.pause();
      players.stop.pause();
      soundPlayers.current = null;
    };
  }, []);
  useEffect(() => {
    const currentStreams = new Map<string, string>();
    for (const peer of view.peers)
      if (peer.streamId) currentStreams.set(peer.peerId, peer.streamId);

    let started = false;
    let stopped = false;
    for (const [peerId, streamId] of currentStreams) {
      const previousId = previousStreams.current.get(peerId);
      if (previousId !== streamId) started = true;
      if (previousId && previousId !== streamId) stopped = true;
    }
    for (const peerId of previousStreams.current.keys())
      if (!currentStreams.has(peerId)) stopped = true;

    previousStreams.current = currentStreams;
    const play = (audio: HTMLAudioElement | undefined) => {
      if (!audio) return;
      audio.currentTime = 0;
      void audio.play().catch(() => {});
    };
    if (stopped) play(soundPlayers.current?.stop);
    if (started) play(soundPlayers.current?.start);
  }, [view.peers]);
  useEffect(() => {
    if (theater && !hasVisibleStream) onTheater(false);
  }, [hasVisibleStream, onTheater, theater]);
  return (
    <section className="panel connection-panel">
      <div className="section-heading">
        <h2>Transmissões e conexões</h2>
        <span className="eyebrow">WEBRTC · LAN</span>
      </div>
      {view.peers.length === 0 && (
        <p>Aguardando outro participante entrar na sala.</p>
      )}
      <ul className="participants">
        {view.peers.map((peer) => (
          <li key={peer.peerId}>
            <span>{peer.displayName}</span>
            <span
              className={
                peer.status === 'CONNECTED' ? 'connection-ok' : 'helper'
              }
            >
              {labels[peer.status]}
            </span>
          </li>
        ))}
      </ul>
      {capture && (
        <div className="live-viewers" aria-live="polite">
          <div className="stream-heading">
            <p>
              <span className="live-dot" />
              Assistindo sua Live
            </p>
            <span className="count">{viewers.length}</span>
          </div>
          {viewers.length ? (
            <ul className="viewer-list">
              {viewers.map((peer) => (
                <li key={peer.peerId}>
                  <span className="viewer-avatar" aria-hidden="true">
                    {Array.from(peer.displayName)[0]?.toUpperCase()}
                  </span>
                  {peer.displayName}
                </li>
              ))}
            </ul>
          ) : (
            <p className="helper">Ninguém está assistindo ainda.</p>
          )}
        </div>
      )}
      {view.peers
        .filter((peer) => peer.streamId && peer.status === 'CONNECTED')
        .map((peer) => (
          <div className="stream-card" key={peer.peerId}>
            <div className="stream-heading">
              <p>
                <span className="live-dot" />
                {peer.displayName} está compartilhando a tela
              </p>
              <button
                className="icon-button"
                aria-label={
                  theater ? 'Sair do modo teatro' : 'Ativar modo teatro'
                }
                title={theater ? 'Sair do modo teatro' : 'Modo teatro'}
                onClick={() => onTheater(!theater)}
              >
                <Icon name={theater ? 'collapse' : 'expand'} size={15} />
              </button>
            </div>
            {peer.watchState === 'IDLE' || peer.watchState === 'ERROR' ? (
              <>
                {peer.watchState === 'ERROR' && (
                  <p role="alert" className="error-message">
                    Não foi possível receber o vídeo. Tente novamente.
                  </p>
                )}
                <button
                  className="primary-button"
                  onClick={() => meshRef.current?.watch(peer.peerId)}
                >
                  Assistir
                </button>
              </>
            ) : peer.media ? (
              <RemoteVideo
                key={peer.streamId}
                stream={peer.media}
                name={peer.displayName}
                leave={() => meshRef.current?.stopWatching()}
              />
            ) : (
              <>
                <p role="status">Conectando vídeo…</p>
                <button
                  className="secondary-button"
                  onClick={() => meshRef.current?.stopWatching()}
                >
                  Cancelar
                </button>
              </>
            )}
          </div>
        ))}
      {view.error && (
        <p role="alert" className="error-message">
          {view.error}
        </p>
      )}
      {view.peers.some((peer) => peer.status === 'ERROR') && (
        <p>
          Confira a rede e o firewall. Para tentar novamente, saia e entre na
          sala.
        </p>
      )}
      {view.peers
        .filter((peer) => peer.diagnostic)
        .map((peer) => (
          <details key={peer.peerId}>
            <summary>Diagnóstico de conexão · {peer.displayName}</summary>
            <p className="error-message">{peer.diagnostic}</p>
            <p>
              Contagens: local/remoto. Compartilhe esta linha para investigar a
              conexão.
            </p>
          </details>
        ))}
      <p className="helper">
        Vídeo e áudio opcional direto entre os participantes. Você pode assistir
        a uma transmissão por vez. Quem possui o convite pode compartilhar e
        assistir.
      </p>
    </section>
  );
}
