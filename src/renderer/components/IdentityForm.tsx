import { useState } from 'react';
import type { Identity } from '../../shared/schemas/room';

interface Props {
  identity: Identity | null;
  disabled: boolean;
  save: (displayName: string) => Promise<void>;
}
export function IdentityForm({ identity, disabled, save }: Props) {
  const [name, setName] = useState(identity?.displayName ?? '');
  return (
    <form
      className="panel profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save(name);
      }}
    >
      <div>
        <h2>{identity ? 'Seu perfil' : 'Como você quer aparecer?'}</h2>
        <p>
          {identity
            ? 'Seu nome fica salvo neste computador.'
            : 'Escolha um nome para começar. Não é necessário criar uma conta.'}
        </p>
      </div>
      <label>
        Seu nome
        <input
          autoComplete="nickname"
          name="displayName"
          maxLength={32}
          required
          value={name}
          disabled={disabled}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex.: Renan"
        />
      </label>
      <button
        className="secondary-button"
        disabled={disabled || !name.trim()}
        type="submit"
      >
        {identity ? 'Salvar nome' : 'Continuar'}
      </button>
      {disabled && identity && (
        <p className="helper">Saia da sala para editar seu nome.</p>
      )}
    </form>
  );
}
