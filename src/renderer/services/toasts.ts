import { Store } from './store';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
}

export const toasts = new Store<Toast[]>([]);
let nextId = 1;

export function pushToast(message: string, tone: Toast['tone'] = 'info'): void {
  const id = nextId++;
  // Identical messages in a row replace each other instead of stacking.
  toasts.update((items) => [
    ...items.filter((item) => item.message !== message).slice(-3),
    { id, message, tone },
  ]);
  setTimeout(() => dismissToast(id), tone === 'error' ? 6000 : 3500);
}

export function dismissToast(id: number): void {
  toasts.update((items) => items.filter((item) => item.id !== id));
}
