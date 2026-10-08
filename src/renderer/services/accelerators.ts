import { acceleratorSchema } from '../../shared/schemas/settings';

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  '+': 'Plus',
};

/** Converts a keydown into an Electron accelerator, or null if unsupported. */
export function acceleratorFromEvent(event: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('CommandOrControl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');
  let key = KEY_NAMES[event.key] ?? event.key;
  // Physical codes keep letters stable regardless of Shift or layout quirks.
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit\d$/.test(event.code)) key = event.code.slice(5);
  else if (/^Numpad\d$/.test(event.code)) key = `num${event.code.slice(6)}`;
  else if (key.length === 1) key = key.toUpperCase();
  const accelerator = [...parts, key].join('+');
  return acceleratorSchema.safeParse(accelerator).success ? accelerator : null;
}

export function formatAccelerator(accelerator: string): string {
  return accelerator
    .replace('CommandOrControl', 'Ctrl')
    .replace('Control', 'Ctrl')
    .replace('Super', 'Win')
    .replaceAll('+', ' + ');
}
