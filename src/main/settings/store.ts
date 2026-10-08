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

/** Fills fields added after the file was written, keeping valid user choices. */
export function migrate(value: unknown): Settings {
  const strict = settingsSchema.safeParse(value);
  if (strict.success) return strict.data;
  if (!value || typeof value !== 'object') throw new Error('Settings shape');
  const source = value as Partial<Record<keyof Settings, unknown>>;
  const merged = {
    ...DEFAULT_SETTINGS,
    ...source,
    version: 1,
    audio: { ...DEFAULT_SETTINGS.audio, ...asObject(source.audio) },
    shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...asObject(source.shortcuts) },
    notifications: {
      ...DEFAULT_SETTINGS.notifications,
      ...asObject(source.notifications),
    },
    stream: { ...DEFAULT_SETTINGS.stream, ...asObject(source.stream) },
    peers: asObject(source.peers),
  };
  return settingsSchema.parse(merged);
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
