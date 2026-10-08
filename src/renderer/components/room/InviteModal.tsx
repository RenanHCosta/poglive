import { useState } from 'react';
import type { RoomCommand } from '../../../shared/schemas/room';
import { Modal } from '../common/Modal';
import { Icon } from '../Icon';

export function InviteModal({
  roomName,
  invite,
  command,
  onClose,
}: {
  roomName: string;
  invite: string;
  command: (command: RoomCommand) => Promise<boolean>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      title={`Convide amigos para ${roomName}`}
      subtitle="Envie o convite apenas para quem pode entrar. Ele vale enquanto a sala estiver aberta."
      size="small"
      onClose={onClose}
    >
      <div className="invite-box">
        <input
          readOnly
          value={invite}
          spellCheck={false}
          aria-label="Convite da sala"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className={`button ${copied ? 'success' : 'primary'}`}
          onClick={() => {
            void command({ type: 'COPY_INVITE' }).then((ok) => {
              if (!ok) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <ul className="invite-notes">
        <li>
          <Icon name="link" size={16} />O convite contém o endereço da sala, um
          segredo e a impressão digital do certificado. Não publique em canais
          abertos.
        </li>
        <li>
          <Icon name="alert" size={16} />
          Quem estiver fora da sua rede precisa de uma VPN em comum (por
          exemplo, Radmin) e do firewall liberado para o Poglive.
        </li>
      </ul>
    </Modal>
  );
}
