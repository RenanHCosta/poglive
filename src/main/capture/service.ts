import { desktopCapturer, session } from 'electron';
import type { BrowserWindow, WebContents } from 'electron';
import type { CaptureSourcesResult } from '../../shared/schemas/capture';

export class CaptureService {
  private sources = new Set<string>();
  private pending: {
    id: string;
    expires: number;
    systemAudio: boolean;
  } | null = null;
  private generation = 0;
  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly rendererUrl: string,
  ) {}

  private trusted(contents: WebContents | null): boolean {
    const window = this.getWindow();
    return (
      !!window &&
      !window.isDestroyed() &&
      contents === window.webContents &&
      contents.getURL().split('#')[0] === this.rendererUrl
    );
  }
  install(): void {
    const legacyDisplayPermission =
      Number(process.versions.electron.split('.')[0]) < 45;
    // Electron <=44 reports desktop capture as media with an empty mediaTypes array.
    // Keep media checks denied so requests pass through the stricter handler below.
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission, _origin, details) =>
        this.trusted(contents) &&
        details.isMainFrame &&
        (permission === 'fullscreen' ||
          (permission === 'display-capture' &&
            !!this.pending &&
            this.pending.expires >= Date.now())),
    );
    session.defaultSession.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        const legacyDisplay =
          legacyDisplayPermission &&
          permission === 'media' &&
          'mediaTypes' in details &&
          Array.isArray(details.mediaTypes) &&
          details.mediaTypes.length === 0;
        const allowed =
          this.trusted(contents) &&
          details.isMainFrame &&
          details.requestingUrl.split('#')[0] === this.rendererUrl &&
          (permission === 'fullscreen' ||
            ((permission === 'display-capture' || legacyDisplay) &&
              !!this.pending &&
              this.pending.expires >= Date.now()));
        if (permission === 'media' || permission === 'display-capture') {
          console.info('[Capture] Permission request', {
            permission,
            legacyDisplay,
            allowed,
          });
        }
        callback(allowed);
      },
    );
    session.defaultSession.setDisplayMediaRequestHandler(
      (request, callback) => {
        const window = this.getWindow();
        const selected = this.pending;
        this.pending = null; // Consume authorization once, including failed attempts.
        const generation = this.generation;
        if (
          !window ||
          !this.trusted(window.webContents) ||
          request.frame !== window.webContents.mainFrame ||
          !request.userGesture ||
          !request.videoRequested ||
          !selected ||
          request.audioRequested !== selected.systemAudio ||
          selected.expires < Date.now()
        ) {
          console.warn('[Capture] Request rejected', {
            trustedFrame:
              !!window &&
              this.trusted(window.webContents) &&
              request.frame === window.webContents.mainFrame,
            userGesture: request.userGesture,
            videoRequested: request.videoRequested,
            audioRequested: request.audioRequested,
            selectionValid: !!selected && selected.expires >= Date.now(),
          });
          callback({});
          return;
        }
        // Refresh to reject a source closed between selection and the media request.
        void desktopCapturer
          .getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 0, height: 0 },
          })
          .then((sources) => {
            const source = sources.find((item) => item.id === selected.id);
            if (
              generation !== this.generation ||
              !this.trusted(window.webContents) ||
              !source
            )
              callback({});
            else {
              callback({
                video: source,
                ...(selected.systemAudio ? { audio: 'loopback' } : {}),
              });
              console.info('[Capture] Source granted');
            }
          })
          .catch(() => callback({}));
      },
    );
  }
  async list(): Promise<CaptureSourcesResult> {
    this.cancel();
    const generation = this.generation;
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 240, height: 135 },
      });
      if (generation !== this.generation)
        return {
          status: 'ERROR',
          message: 'Seleção cancelada. Abra a lista novamente.',
        };
      const limited = sources.slice(0, 100);
      this.sources = new Set(limited.map((source) => source.id));
      return {
        status: 'OK',
        sources: limited.map((source) => ({
          id: source.id,
          name: source.name.slice(0, 512),
          kind: source.id.startsWith('screen:') ? 'screen' : 'window',
          thumbnail: source.thumbnail.toDataURL(),
        })),
      };
    } catch {
      return {
        status: 'ERROR',
        message:
          'Não foi possível listar as telas. Confira as permissões e tente novamente.',
      };
    }
  }
  select(id: string, systemAudio = false): void {
    if (systemAudio && process.platform !== 'win32')
      throw new Error('System audio requires Windows');
    if (!this.sources.has(id))
      throw new Error('Fonte indisponível. Atualize a lista.');
    this.generation++;
    this.pending = { id, expires: Date.now() + 10000, systemAudio };
  }
  windowHandle(id: string): string {
    if (!this.sources.has(id)) throw new Error('Fonte não autorizada.');
    const match = /^window:(\d+):\d+$/.exec(id);
    if (!match?.[1]) throw new Error('Selecione uma janela para este áudio.');
    return match[1];
  }
  cancel(): void {
    this.generation++;
    this.pending = null;
    this.sources.clear();
  }
}
