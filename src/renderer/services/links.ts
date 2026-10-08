import { Store } from './store';
import { pushToast } from './toasts';

/** Link awaiting confirmation; links from other people can be phishing. */
export const pendingLink = new Store<string | null>(null);

export function requestOpenLink(url: string): void {
  pendingLink.set(url);
}

export function openLink(url: string): void {
  pendingLink.set(null);
  void window.pogLive
    .openExternal(url)
    .then((result) => {
      if (result.status === 'ERROR') pushToast(result.message, 'error');
    })
    .catch(() => pushToast('Não foi possível abrir o link.', 'error'));
}
