import { useEffect, useState } from 'react';
import type { AppInfo } from '../../shared/contracts';

type DesktopState =
  | { status: 'LOADING' }
  | { status: 'READY'; info: AppInfo }
  | { status: 'ERROR'; message: string };

export function useAppInfo(): DesktopState {
  const [state, setState] = useState<DesktopState>({ status: 'LOADING' });
  useEffect(() => {
    let active = true;
    async function load(): Promise<void> {
      try {
        const info = await window.voiceShare.getAppInfo();
        if (active) setState({ status: 'READY', info });
      } catch {
        if (active)
          setState({
            status: 'ERROR',
            message:
              'Não foi possível conectar à janela desktop. Feche e abra o app novamente.',
          });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);
  return state;
}
