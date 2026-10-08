import type { AppInfo } from '../../../shared/contracts';
import { useUpdater } from '../../hooks/useUpdater';
import { pushToast } from '../../services/toasts';
import { Icon } from '../Icon';

const REPOSITORY = 'https://github.com/RenanHCosta/poglive';

function open(url: string): void {
  void window.pogLive.openExternal(url).then((result) => {
    if (result.status === 'ERROR') pushToast(result.message, 'error');
  });
}

export function UpdatePanel({
  inRoom,
  appInfo,
}: {
  inRoom: boolean;
  appInfo: AppInfo | null;
}) {
  const { state, actionError, check, install } = useUpdater();
  let status: string;
  let action: React.ReactNode = null;
  switch (state?.status) {
    case undefined:
      status = 'Consultando o atualizador…';
      break;
    case 'DISABLED':
      status =
        state.reason === 'PORTABLE'
          ? 'Versão portátil: baixe novas versões manualmente nas Releases.'
          : state.reason === 'DEVELOPMENT'
            ? 'Atualizações desativadas no modo de desenvolvimento.'
            : 'Atualizações automáticas não estão disponíveis nesta plataforma.';
      break;
    case 'CHECKING':
      status = 'Buscando atualizações…';
      break;
    case 'AVAILABLE':
      status = `Baixando a versão ${state.version}…`;
      break;
    case 'DOWNLOADING':
      status = `Baixando a versão ${state.version} · ${Math.round(state.percent)}%`;
      break;
    case 'READY':
      status = inRoom
        ? `A versão ${state.version} está pronta. Saia da sala para reiniciar e instalar.`
        : `A versão ${state.version} está pronta para instalar.`;
      action = (
        <button
          type="button"
          className="button success"
          disabled={inRoom}
          onClick={() => void install()}
        >
          <Icon name="download" size={18} />
          Reiniciar e atualizar
        </button>
      );
      break;
    case 'CURRENT':
    case 'IDLE':
    case 'ERROR':
      status =
        state.status === 'CURRENT'
          ? 'O Poglive está atualizado.'
          : state.status === 'ERROR'
            ? `Falha ao verificar: ${state.message}`
            : 'Atualizações automáticas ativas.';
      action = (
        <button
          type="button"
          className="button secondary"
          onClick={() => void check()}
        >
          <Icon name="refresh" size={18} />
          Verificar atualizações
        </button>
      );
      break;
  }
  return (
    <>
      <header className="settings-header">
        <h2>Atualizações e sobre</h2>
      </header>
      <div className="about-card">
        <img src="./poglive.svg" alt="" />
        <div>
          <h3>Poglive {appInfo ? `v${appInfo.version}` : ''}</h3>
          <p className="muted">
            Voz, chat e compartilhamento de tela P2P em salas privadas.
          </p>
        </div>
      </div>
      <div className="update-row">
        <p role="status">{status}</p>
        {action}
      </div>
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}
      <div className="settings-divider" />
      <div className="link-list">
        <button
          type="button"
          className="link-button"
          onClick={() => open(REPOSITORY)}
        >
          Código-fonte <Icon name="external" size={14} />
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => open(`${REPOSITORY}/releases`)}
        >
          Notas de versão <Icon name="external" size={14} />
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => open(`${REPOSITORY}/blob/main/PRIVACY.md`)}
        >
          Privacidade <Icon name="external" size={14} />
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => open(`${REPOSITORY}/issues`)}
        >
          Relatar um problema <Icon name="external" size={14} />
        </button>
      </div>
      <p className="field-hint">
        Sem anúncios, analytics ou coleta de dados. Voz, vídeo e mensagens
        trafegam somente entre os participantes da sala.
      </p>
    </>
  );
}
