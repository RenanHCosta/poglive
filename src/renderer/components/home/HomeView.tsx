import type { LocalState } from '../../../shared/schemas/room';
import { Icon } from '../Icon';
import { settingsStore } from '../../services/settings';
import { useStore } from '../../services/store';
import { formatAccelerator } from '../../services/accelerators';

export function HomeView({
  data,
  inRoom,
  onCreate,
  onJoin,
}: {
  data: LocalState;
  inRoom: boolean;
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
          <h2>Olá, {data.identity?.displayName}!</h2>
          <p>
            Crie uma sala para seus amigos ou entre com um convite. Voz, chat e
            telas compartilhadas vão direto entre os participantes.
          </p>
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
            <span className="home-card-title">Criar uma sala</span>
            <span className="home-card-text">
              Você hospeda a sala e envia o convite para até 7 amigos.
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
            <span className="home-card-title">Entrar com convite</span>
            <span className="home-card-text">
              Cole o código que você recebeu de quem criou a sala.
            </span>
          </button>
        </div>
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
