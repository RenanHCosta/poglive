import { globalShortcut } from 'electron';
import type { ShortcutAction, Settings } from '../../shared/schemas/settings';

/** System-wide toggles that keep working while a game or another app has focus. */
export class ShortcutService {
  private registered: string[] = [];
  constructor(private readonly trigger: (action: ShortcutAction) => void) {}
  /** Returns the actions whose accelerator could not be registered. */
  apply(shortcuts: Settings['shortcuts']): ShortcutAction[] {
    this.clear();
    const failed: ShortcutAction[] = [];
    const seen = new Set<string>();
    for (const [action, accelerator] of Object.entries(shortcuts) as [
      ShortcutAction,
      string | null,
    ][]) {
      if (!accelerator) continue;
      if (seen.has(accelerator)) {
        failed.push(action);
        continue;
      }
      seen.add(accelerator);
      try {
        if (globalShortcut.register(accelerator, () => this.trigger(action)))
          this.registered.push(accelerator);
        else failed.push(action);
      } catch {
        failed.push(action);
      }
    }
    return failed;
  }
  clear(): void {
    for (const accelerator of this.registered)
      globalShortcut.unregister(accelerator);
    this.registered = [];
  }
}
