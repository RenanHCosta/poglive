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
      <form
        className="onboarding-card"
        onSubmit={(event) => {
          event.preventDefault();
          void command({ type: 'SAVE_IDENTITY', displayName: name });
        }}
      >
        <img className="onboarding-logo" src="./poglive.svg" alt="" />
        <h1>Boas-vindas ao Poglive</h1>
        <p>
          Voz, chat e compartilhamento de tela direto entre amigos. Sem conta,
          sem servidor de terceiros.
        </p>
        <label className="field">
          <span className="field-label">Como você quer ser chamado?</span>
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
          Continuar
        </button>
        <p className="fine-print">
          Seu nome fica salvo apenas neste computador e pode ser alterado nas
          configurações.
        </p>
      </form>
    </div>
  );
}
