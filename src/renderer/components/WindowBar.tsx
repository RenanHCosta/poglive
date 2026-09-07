import { useState } from 'react';
import { Icon } from './Icon';

export function WindowBar() {
  const [maximized, setMaximized] = useState(false);
  return (
    <div className="window-bar">
      <div className="window-title">
        <span className="window-dot" /> Poglive
      </div>
      <div className="window-actions">
        <button
          type="button"
          className="window-action"
          aria-label="Minimizar"
          onClick={() => void window.voiceShare.windowMinimize()}
        >
          <span className="minimize-glyph" />
        </button>
        <button
          type="button"
          className="window-action"
          aria-label={maximized ? 'Restaurar' : 'Maximizar'}
          onClick={() =>
            void window.voiceShare.windowToggleMaximize().then(setMaximized)
          }
        >
          <Icon name={maximized ? 'collapse' : 'expand'} size={13} />
        </button>
        <button
          type="button"
          className="window-action close-action"
          aria-label="Fechar"
          onClick={() => void window.voiceShare.windowClose()}
        >
          <span className="close-glyph" />
        </button>
      </div>
    </div>
  );
}
