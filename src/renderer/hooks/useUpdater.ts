import { useCallback, useEffect, useState } from 'react';
import type { UpdateState } from '../../shared/schemas/update';

export function useUpdater() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.pogLive.onUpdateState((next) => {
      if (active) {
        setState(next);
        setActionError(null);
      }
    });
    void window.pogLive
      .getUpdateState()
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {
        if (active) setActionError('Não foi possível consultar o atualizador.');
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const check = useCallback(async () => {
    setActionError(null);
    try {
      const result = await window.pogLive.checkForUpdate();
      if (result.status === 'ERROR') setActionError(result.message);
    } catch {
      setActionError('Não foi possível consultar o atualizador.');
    }
  }, []);

  const install = useCallback(async () => {
    setActionError(null);
    try {
      const result = await window.pogLive.installUpdate();
      if (result.status === 'ERROR') setActionError(result.message);
    } catch {
      setActionError('Não foi possível iniciar a atualização.');
    }
  }, []);

  return { state, actionError, check, install };
}
