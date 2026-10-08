import { useState } from 'react';
import type { LocalState, RoomCommand } from '../../../shared/schemas/room';
import { Modal } from '../common/Modal';

type Command = (command: RoomCommand) => Promise<boolean>;

export function CreateRoomModal({
  data,
  busy,
  command,
  onClose,
}: {
  data: LocalState;
  busy: boolean;
  command: Command;
  onClose: () => void;
}) {
  const [name, setName] = useState(
    data.identity ? `Sala de ${data.identity.displayName}`.slice(0, 32) : '',
  );
  const lan =
    data.addresses.find((item) => item.address !== '127.0.0.1')?.address ??
    '127.0.0.1';
  const [address, setAddress] = useState(lan);
  return (
    <Modal
      title="Crie sua sala"
      subtitle="Sua sala é onde você e seus amigos conversam por voz, trocam mensagens e compartilham a tela."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button link" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form="create-room"
            className="button primary"
            disabled={busy || !name.trim()}
          >
            Criar sala
          </button>
        </>
      }
    >
      <form
        id="create-room"
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void command({ type: 'CREATE_ROOM', name, address }).then((ok) => {
            if (ok) onClose();
          });
        }}
      >
        <label className="field">
          <span className="field-label">Nome da sala</span>
          <input
            value={name}
            maxLength={32}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Rede usada pelos convidados</span>
          <select
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          >
            {data.addresses.map((item) => (
              <option key={item.address} value={item.address}>
                {item.label}
              </option>
            ))}
          </select>
          <span className="field-hint">
            Escolha o IPv4 da rede que os convidados alcançam (Wi-Fi, Ethernet
            ou VPN como Radmin). “Somente este computador” serve para testes
            locais.
          </span>
        </label>
      </form>
    </Modal>
  );
}

export function JoinRoomModal({
  busy,
  command,
  onClose,
}: {
  busy: boolean;
  command: Command;
  onClose: () => void;
}) {
  const [invite, setInvite] = useState('');
  return (
    <Modal
      title="Entrar em uma sala"
      subtitle="Cole o convite que o anfitrião enviou para você."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button link" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form="join-room"
            className="button primary"
            disabled={busy || !invite.trim()}
          >
            {busy ? 'Entrando…' : 'Entrar na sala'}
          </button>
        </>
      }
    >
      <form
        id="join-room"
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void command({ type: 'JOIN_ROOM', invite }).then((ok) => {
            if (ok) onClose();
          });
        }}
      >
        <label className="field">
          <span className="field-label">Convite</span>
          <textarea
            value={invite}
            maxLength={1024}
            required
            rows={3}
            spellCheck={false}
            autoComplete="off"
            placeholder="PL2.…"
            onChange={(event) => setInvite(event.target.value)}
          />
          <span className="field-hint">
            O anfitrião precisa estar com a sala aberta e acessível pela mesma
            rede ou VPN.
          </span>
        </label>
      </form>
    </Modal>
  );
}
