import { openLink, pendingLink } from '../../services/links';
import { useStore } from '../../services/store';
import { Modal } from './Modal';

export function LinkConfirm() {
  const url = useStore(pendingLink);
  if (!url) return null;
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // The schema already validated the URL; keep the raw text as a fallback.
  }
  const close = () => pendingLink.set(null);
  return (
    <Modal
      title="Abrir link externo?"
      subtitle={`O link leva para ${host}, fora do Poglive. Confira o endereço antes de continuar.`}
      size="small"
      onClose={close}
      footer={
        <>
          <button type="button" className="button link" onClick={close}>
            Voltar
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => openLink(url)}
          >
            Abrir no navegador
          </button>
        </>
      }
    >
      <code className="link-preview">{url}</code>
    </Modal>
  );
}
