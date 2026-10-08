import { app, shell } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_CLIP_BYTES = 512 * 1024 * 1024;

function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/** Keeps only characters that are safe in Windows file names. */
export function clipFileName(label: string, date: Date): string {
  const clean = label
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return `${clean || 'Clipe'} ${stamp(date)}.webm`;
}

/**
 * Writes clips to Videos\Poglive. The renderer never chooses a path; it can
 * only ask to reveal files this process saved.
 */
export class ClipStore {
  private readonly saved = new Map<string, string>();

  folder(): string {
    return join(app.getPath('videos'), 'Poglive');
  }

  async save(bytes: Uint8Array, label: string): Promise<string> {
    if (!bytes.length || bytes.length > MAX_CLIP_BYTES)
      throw new Error('Clip size');
    // WebM always starts with the EBML magic number.
    if (
      bytes[0] !== 0x1a ||
      bytes[1] !== 0x45 ||
      bytes[2] !== 0xdf ||
      bytes[3] !== 0xa3
    )
      throw new Error('Clip format');
    const folder = this.folder();
    await mkdir(folder, { recursive: true });
    const base = clipFileName(label, new Date());
    let name = base;
    for (let attempt = 2; ; attempt++) {
      try {
        await writeFile(join(folder, name), bytes, { flag: 'wx' });
        break;
      } catch (error: unknown) {
        if (
          !(error && typeof error === 'object' && 'code' in error) ||
          error.code !== 'EEXIST' ||
          attempt > 50
        )
          throw error;
        name = base.replace(/\.webm$/, ` (${attempt}).webm`);
      }
    }
    this.saved.set(name, join(folder, name));
    return name;
  }

  reveal(name: string): boolean {
    const path = this.saved.get(name);
    if (!path) return false;
    shell.showItemInFolder(path);
    return true;
  }

  async openFolder(): Promise<void> {
    const folder = this.folder();
    await mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  }
}
