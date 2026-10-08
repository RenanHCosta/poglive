import { useCallback, useEffect, useState } from 'react';
import type { LocalState, RoomCommand } from '../../shared/schemas/room';
import { pushToast } from '../services/toasts';

type View =
  | { status: 'LOADING' }
  | { status: 'READY'; data: LocalState }
  | { status: 'ERROR'; message: string };

// Main pushes a STATE event on every change; the poll is only a safety net.
const FALLBACK_POLL_MS = 3000;

export function useRoom() {
  const [view, setView] = useState<View>({ status: 'LOADING' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    let again = false;
    async function refresh(): Promise<void> {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      clearTimeout(timer);
      try {
        const data = await window.pogLive.getState();
        if (active) setView({ status: 'READY', data });
      } catch {
        if (active)
          setView({
            status: 'ERROR',
            message: 'Falha ao consultar o aplicativo. Feche e abra novamente.',
          });
      } finally {
        inFlight = false;
      }
      if (!active) return;
      if (again) {
        again = false;
        void refresh();
      } else
        timer = setTimeout(() => {
          void refresh();
        }, FALLBACK_POLL_MS);
    }
    const unsubscribe = window.pogLive.onRoomEvent((event) => {
      if (event.type === 'STATE') void refresh();
    });
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);
  /** Resolves true on success; failures surface as a toast. */
  const command = useCallback(async (value: RoomCommand): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await window.pogLive.command(value);
      if (result.status === 'ERROR') {
        pushToast(result.message, 'error');
        return false;
      }
      setView({ status: 'READY', data: await window.pogLive.getState() });
      return true;
    } catch {
      pushToast('Não foi possível concluir a operação.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { view, busy, command };
}
