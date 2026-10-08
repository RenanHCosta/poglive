import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, SettingsStore } from '../src/main/settings/store';
import {
  acceleratorSchema,
  DEFAULT_SETTINGS,
  externalUrlSchema,
  settingsSchema,
} from '../src/shared/schemas/settings';

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'poglive-settings-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('settings persist atomically and reload', async () => {
  await withDirectory(async (directory) => {
    const store = new SettingsStore(directory);
    await store.load();
    assert.deepEqual(store.get(), DEFAULT_SETTINGS);
    const peerId = randomUUID();
    await store.save({
      ...store.get(),
      audio: { ...store.get().audio, inputVolume: 150 },
      peers: { [peerId]: { volume: 40, muted: true } },
    });
    const reloaded = new SettingsStore(directory);
    await reloaded.load();
    assert.equal(reloaded.get().audio.inputVolume, 150);
    assert.deepEqual(reloaded.get().peers[peerId], { volume: 40, muted: true });
    await assert.rejects(stat(join(directory, 'settings.json.tmp')));
  });
});

test('older or partially invalid files keep valid choices', () => {
  const migrated = migrate({
    version: 1,
    audio: { inputVolume: 180, outputVolume: 999, futureOption: true },
    shortcuts: { TOGGLE_MUTE: 'M', TOGGLE_DEAFEN: null },
    unknownSection: { anything: 1 },
    peers: {
      [randomUUID()]: { volume: 50, muted: false },
      'not-a-uuid': { volume: 10, muted: true },
    },
  });
  assert.equal(migrated.audio.inputVolume, 180);
  assert.equal(
    migrated.audio.outputVolume,
    DEFAULT_SETTINGS.audio.outputVolume,
  );
  // An accelerator without modifier would hijack typing; it falls back.
  assert.equal(
    migrated.shortcuts.TOGGLE_MUTE,
    DEFAULT_SETTINGS.shortcuts.TOGGLE_MUTE,
  );
  assert.equal(migrated.shortcuts.TOGGLE_DEAFEN, null);
  assert.equal(Object.keys(migrated.peers).length, 1);
  assert.equal(settingsSchema.safeParse(migrated).success, true);
});

test('unreadable settings are set aside and defaults are used', async () => {
  await withDirectory(async (directory) => {
    await writeFile(join(directory, 'settings.json'), '{ not json');
    const store = new SettingsStore(directory);
    await store.load();
    assert.deepEqual(store.get(), DEFAULT_SETTINGS);
    assert.equal(
      await readFile(join(directory, 'settings.invalid.json'), 'utf8'),
      '{ not json',
    );
  });
});

test('global shortcuts require a modifier or a high function key', () => {
  for (const valid of [
    'CommandOrControl+Shift+M',
    'Alt+F9',
    'Ctrl+Alt+Shift+num5',
    'F13',
    'Shift+Space',
  ])
    assert.equal(acceleratorSchema.safeParse(valid).success, true, valid);
  for (const invalid of [
    'M',
    'F5',
    'Shift',
    'Ctrl+',
    'CommandOrControl+Shift+MM',
  ])
    assert.equal(acceleratorSchema.safeParse(invalid).success, false, invalid);
});

test('external links accept only http(s) without credentials', () => {
  assert.equal(
    externalUrlSchema.safeParse('https://github.com/x').success,
    true,
  );
  for (const unsafe of [
    'file:///C:/Windows/system32/calc.exe',
    'javascript:alert(1)',
    'https://user:pass@example.com',
    'ms-settings:privacy',
    `https://example.com/${'a'.repeat(2048)}`,
  ])
    assert.equal(externalUrlSchema.safeParse(unsafe).success, false, unsafe);
});
