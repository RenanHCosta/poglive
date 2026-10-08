import { Store } from './store';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
  action?: ToastAction;
}

export const toasts = new Store<Toast[]>([]);
let nextId = 1;

export function pushToast(
  message: string,
  tone: Toast['tone'] = 'info',
  action?: ToastAction,
): void {
  const id = nextId++;
  // Identical messages in a row replace each other instead of stacking.
  toasts.update((items) => [
    ...items.filter((item) => item.message !== message).slice(-3),
    action ? { id, message, tone, action } : { id, message, tone },
  ]);
  setTimeout(() => dismissToast(id), tone === 'error' || action ? 6000 : 3500);
}

export function dismissToast(id: number): void {
  toasts.update((items) => items.filter((item) => item.id !== id));
}
