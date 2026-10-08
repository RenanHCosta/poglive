import { app, BrowserWindow, net, protocol, session } from 'electron';
import { resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { registerIpc } from './ipc';
import { IdentityStore } from './room/identity';
import { RoomService } from './room/service';
import { RoomClient } from './room/client';
import { decodeInvite } from './room/invite';
import { randomUUID } from 'node:crypto';
import { CaptureService } from './capture/service';
import { ProcessAudioService } from './capture/process-audio';
import { UpdateService } from './update/service';
import { IPC } from '../shared/contracts';
import type { ShortcutAction } from '../shared/schemas/settings';
import { SettingsStore } from './settings/store';
import { ShortcutService } from './settings/shortcuts';
import { e2eOptions, prepareE2E, runE2E } from './e2e';
import { TrayService } from './tray';
import { loadWindowState, trackWindowState } from './window-state';

const WEBRTC_MDNS_FEATURE = 'WebRtcHideLocalIpsWithMdns';
const WEBRTC_UDP_PORT_RANGE = { min: 52000, max: 52100 } as const;

function configureLanWebRtc(): void {
  if (process.platform !== 'win32') return;
  const disabledFeatures = app.commandLine
    .getSwitchValue('disable-features')
    .split(',')
    .map((feature) => feature.trim())
    .filter(Boolean);
  if (!disabledFeatures.includes(WEBRTC_MDNS_FEATURE)) {
    disabledFeatures.push(WEBRTC_MDNS_FEATURE);
    app.commandLine.appendSwitch(
      'disable-features',
      disabledFeatures.join(','),
    );
  }
}

// LAN/VPN peers cannot reliably resolve Chromium's per-device .local aliases.
// This must run before app readiness and before any renderer process starts.
configureLanWebRtc();

const development = !app.isPackaged && process.env.POGLIVE_DEV === '1';
const smoke = !app.isPackaged && process.argv.includes('--smoke-test');
const profile = process.argv
  .find((arg) => arg.startsWith('--profile='))
  ?.slice(10);
if (profile && !/^[a-zA-Z0-9_-]{1,24}$/.test(profile))
  throw new Error('Invalid profile name');
const e2e = e2eOptions();
if (e2e) prepareE2E(e2e);
else if (smoke)
  app.setPath(
    'userData',
    resolve(app.getAppPath(), '.artifacts/smoke-profile'),
  );
else if (profile)
  app.setPath(
    'userData',
    resolve(app.getPath('userData'), 'profiles', profile),
  );
if (!app.requestSingleInstanceLock()) app.exit(0);
const identities = new IdentityStore(app.getPath('userData'));
const rooms = new RoomService(identities);
const settings = new SettingsStore(app.getPath('userData'));
function sendShortcut(action: ShortcutAction): void {
  const contents = window?.webContents;
  if (contents && !contents.isDestroyed()) contents.send(IPC.shortcut, action);
}
const shortcuts = new ShortcutService(sendShortcut);
let quitting = false;
const tray = new TrayService(
  () => window,
  sendShortcut,
  () => app.quit(),
);
function inRoom(): boolean {
  const status = rooms.snapshot().room.status;
  return status === 'HOSTING' || status === 'JOINED';
}
rooms.subscribe((event) => {
  const contents = window?.webContents;
  if (contents && !contents.isDestroyed()) contents.send(IPC.roomEvent, event);
  // Draw attention to new messages from others while the window is in the background.
  if (
    event.type === 'CHAT_MESSAGE' &&
    window &&
    !window.isDestroyed() &&
    !window.isFocused() &&
    event.message.authorId !== identities.get()?.peerId
  )
    window.flashFrame(true);
});
app.on('second-instance', () => tray.show());
const rendererUrl = development
  ? 'http://127.0.0.1:5173/'
  : 'app://poglive/index.html';
let window: BrowserWindow | null = null;
const capture = new CaptureService(() => window, rendererUrl);
const processAudio = new ProcessAudioService();
const updates = new UpdateService(
  () => window,
  () => {
    const status = rooms.snapshot().room.status;
    return status === 'IDLE' || status === 'DISCONNECTED';
  },
);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

function configureSession(): void {
  const nonce = process.env.POGLIVE_CSP_NONCE;
  if (development && (!nonce || !/^[A-Za-z0-9+/]{32}$/.test(nonce))) {
    throw new Error('Development CSP nonce missing');
  }
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (event) => event.preventDefault());
  const csp = [
    "default-src 'none'",
    development ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'",
    development ? `style-src 'self' 'nonce-${nonce}'` : "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'self' blob:",
    development
      ? "connect-src 'self' ws://127.0.0.1:5173"
      : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

function configureProtocol(): void {
  const root = resolve(__dirname, '../renderer');
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'poglive' || request.method !== 'GET')
        return new Response(null, { status: 403 });
      const file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (
        !file.startsWith(`${root}${sep}`) ||
        !['.html', '.js', '.css', '.svg'].includes(extname(file))
      ) {
        return new Response(null, { status: 403 });
      }
      return await net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

async function createWindow(): Promise<void> {
  const automated = smoke || !!e2e;
  const saved = automated
    ? { bounds: { width: 1280, height: 800 }, maximized: false }
    : loadWindowState(app.getPath('userData'));
  window = new BrowserWindow({
    ...saved.bounds,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#1e1f22',
    title: 'Poglive',
    frame: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolve(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      // Voice keeps running while minimized or behind a game; throttled timers
      // would stall speaking detection and audio graph scheduling.
      backgroundThrottling: false,
      // Remote voice must play as soon as someone speaks, without a click.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  // Enumerate every interface so virtual LAN adapters such as Radmin are
  // eligible for host ICE candidates, not only the operating system route.
  window.webContents.setWebRTCIPHandlingPolicy('default');
  // A fixed range allows a firewall rule that survives portable extraction
  // paths while leaving enough ports for the eight-peer MVP room limit.
  window.webContents.setWebRTCUDPPortRange(WEBRTC_UDP_PORT_RANGE);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('did-start-navigation', () => {
    capture.cancel();
    processAudio.stop();
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) =>
    event.preventDefault(),
  );
  window.webContents.on('render-process-gone', () =>
    console.error('[App] Renderer process stopped'),
  );
  window.on('focus', () => window?.flashFrame(false));
  window.on('close', (event) => {
    // Closing during a call hides to the tray instead of dropping the room.
    if (!quitting && !automated && inRoom()) {
      event.preventDefault();
      tray.hideToTray();
    }
  });
  if (!automated) trackWindowState(window, app.getPath('userData'));
  window.on('closed', () => {
    capture.cancel();
    processAudio.stop();
    window = null;
  });
  await window.loadURL(rendererUrl);
  if (!automated) {
    if (saved.maximized) window.maximize();
    window.show();
  }
  console.info('[App] Window ready');
  if (e2e) void runE2E(window, e2e);
  if (smoke) {
    // Fixed local diagnostic only; no user-supplied script is evaluated.
    const passed: unknown = await window.webContents.executeJavaScript(`
      (async () => {
        const info = await window.pogLive.getAppInfo();
        const updateState = await window.pogLive.getUpdateState();
        const saved = await window.pogLive.command({ type: 'SAVE_IDENTITY', displayName: 'Teste local' });
        if (saved.status !== 'OK') throw new Error(saved.message);
        const created = await window.pogLive.command({ type: 'CREATE_ROOM', name: 'Sala de teste', address: '127.0.0.1' });
        if (created.status !== 'OK') throw new Error(created.message);
        await new Promise(resolve => setTimeout(resolve, 300));
        const probe = document.createElement('script');
        probe.textContent = 'window.__cspProbe = true';
        document.head.append(probe);
        probe.remove();
        return info.name === 'Poglive' && typeof window.require === 'undefined'
          && typeof window.process === 'undefined'
          && updateState.status === 'DISABLED'
          && updateState.reason === 'DEVELOPMENT'
          && typeof window.pogLive.checkForUpdate === 'function'
          && typeof window.pogLive.installUpdate === 'function'
          && window.__cspProbe !== true
          && getComputedStyle(document.body).margin === '0px'
          && document.title === 'Poglive'
          && document.querySelector('link[rel="icon"]')?.getAttribute('href') === './poglive.svg'
          && document.querySelector('img.app-icon')?.complete === true
          && document.querySelector('img.app-icon')?.naturalWidth > 0
          && document.querySelector('[data-testid="desktop-status"]')?.textContent.includes('Desktop pronto');
      })()
    `);
    if (passed !== true) throw new Error('Desktop smoke check failed');
    const room = rooms.snapshot().room;
    if (room.status !== 'HOSTING') throw new Error('Room creation failed');
    const testPeer = new RoomClient();
    await testPeer.join(
      decodeInvite(room.invite),
      { peerId: randomUUID(), displayName: 'Segundo participante' },
      () => {},
    );
    if (
      rooms.snapshot().room.status !== 'HOSTING' ||
      testPeer.room?.participants.length !== 2
    )
      throw new Error('Electron room join failed');
    // The renderer must learn about the new member from a pushed event.
    const rendered: unknown = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const deadline = Date.now() + 3000;
        const check = () => {
          if (document.body.textContent.includes("2/8 na sala")) resolve(true);
          else if (Date.now() > deadline) resolve(document.body.textContent.slice(0, 400));
          else setTimeout(check, 50);
        };
        check();
      })
    `);
    if (rendered !== true)
      throw new Error(`Room state not rendered: ${String(rendered)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const artifactDirectory = resolve(app.getAppPath(), '.artifacts');
    await mkdir(artifactDirectory, { recursive: true });
    const capture = async (name: string): Promise<void> => {
      const image = await window!.webContents.capturePage();
      await writeFile(resolve(artifactDirectory, name), image.toPNG());
    };
    await capture('milestone-2.png');
    // Chat round trip: a member's message reaches the host UI through the room.
    testPeer.sendChat(
      randomUUID(),
      'Olá do **teste** com `código` e @Teste local',
    );
    const chatted: unknown = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        [...document.querySelectorAll('button.channel')]
          .find((button) => button.textContent.trim() === 'chat')?.click();
        const deadline = Date.now() + 3000;
        const check = () => {
          const message = document.querySelector('.message.mentioned strong');
          if (message?.textContent === 'teste') resolve(true);
          else if (Date.now() > deadline) resolve(false);
          else setTimeout(check, 50);
        };
        check();
      })
    `);
    if (chatted !== true) throw new Error('Chat message not rendered');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await capture('smoke-chat.png');
    // Hidden smoke windows do not advance CSS animations.
    await window.webContents.insertCSS(
      '*, *::before, *::after { animation: none !important; transition: none !important; }',
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('[aria-label="Configurações de usuário"]')?.click();
      new Promise((resolve) => setTimeout(() => {
        [...document.querySelectorAll('.settings-nav-item')]
          .find((button) => button.textContent === 'Voz e áudio')?.click();
        setTimeout(resolve, 300);
      }, 200));
    `);
    await capture('smoke-settings.png');
    console.info(
      '[App] Smoke passed: renderer, styles, preload, IPC, Node isolation, CSP, TLS room join, chat',
    );
    testPeer.close();
    await rooms.close();
    app.quit();
  }
}

if (smoke)
  setTimeout(() => {
    console.error('[App] Smoke timeout');
    app.exit(1);
  }, 25000).unref();

app
  .whenReady()
  .then(async () => {
    configureSession();
    capture.install();
    configureProtocol();
    await identities.load();
    await settings.load();
    registerIpc(
      () => window,
      rendererUrl,
      rooms,
      capture,
      processAudio,
      updates,
      settings,
      shortcuts,
    );
    await createWindow();
    updates.start();
  })
  .catch((error: unknown) => {
    console.error(
      '[App] Startup failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    app.exit(1);
  });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  shortcuts.clear();
  tray.destroy();
});
app.on('before-quit', () => {
  quitting = true;
  updates.close();
  processAudio.stop();
  void rooms.close();
});
