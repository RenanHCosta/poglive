import { useState } from 'react';
import type { RoomCommand } from '../../../shared/schemas/room';

export function Onboarding({
  busy,
  command,
}: {
  busy: boolean;
  command: (command: RoomCommand) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  return (
    <div className="onboarding">
      <div className="onboarding-art" aria-hidden="true">
        <img src="./poglive.svg" alt="" />
      </div>
      <form
        className="onboarding-card"
        onSubmit={(event) => {
          event.preventDefault();
          void command({ type: 'SAVE_IDENTITY', displayName: name });
        }}
      >
        <span className="kicker">Sua frequência privada</span>
        <h1>Bem-vindo a bordo do Poglive</h1>
        <p>
          Voz, chat e transmissões de tela direto entre amigos. Sem conta, sem
          servidor no meio do caminho.
        </p>
        <label className="field">
          <span className="field-label">Como a tripulação vai te chamar?</span>
          <input
            autoFocus
            autoComplete="nickname"
            name="displayName"
            maxLength={32}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Seu nome"
          />
        </label>
        <button
          className="button primary large"
          disabled={busy || !name.trim()}
          type="submit"
        >
          Entrar no ar
        </button>
        <p className="fine-print">
          Seu nome fica salvo apenas neste computador e pode ser alterado nas
          configurações.
        </p>
      </form>
    </div>
  );
}
