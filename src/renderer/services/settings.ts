import type { Settings, ShortcutAction } from '../../shared/schemas/settings';
import { configureSounds } from './sounds';
import { Store } from './store';
import { pushToast } from './toasts';

export type SettingsState =
  | { status: 'LOADING' }
  | {
      status: 'READY';
      settings: Settings;
      unavailableShortcuts: ShortcutAction[];
    };

/** App-wide preferences, persisted by the main process. */
export const settingsStore = new Store<SettingsState>({ status: 'LOADING' });
let saving = Promise.resolve();

function apply(settings: Settings, unavailable: ShortcutAction[]): void {
  settingsStore.set({
    status: 'READY',
    settings,
    unavailableShortcuts: unavailable,
  });
  configureSounds({
    enabled: settings.notifications.sounds,
    deviceId: settings.audio.outputDeviceId,
  });
}

export async function loadSettings(): Promise<void> {
  const result = await window.pogLive.getSettings();
  if (result.status === 'OK')
    apply(result.settings, result.unavailableShortcuts);
  else throw new Error(result.message);
}

export function currentSettings(): Settings | null {
  const state = settingsStore.get();
  return state.status === 'READY' ? state.settings : null;
}

const SAVE_DELAY_MS = 250;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Applies a change optimistically so sliders stay responsive, then persists
 * the latest value once changes settle. Saves never overlap.
 */
export function updateSettings(change: (settings: Settings) => Settings): void {
  const state = settingsStore.get();
  if (state.status !== 'READY') return;
  apply(change(state.settings), state.unavailableShortcuts);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saving = saving.then(persist);
  }, SAVE_DELAY_MS);
}

async function persist(): Promise<void> {
  const next = currentSettings();
  if (!next) return;
  try {
    const result = await window.pogLive.updateSettings(next);
    if (result.status === 'ERROR') {
      pushToast(result.message, 'error');
      return;
    }
    const latest = settingsStore.get();
    if (latest.status !== 'READY') return;
    // Keep newer local edits; only adopt the shortcut availability report.
    if (latest.settings === next)
      apply(result.settings, result.unavailableShortcuts);
    else
      settingsStore.set({
        ...latest,
        unavailableShortcuts: result.unavailableShortcuts,
      });
  } catch {
    pushToast('Não foi possível salvar as configurações.', 'error');
  }
}
