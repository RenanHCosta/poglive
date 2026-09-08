import { useUpdater } from '../hooks/useUpdater';

export function UpdateStatus({ inRoom }: { inRoom: boolean }) {
  const { state, actionError, check, install } = useUpdater();

  if (!state || (state.status === 'DISABLED' && state.reason !== 'PORTABLE'))
    return null;

  if (state.status === 'DISABLED')
    return (
      <span
        className="update-status"
        title="Instale o Poglive para receber atualizações automáticas."
      >
        Versão portátil · atualização manual
      </span>
    );

  if (state.status === 'READY')
    return (
      <div className="update-status" aria-live="polite">
        {actionError && <span className="error-message">{actionError}</span>}
        <button
          type="button"
          className="update-button update-ready"
          disabled={inRoom}
          title={
            inRoom
              ? 'Saia da sala antes de reiniciar e atualizar.'
              : `Instalar Poglive v${state.version}`
          }
          onClick={() => void install()}
        >
          {inRoom
            ? `v${state.version} pronta · saia da sala para instalar`
            : `Reiniciar e atualizar para v${state.version}`}
        </button>
      </div>
    );

  if (state.status === 'CHECKING')
    return <span className="update-status">Buscando atualização…</span>;

  if (state.status === 'AVAILABLE')
    return (
      <span className="update-status">Baixando Poglive v{state.version}…</span>
    );

  if (state.status === 'DOWNLOADING')
    return (
      <span className="update-status" aria-live="polite">
        Baixando v{state.version} · {Math.round(state.percent)}%
      </span>
    );

  return (
    <div className="update-status" aria-live="polite">
      {actionError && <span className="error-message">{actionError}</span>}
      <button
        type="button"
        className="update-button"
        title={state.status === 'ERROR' ? state.message : undefined}
        onClick={() => void check()}
      >
        {state.status === 'ERROR'
          ? 'Tentar atualização novamente'
          : state.status === 'CURRENT'
            ? 'Poglive atualizado'
            : 'Verificar atualização'}
      </button>
    </div>
  );
}
