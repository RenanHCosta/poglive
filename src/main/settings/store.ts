import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_SETTINGS,
  MAX_PEER_AUDIO_ENTRIES,
  settingsSchema,
} from '../../shared/schemas/settings';
import type { Settings } from '../../shared/schemas/settings';

const MAX_FILE_BYTES = 64 * 1024;

/**
 * Preferences are not critical data: an unreadable file is set aside and the
 * defaults are used, unlike the identity file which must never be replaced.
 */
export class SettingsStore {
  private value: Settings = structuredClone(DEFAULT_SETTINGS);
  private writes = Promise.resolve();
  constructor(private readonly directory: string) {}
  get(): Settings {
    return structuredClone(this.value);
  }
  async load(): Promise<void> {
    const path = join(this.directory, 'settings.json');
    try {
      if ((await stat(path)).size > MAX_FILE_BYTES)
        throw new Error('Settings size');
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      this.value = migrate(parsed);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return;
      console.warn('[Settings] Invalid settings file; using defaults');
      this.value = structuredClone(DEFAULT_SETTINGS);
      await rename(path, join(this.directory, 'settings.invalid.json')).catch(
        () => {},
      );
    }
  }
  async save(next: Settings): Promise<Settings> {
    const parsed = settingsSchema.parse(trimPeers(next));
    this.value = parsed;
    // Serialize writes so an older snapshot can never land after a newer one.
    const task = this.writes.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const path = join(this.directory, 'settings.json');
      await writeFile(`${path}.tmp`, JSON.stringify(parsed), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    });
    this.writes = task.catch(() => {});
    await task;
    return structuredClone(parsed);
  }
}

/**
 * Keeps every valid user choice and fills the rest with defaults. Unknown
 * keys (from a newer build) and invalid values are dropped field by field
 * instead of discarding the whole file.
 */
export function migrate(value: unknown): Settings {
  const strict = settingsSchema.safeParse(value);
  if (strict.success) return strict.data;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Settings shape');
  const source = value as Record<string, unknown>;
  const section = <T extends object>(defaults: T, raw: unknown): T => {
    const input = asObject(raw);
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof T)[])
      if (key in input)
        (result as Record<keyof T, unknown>)[key] = input[key as string];
    return result;
  };
  const candidate: Settings = {
    version: 1,
    audio: section(DEFAULT_SETTINGS.audio, source.audio),
    shortcuts: section(DEFAULT_SETTINGS.shortcuts, source.shortcuts),
    notifications: section(
      DEFAULT_SETTINGS.notifications,
      source.notifications,
    ),
    stream: section(DEFAULT_SETTINGS.stream, source.stream),
    clips: section(DEFAULT_SETTINGS.clips, source.clips),
    peers: Object.fromEntries(
      Object.entries(asObject(source.peers)).flatMap(([peerId, preference]) => {
        const parsed = settingsSchema.shape.peers.safeParse({
          [peerId]: preference,
        });
        return parsed.success ? Object.entries(parsed.data) : [];
      }),
    ),
  };
  // Field-level fallback: any section that still fails reverts to its defaults.
  for (const key of [
    'audio',
    'shortcuts',
    'notifications',
    'stream',
    'clips',
  ] as const) {
    const checked = settingsSchema.shape[key].safeParse(candidate[key]);
    if (!checked.success) {
      const repaired: Record<string, unknown> = { ...DEFAULT_SETTINGS[key] };
      for (const [field, fieldValue] of Object.entries(candidate[key])) {
        const attempt = settingsSchema.shape[key].safeParse({
          ...repaired,
          [field]: fieldValue,
        });
        if (attempt.success) repaired[field] = fieldValue;
      }
      (candidate as Record<string, unknown>)[key] = repaired;
    }
  }
  return settingsSchema.parse(trimPeers(candidate));
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function trimPeers(settings: Settings): Settings {
  const entries = Object.entries(settings.peers);
  if (entries.length <= MAX_PEER_AUDIO_ENTRIES) return settings;
  return {
    ...settings,
    peers: Object.fromEntries(entries.slice(-MAX_PEER_AUDIO_ENTRIES)),
  };
}
