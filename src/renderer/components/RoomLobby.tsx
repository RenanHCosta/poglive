import { useState } from 'react';
import type { LocalState, RoomCommand } from '../../shared/schemas/room';

interface Props {
  data: LocalState;
  busy: boolean;
  command: (command: RoomCommand) => Promise<void>;
}
export function RoomLobby({ data, busy, command }: Props) {
  const [name, setName] = useState('Sala privada');
  const [address, setAddress] = useState(
    data.addresses[0]?.address ?? '127.0.0.1',
  );
  const [invite, setInvite] = useState('');
  const [mode, setMode] = useState<'CREATE' | 'JOIN'>('CREATE');
  return (
    <section className="panel">
      <div className="room-tabs" role="group" aria-label="Escolha uma ação">
        <button
          className="secondary-button"
          aria-pressed={mode === 'CREATE'}
          onClick={() => setMode('CREATE')}
        >
          Criar sala
        </button>
        <button
          className="secondary-button"
          aria-pressed={mode === 'JOIN'}
          onClick={() => setMode('JOIN')}
        >
          Entrar em sala
        </button>
      </div>
      {mode === 'CREATE' ? (
        <form
          className="room-form"
          onSubmit={(event) => {
            event.preventDefault();
            void command({ type: 'CREATE_ROOM', name, address });
          }}
        >
          <label>
            Nome da sala
            <input
              value={name}
              maxLength={32}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Conectar por
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
          </label>
          <p>
            Para dois PCs, escolha o endereço da sua rede Wi-Fi ou Ethernet.
            Para testar aqui, escolha “Somente este computador”.
          </p>
          <button className="primary-button" disabled={busy || !name.trim()}>
            Criar sala privada
          </button>
        </form>
      ) : (
        <form
          className="room-form"
          onSubmit={(event) => {
            event.preventDefault();
            void command({ type: 'JOIN_ROOM', invite });
            setInvite('');
          }}
        >
          <label>
            Código de convite
            <textarea
              value={invite}
              maxLength={1024}
              required
              spellCheck={false}
              autoComplete="off"
              placeholder="PL1.…"
              onChange={(event) => setInvite(event.target.value)}
            />
          </label>
          <p>O host precisa estar com a sala aberta e acessível nesta rede.</p>
          <button className="primary-button" disabled={busy || !invite.trim()}>
            Entrar na sala
          </button>
        </form>
      )}
    </section>
  );
}
