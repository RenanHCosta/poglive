import { app, Menu, nativeImage, Tray } from 'electron';
import type { BrowserWindow } from 'electron';
import { resolve } from 'node:path';
import type { ShortcutAction } from '../shared/schemas/settings';

/**
 * Closing the window during a call keeps Poglive running in the notification
 * area instead of dropping everyone, like desktop voice apps do.
 */
export class TrayService {
  private tray: Tray | null = null;
  private explained = false;
  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly trigger: (action: ShortcutAction) => void,
    private readonly quit: () => void,
  ) {}

  hideToTray(): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    window.hide();
    this.ensureTray();
    if (!this.explained) {
      this.explained = true;
      this.tray?.displayBalloon({
        title: 'O Poglive continua na sala',
        content:
          'A chamada segue em segundo plano. Use o ícone na bandeja para voltar ou sair.',
        iconType: 'info',
      });
    }
  }

  show(): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  private ensureTray(): void {
    if (this.tray) return;
    const icon = nativeImage.createFromPath(
      app.isPackaged
        ? resolve(process.resourcesPath, 'tray.ico')
        : resolve(app.getAppPath(), 'build/icon.ico'),
    );
    this.tray = new Tray(icon);
    this.tray.setToolTip('Poglive');
    this.tray.on('click', () => this.show());
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir Poglive', click: () => this.show() },
        { type: 'separator' },
        {
          label: 'Silenciar ou ativar microfone',
          click: () => this.trigger('TOGGLE_MUTE'),
        },
        {
          label: 'Desativar ou ativar áudio',
          click: () => this.trigger('TOGGLE_DEAFEN'),
        },
        {
          label: 'Salvar clipe da transmissão',
          click: () => this.trigger('SAVE_CLIP'),
        },
        { type: 'separator' },
        { label: 'Sair da sala e fechar', click: () => this.quit() },
      ]),
    );
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
