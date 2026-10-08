import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Development-only two-instance test driven by scripts/e2e.mjs. Each role
 * runs in its own Electron process and profile and drives the real UI with
 * Chromium's fake microphone, exercising room, chat, voice and screen share
 * over real WebRTC on loopback. Never active in packaged builds.
 */
export type E2ERole = 'host' | 'guest';

export function e2eOptions(): { role: E2ERole; directory: string } | null {
  if (app.isPackaged) return null;
  const role = process.argv.find((arg) => arg.startsWith('--e2e='))?.slice(6);
  const directory = process.argv
    .find((arg) => arg.startsWith('--e2e-dir='))
    ?.slice(10);
  if ((role !== 'host' && role !== 'guest') || !directory) return null;
  return { role, directory: resolve(directory) };
}

export function prepareE2E(options: {
  role: E2ERole;
  directory: string;
}): void {
  app.setPath('userData', resolve(options.directory, options.role));
  // Clips land in the test directory, never in the user's Videos folder.
  app.setPath('videos', resolve(options.directory, options.role, 'videos'));
  // Synthetic beeping microphone; no device prompt.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

async function until<T>(
  window: BrowserWindow,
  label: string,
  expression: string,
  timeout = 45000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value: unknown = await window.webContents.executeJavaScript(
      expression,
      true,
    );
    if (value) return value as T;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((done) => setTimeout(done, 200));
  }
}

function click(selector: string, text?: string): string {
  return `(() => {
    const items = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const target = ${text === undefined ? 'items[0]' : `items.find((item) => item.textContent.includes(${JSON.stringify(text)}))`};
    if (!target || target.disabled) return false;
    target.click();
    return true;
  })()`;
}

