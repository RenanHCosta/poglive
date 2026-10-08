import { dismissToast, toasts } from '../../services/toasts';
import { useStore } from '../../services/store';
import { Icon } from '../Icon';

export function Toasts() {
  const items = useStore(toasts);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone}`} role="status">
          <Icon
            name={
              toast.tone === 'error'
                ? 'alert'
                : toast.tone === 'success'
                  ? 'check'
                  : 'info'
            }
            size={18}
          />
          <span>{toast.message}</span>
          <button
            type="button"
            aria-label="Dispensar"
            onClick={() => dismissToast(toast.id)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
