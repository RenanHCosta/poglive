import { useCallback, useEffect, useState } from 'react';
import type { LocalState, RoomCommand } from '../../shared/schemas/room';

type View =
  | { status: 'LOADING' }
  | { status: 'READY'; data: LocalState }
  | { status: 'ERROR'; message: string };
type ActionState =
  | { status: 'IDLE' }
  | { status: 'BUSY' }
  | { status: 'ERROR'; message: string }
  | { status: 'DONE'; message: string };
export function useRoom() {
  const [view, setView] = useState<View>({ status: 'LOADING' });
  const [action, setAction] = useState<ActionState>({ status: 'IDLE' });
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll(): Promise<void> {
      try {
        const data = await window.pogLive.getState();
        if (active) setView({ status: 'READY', data });
      } catch {
        if (active)
          setView({
            status: 'ERROR',
            message: 'Falha ao consultar o aplicativo. Feche e abra novamente.',
          });
      }
      if (active)
        timer = setTimeout(() => {
          void poll();
        }, 750);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  const command = useCallback(async (value: RoomCommand): Promise<void> => {
    setAction({ status: 'BUSY' });
    try {
      const result = await window.pogLive.command(value);
      if (result.status === 'ERROR') setAction(result);
      else {
        setView({ status: 'READY', data: await window.pogLive.getState() });
        setAction({
          status: 'DONE',
          message:
            value.type === 'COPY_INVITE'
              ? 'Código copiado. Compartilhe apenas com quem pode entrar.'
              : 'Pronto.',
        });
      }
    } catch {
      setAction({
        status: 'ERROR',
        message: 'Não foi possível concluir a operação.',
      });
    }
  }, []);
  return { view, action, command };
}
