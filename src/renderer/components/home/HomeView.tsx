import { useEffect, useState } from 'react';
import type { LocalState, RoomCommand } from '../../../shared/schemas/room';
import type { DiscoveredRoom } from '../../../shared/schemas/discovery';
import { Icon } from '../Icon';
import { settingsStore } from '../../services/settings';
import { useStore } from '../../services/store';
import { formatAccelerator } from '../../services/accelerators';

const SCAN_INTERVAL_MS = 2500;

function NetworkRooms({
  busy,
  command,
}: {
  busy: boolean;
  command: (command: RoomCommand) => Promise<boolean>;
}) {
  const [rooms, setRooms] = useState<DiscoveredRoom[] | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scan = async (): Promise<void> => {
      try {
        const found = await window.pogLive.scanRooms();
        if (active) setRooms(found);
      } catch {
        if (active) setRooms([]);
      }
      if (active) timer = setTimeout(() => void scan(), SCAN_INTERVAL_MS);
    };
    void scan();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return (
    <section className="network-rooms" aria-labelledby="network-rooms-title">
      <header className="network-rooms-header">
        <h3 id="network-rooms-title">Salas na rede</h3>
        <span className="network-rooms-scan" aria-hidden="true" />
      </header>
      {rooms && rooms.length > 0 ? (
        <ul className="network-rooms-list">
          {rooms.map((room) => {
            const full = room.members >= room.max;
            return (
              <li key={room.roomId} className="network-room">
                <span className="network-room-icon">
                  <Icon name="signal" size={20} />
                </span>
                <span className="network-room-text">
                  <span className="network-room-name">{room.name}</span>
                  <span className="network-room-meta">
                    {room.hostName} · {room.members}/{room.max} pessoas
                  </span>
                </span>
                <button
                  type="button"
                  className="button primary small"
                  disabled={busy || full || !room.compatible}
                  title={
                    !room.compatible
                      ? 'Essa sala usa outra versão do Poglive.'
                      : undefined
                  }
                  onClick={() =>
                    void command({ type: 'JOIN_ROOM', invite: room.invite })
                  }
                >
                  {!room.compatible
                    ? 'Versão diferente'
                    : full
                      ? 'Sala cheia'
                      : 'Entrar'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="network-rooms-empty">
          {rooms === null
            ? 'Procurando salas públicas…'
            : 'Nenhuma sala pública encontrada na sua rede ou VPN. Continuamos procurando.'}
        </p>
      )}
    </section>
  );
}

export function HomeView({
  data,
  inRoom,
  busy,
  command,
  onCreate,
  onJoin,
}: {
  data: LocalState;
  inRoom: boolean;
  busy: boolean;
  command: (command: RoomCommand) => Promise<boolean>;
  onCreate: () => void;
  onJoin: () => void;
}) {
  const settings = useStore(settingsStore);
  const muteShortcut =
    settings.status === 'READY' && settings.settings.shortcuts.TOGGLE_MUTE
      ? formatAccelerator(settings.settings.shortcuts.TOGGLE_MUTE)
      : null;
  return (
    <div className="home">
      <header className="content-header">
        <Icon name="home" size={20} />
        <h1>Início</h1>
      </header>
      <div className="home-body">
        {data.room.status === 'DISCONNECTED' && (
          <div className="banner warning" role="alert">
            <Icon name="alert" size={18} />
            <span>{data.room.message}</span>
          </div>
        )}
        {inRoom && (
          <div className="banner info" role="status">
            <Icon name="info" size={18} />
            <span>
              Você continua conectado à sala atual. Saia dela para criar ou
              entrar em outra.
            </span>
          </div>
        )}
        <section className="home-hero">
          <img className="home-hero-mark" src="./poglive.svg" alt="" />
          <div>
            <span className="kicker">Sua frequência privada</span>
            <h2>E aí, {data.identity?.displayName}?</h2>
            <p>
              Abra uma sala para a tripulação ou sintonize com um convite. Voz,
              chat e telas vão direto entre vocês, sem servidor no meio.
            </p>
          </div>
        </section>
        <div className="home-actions">
          <button
            type="button"
            className="home-card"
            disabled={inRoom}
            onClick={onCreate}
          >
            <span className="home-card-icon create">
              <Icon name="plus" size={26} />
            </span>
            <span className="home-card-title">Abrir uma sala</span>
            <span className="home-card-text">
              Você é o anfitrião e chama até 7 amigos com um convite.
            </span>
          </button>
          <button
            type="button"
            className="home-card"
            disabled={inRoom}
            onClick={onJoin}
          >
            <span className="home-card-icon join">
              <Icon name="link" size={26} />
            </span>
            <span className="home-card-title">Sintonizar com convite</span>
            <span className="home-card-text">
              Cole o código que o anfitrião mandou para você.
            </span>
          </button>
        </div>
        {!inRoom && <NetworkRooms busy={busy} command={command} />}
        <ul className="home-tips">
          <li>
            <Icon name="mic" size={18} />
            <span>
              Entre no canal de voz para conversar.
              {muteShortcut && (
                <>
                  {' '}
                  Silencie com <kbd>{muteShortcut}</kbd> mesmo com outro
                  aplicativo em foco.
                </>
              )}
            </span>
          </li>
          <li>
            <Icon name="screenShare" size={18} />
            <span>
              Transmita uma tela ou janela com áudio. O som do próprio Poglive
              nunca entra na transmissão.
            </span>
          </li>
          <li>
            <Icon name="link" size={18} />
            <span>
              O convite funciona como uma senha enquanto a sala está aberta.
              Envie somente para quem pode entrar.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
