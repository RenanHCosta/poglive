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

const development = !app.isPackaged && process.env.VOICE_SHARE_DEV === '1';
const smoke = !app.isPackaged && process.argv.includes('--smoke-test');
const profile = process.argv
  .find((arg) => arg.startsWith('--profile='))
  ?.slice(10);
if (profile && !/^[a-zA-Z0-9_-]{1,24}$/.test(profile))
  throw new Error('Invalid profile name');
if (smoke)
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
app.on('second-instance', () => {
  window?.restore();
  window?.focus();
});
const rendererUrl = development
  ? 'http://127.0.0.1:5173/'
  : 'app://voice-share/index.html';
let window: BrowserWindow | null = null;
const capture = new CaptureService(() => window, rendererUrl);
const processAudio = new ProcessAudioService();

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

function configureSession(): void {
  const nonce = process.env.VOICE_SHARE_CSP_NONCE;
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
      if (url.hostname !== 'voice-share' || request.method !== 'GET')
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
  window = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: '#0d0f14',
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
  window.on('closed', () => {
    capture.cancel();
    processAudio.stop();
    window = null;
  });
  await window.loadURL(rendererUrl);
  if (!smoke) window.show();
  console.info('[App] Window ready');
  if (smoke) {
    // Fixed local diagnostic only; no user-supplied script is evaluated.
    const passed: unknown = await window.webContents.executeJavaScript(`
      (async () => {
        const info = await window.voiceShare.getAppInfo();
        const saved = await window.voiceShare.command({ type: 'SAVE_IDENTITY', displayName: 'Teste local' });
        if (saved.status !== 'OK') throw new Error(saved.message);
        const created = await window.voiceShare.command({ type: 'CREATE_ROOM', name: 'Sala de teste', address: '127.0.0.1' });
        if (created.status !== 'OK') throw new Error(created.message);
        await new Promise(resolve => setTimeout(resolve, 300));
        const probe = document.createElement('script');
        probe.textContent = 'window.__cspProbe = true';
        document.head.append(probe);
        probe.remove();
        return info.name === 'Poglive' && typeof window.require === 'undefined'
          && typeof window.process === 'undefined'
          && window.__cspProbe !== true
          && getComputedStyle(document.body).margin === '0px'
          && document.querySelector('h1')?.textContent === 'Sua tela. Sua companhia.'
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const artifactDirectory = resolve(app.getAppPath(), '.artifacts');
    await mkdir(artifactDirectory, { recursive: true });
    const screenshot = await window.webContents.capturePage();
    await writeFile(
      resolve(artifactDirectory, 'milestone-2.png'),
      screenshot.toPNG(),
    );
    console.info(
      '[App] Smoke passed: renderer, styles, preload, IPC, Node isolation, CSP, TLS room join',
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
  }, 15000).unref();

app
  .whenReady()
  .then(async () => {
    configureSession();
    capture.install();
    configureProtocol();
    await identities.load();
    registerIpc(() => window, rendererUrl, rooms, capture, processAudio);
    await createWindow();
  })
  .catch((error: unknown) => {
    console.error(
      '[App] Startup failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    app.exit(1);
  });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  processAudio.stop();
  void rooms.close();
});
