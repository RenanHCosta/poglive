import { screen } from 'electron';
import type { BrowserWindow, Rectangle } from 'electron';
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const stateSchema = z
  .object({
    x: z.number().int().min(-100000).max(100000),
    y: z.number().int().min(-100000).max(100000),
    width: z.number().int().min(400).max(20000),
    height: z.number().int().min(300).max(20000),
    maximized: z.boolean(),
  })
  .strict();
type WindowState = z.infer<typeof stateSchema>;

const DEFAULT_SIZE = { width: 1280, height: 800 };

/** Restores the last window bounds when they still fit on a connected display. */
export function loadWindowState(directory: string): {
  bounds: Partial<Rectangle> & { width: number; height: number };
  maximized: boolean;
} {
  try {
    const state = stateSchema.parse(
      JSON.parse(readFileSync(join(directory, 'window-state.json'), 'utf8')),
    );
    const area = screen.getDisplayMatching(state).workArea;
    const visible =
      state.x < area.x + area.width - 100 &&
      state.x + state.width > area.x + 100 &&
      state.y >= area.y - 10 &&
      state.y < area.y + area.height - 100;
    return visible
      ? { bounds: state, maximized: state.maximized }
      : {
          bounds: { width: state.width, height: state.height },
          maximized: state.maximized,
        };
  } catch {
    return { bounds: DEFAULT_SIZE, maximized: false };
  }
}

export function trackWindowState(
  window: BrowserWindow,
  directory: string,
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    if (window.isDestroyed() || window.isMinimized()) return;
    const bounds = window.getNormalBounds();
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: window.isMaximized(),
    };
    if (!stateSchema.safeParse(state).success) return;
    const path = join(directory, 'window-state.json');
    void mkdir(directory, { recursive: true })
      .then(() => writeFile(`${path}.tmp`, JSON.stringify(state)))
      .then(() => rename(`${path}.tmp`, path))
      .catch(() => {});
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  window.on('resize', schedule);
  window.on('move', schedule);
  window.on('maximize', schedule);
  window.on('unmaximize', schedule);
  window.on('close', () => {
    clearTimeout(timer);
    save();
  });
}
