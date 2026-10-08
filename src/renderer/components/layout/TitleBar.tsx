import { useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../Icon';

export function TitleBar({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  const [maximized, setMaximized] = useState(false);
  return (
    <div className="title-bar">
      <div className="title-bar-brand">
        <img className="app-icon" src="./poglive.svg" alt="" />
        <span>Poglive</span>
      </div>
      <div className="title-bar-title">{title}</div>
      <div className="window-actions">
        {children}
        <button
          type="button"
          className="window-action"
          aria-label="Minimizar"
          onClick={() => void window.pogLive.windowMinimize()}
        >
          <span className="minimize-glyph" />
        </button>
        <button
          type="button"
          className="window-action"
          aria-label={maximized ? 'Restaurar' : 'Maximizar'}
          onClick={() =>
            void window.pogLive.windowToggleMaximize().then(setMaximized)
          }
        >
          <Icon name={maximized ? 'collapse' : 'expand'} size={12} />
        </button>
        <button
          type="button"
          className="window-action close-action"
          aria-label="Fechar"
          onClick={() => void window.pogLive.windowClose()}
        >
          <span className="close-glyph" />
        </button>
      </div>
    </div>
  );
}