export async function runE2E(
  window: BrowserWindow,
  options: { role: E2ERole; directory: string },
): Promise<void> {
  const { role, directory } = options;
  const steps: string[] = [];
  const step = (name: string) => {
    steps.push(name);
    console.info(`[E2E:${role}] ${name}`);
  };
  const result = resolve(directory, `${role}.result.json`);
  // Hidden windows stop painting, so captures would show stale frames. Keep
  // the window visible but off-screen and unfocused.
  window.setPosition(-4000 - (role === 'host' ? 0 : 1400), 0);
  window.showInactive();
  window.webContents.on('console-message', (event) => {
    console.info(`[E2E:${role}:renderer] ${event.message}`);
  });
  try {
    await mkdir(directory, { recursive: true });
    const name = role === 'host' ? 'Anfitriã E2E' : 'Convidado E2E';
    await until(window, 'bridge', 'typeof window.pogLive === "object"');
    await window.webContents.executeJavaScript(
      `window.pogLive.command({ type: 'SAVE_IDENTITY', displayName: ${JSON.stringify(name)} })`,
    );
    step('identity');
    if (role === 'host') {
      await window.webContents.executeJavaScript(
        `window.pogLive.command({ type: 'CREATE_ROOM', name: 'Sala E2E', address: '127.0.0.1' })`,
      );
      const invite = await until<string>(
        window,
        'invite',
        `window.pogLive.getState().then((state) => state.room.status === 'HOSTING' ? state.room.invite : '')`,
      );
      await writeFile(resolve(directory, 'invite.txt'), invite);
      step('room created');
    } else {
      const invite = await (async () => {
        const deadline = Date.now() + 30000;
        for (;;) {
          try {
            return (
              await readFile(resolve(directory, 'invite.txt'), 'utf8')
            ).trim();
          } catch {
            if (Date.now() > deadline) throw new Error('Invite not written');
            await new Promise((done) => setTimeout(done, 200));
          }
        }
      })();
      const joined: unknown = await window.webContents.executeJavaScript(
        `window.pogLive.command({ type: 'JOIN_ROOM', invite: ${JSON.stringify(invite)} })`,
      );
      if ((joined as { status?: string }).status !== 'OK')
        throw new Error(`Join failed: ${JSON.stringify(joined)}`);
      step('joined room');
    }
    await until(
      window,
      'stage',
      click('.stage-controls .button.success', 'Entrar na voz'),
    );
    await until(
      window,
      'voice connected',
      `!!document.querySelector('[aria-label="Sair da voz"]')`,
    );
    step('voice connected');
    const other = role === 'host' ? 'Convidado E2E' : 'Anfitriã E2E';
    await until(
      window,
      'peer in voice',
      `[...document.querySelectorAll('.voice-tile .tile-name')].some((item) => item.textContent.includes(${JSON.stringify(other)}))`,
    );
    step('peer visible in voice');
    // The fake microphone beeps once per second: the remote tile must light up.
    await until(
      window,
      'remote speaking',
      `[...document.querySelectorAll('.voice-tile.speaking .tile-name')].some((item) => item.textContent.includes(${JSON.stringify(other)}))`,
    );
    step('remote voice detected');
    // Text chat in both directions.
    await window.webContents.executeJavaScript(
      `window.pogLive.command({ type: 'SEND_CHAT', id: crypto.randomUUID(), text: 'oi de ${role}' })`,
    );
    const otherRole = role === 'host' ? 'guest' : 'host';
    await until(
      window,
      'chat received',
      `(async () => (await window.pogLive.getChatHistory()).messages.some((message) => message.text === 'oi de ${otherRole}'))()`,
    );
    step('chat delivered');
    if (role === 'host') {
      await until(
        window,
        'share button',
        click('[aria-label="Transmitir tela"]'),
      );
      await until(window, 'sources', click('.segmented button', 'Telas'));
      await until(window, 'pick source', click('.source-grid .source'));
      await until(
        window,
        'start share',
        click('.modal-footer .button.primary', 'Transmitir'),
      );
      await until(
        window,
        'live',
        `!!document.querySelector('.stream-tile.self video')`,
      );
      step('screen share live');
      await until(
        window,
        'viewer',
        `document.querySelector('.stream-tile.self .viewer-count')?.textContent.trim() === '1'`,
      );
      step('guest watching');
      await until(
        window,
        'clip notice',
        `[...document.querySelectorAll('.toast')].some((toast) => toast.textContent.includes('salvou um clipe da sua transmissão'))`,
        60000,
      );
      step('notified of clip');
    } else {
      await until(window, 'watch', click('.stream-invite .button.primary'));
      await until(
        window,
        'video playing',
        `(() => { const video = document.querySelector('.stream-player video'); return !!video && video.readyState >= 2 && video.videoWidth > 0; })()`,
      );
      step('stream video playing');
      // Let a few seconds buffer, then clip what was just watched.
      await until(
        window,
        'clip button',
        `!!document.querySelector('.stream-player .stream-button.clip')`,
      );
      await new Promise((done) => setTimeout(done, 4500));
      await until(
        window,
        'save clip',
        click('.stream-player .stream-button.clip'),
      );
      await until(
        window,
        'clip saved',
        `[...document.querySelectorAll('.toast')].some((toast) => toast.textContent.includes('Clipe salvo'))`,
      );
      const clipsFolder = resolve(directory, role, 'videos', 'Poglive');
      const files = (await readdir(clipsFolder)).filter((file) =>
        file.endsWith('.webm'),
      );
      if (files.length !== 1)
        throw new Error(`Expected one clip, found ${files.length}`);
      const clipBytes = await readFile(resolve(clipsFolder, files[0]!));
      // The clip must decode on its own in a fresh media element.
      const played: unknown = await window.webContents.executeJavaScript(`
        (async () => {
          const bytes = Uint8Array.from(atob(${JSON.stringify(clipBytes.toString('base64'))}), (c) => c.charCodeAt(0));
          const video = document.createElement('video');
          video.muted = true;
          video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
          await new Promise((ok, fail) => { video.onloadeddata = ok; video.onerror = () => fail(new Error('decode')); });
          await video.play();
          await new Promise((done) => setTimeout(done, 800));
          const quality = video.getVideoPlaybackQuality();
          video.pause();
          return video.videoWidth > 0 && quality.totalVideoFrames > 5 && quality.corruptedVideoFrames === 0;
        })()
      `);
      if (played !== true) throw new Error('Clip does not play');
      step('clip saved and playable');
    }
    // Mute must reach the other side through host presence.
    if (role === 'guest') {
      await until(
        window,
        'mute',
        click('.stage-controls [aria-label="Silenciar"]'),
      );
      step('muted');
    } else {
      await until(
        window,
        'remote muted',
        `[...document.querySelectorAll('.voice-tile')].some((tile) => tile.textContent.includes('Convidado E2E') && tile.querySelector('.tile-state'))`,
      );
      step('remote mute visible');
    }
    await new Promise((done) => setTimeout(done, 400));
    const shot = await window.webContents.capturePage();
    await writeFile(resolve(directory, `${role}.png`), shot.toPNG());
    if (role === 'guest') {
      // Opening the stream focused it; the participant strip can be hidden.
      await until(window, 'hide strip', click('.strip-toggle', 'Ocultar'));
      await until(
        window,
        'strip hidden',
        `!document.querySelector('.stage-strip') && !!document.querySelector('.stage-focus.strip-hidden .stream-player')`,
      );
      step('participant strip hidden');
      await new Promise((done) => setTimeout(done, 300));
      const focused = await window.webContents.capturePage();
      await writeFile(resolve(directory, 'guest-focus.png'), focused.toPNG());
      // Leaving voice closes streams being watched.
      await until(window, 'leave voice', click('[aria-label="Sair da voz"]'));
      await until(
        window,
        'stream closed',
        `!document.querySelector('.stream-player')`,
      );
      step('left voice, stream closed');
    } else {
      await until(
        window,
        'viewer left',
        `document.querySelector('.stream-tile.self .viewer-count')?.textContent.trim() === '0'`,
      );
      step('viewer count back to 0');
    }
    // Let the other side finish before the room closes.
    await new Promise((done) =>
      setTimeout(done, role === 'host' ? 4000 : 1000),
    );
    await writeFile(result, JSON.stringify({ ok: true, steps }));
  } catch (error: unknown) {
    const shot = await window.webContents.capturePage().catch(() => null);
    if (shot)
      await writeFile(resolve(directory, `${role}-failure.png`), shot.toPNG());
    await writeFile(
      result,
      JSON.stringify({
        ok: false,
        steps,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  app.quit();
}
