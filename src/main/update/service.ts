import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { CommandResult } from '../../shared/schemas/room';
import { IPC } from '../../shared/contracts';
import { updateStateSchema } from '../../shared/schemas/update';
import type { UpdateState } from '../../shared/schemas/update';

const INITIAL_CHECK_DELAY_MS = 5000;
const PERIODIC_CHECK_MS = 6 * 60 * 60 * 1000;

export class UpdateService {
  private state: UpdateState;
  private started = false;
  private version: string | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | undefined;
  private periodicTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly canRestart: () => boolean,
  ) {
    this.state = !app.isPackaged
      ? { status: 'DISABLED', reason: 'DEVELOPMENT' }
      : process.platform !== 'win32'
        ? { status: 'DISABLED', reason: 'PLATFORM' }
        : process.env.PORTABLE_EXECUTABLE_FILE
          ? { status: 'DISABLED', reason: 'PORTABLE' }
          : { status: 'IDLE' };
  }

  snapshot(): UpdateState {
    return this.state;
  }

  start(): void {
    if (this.started || this.state.status === 'DISABLED') return;
    this.started = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.logger = console;
    autoUpdater.on('checking-for-update', () =>
      this.publish({ status: 'CHECKING' }),
    );
    autoUpdater.on('update-not-available', () =>
      this.publish({ status: 'CURRENT' }),
    );
    autoUpdater.on('update-available', (info) => {
      this.version = info.version;
      this.publish({ status: 'AVAILABLE', version: info.version });
    });
    autoUpdater.on('download-progress', (progress) => {
      if (!this.version) return;
      this.publish({
        status: 'DOWNLOADING',
        version: this.version,
        percent: Math.max(0, Math.min(100, progress.percent)),
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.version = info.version;
      this.publish({ status: 'READY', version: info.version });
    });
    autoUpdater.on('error', (error) => {
      console.error('[Update] Failed:', error.message);
      this.publish({
        status: 'ERROR',
        message: 'Não foi possível verificar ou baixar a atualização.',
      });
    });
    this.initialTimer = setTimeout(() => {
      void this.check();
    }, INITIAL_CHECK_DELAY_MS);
    this.periodicTimer = setInterval(() => {
      if (this.state.status !== 'READY') void this.check();
    }, PERIODIC_CHECK_MS);
    this.periodicTimer.unref();
  }

  async check(): Promise<CommandResult> {
    if (this.state.status === 'DISABLED')
      return {
        status: 'ERROR',
        message:
          this.state.reason === 'PORTABLE'
            ? 'O atualizador automático requer a versão instalada do Poglive.'
            : 'Atualizações automáticas não estão disponíveis neste ambiente.',
      };
    if (
      this.state.status === 'CHECKING' ||
      this.state.status === 'AVAILABLE' ||
      this.state.status === 'DOWNLOADING'
    )
      return { status: 'OK' };
    if (this.state.status === 'READY') return { status: 'OK' };
    if (!this.started) this.start();
    try {
      await autoUpdater.checkForUpdates();
      return { status: 'OK' };
    } catch (error: unknown) {
      console.error(
        '[Update] Check failed:',
        error instanceof Error ? error.message : 'Unknown error',
      );
      const message = 'Não foi possível consultar as atualizações agora.';
      this.publish({
        status: 'ERROR',
        message,
      });
      return { status: 'ERROR', message };
    }
  }

  install(): CommandResult {
    if (this.state.status !== 'READY')
      return {
        status: 'ERROR',
        message: 'Nenhuma atualização está pronta.',
      };
    if (!this.canRestart())
      return {
        status: 'ERROR',
        message: 'Saia da sala antes de reiniciar e atualizar o Poglive.',
      };
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return { status: 'OK' };
  }

  close(): void {
    clearTimeout(this.initialTimer);
    clearInterval(this.periodicTimer);
  }

  private publish(state: UpdateState): void {
    this.state = updateStateSchema.parse(state);
    const window = this.getWindow();
    if (window && !window.isDestroyed())
      window.webContents.send(IPC.updateState, this.state);
  }
}
