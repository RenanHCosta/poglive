import { app, clipboard, ipcMain, shell } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  appInfoSchema,
  clipFileNameSchema,
  clipLabelSchema,
  IPC,
} from '../shared/contracts';
import type { ClipResult } from '../shared/contracts';
import type { ClipStore } from './clips';
import { MAX_CLIP_BYTES } from './clips';
import { commandSchema, localStateSchema } from '../shared/schemas/room';
import { chatHistorySchema } from '../shared/schemas/chat';
import type { CommandResult } from '../shared/schemas/room';
import type { RoomService } from './room/service';
import type { CaptureService } from './capture/service';
import type { ProcessAudioService } from './capture/process-audio';
import type { UpdateService } from './update/service';
import type { SettingsStore } from './settings/store';
import type { ShortcutService } from './settings/shortcuts';
import { externalUrlSchema, settingsSchema } from '../shared/schemas/settings';
import type { SettingsResult } from '../shared/schemas/settings';
import {
  captureSourcesResultSchema,
  captureSelectionSchema,
  processAudioTargetSchema,
} from '../shared/schemas/capture';

const noArguments = z.tuple([]);
import { signalSchema, signalBatchSchema } from '../shared/protocols/signaling';
export function registerIpc(
  getWindow: () => BrowserWindow | null,
  rendererUrl: string,
  rooms: RoomService,
  capture: CaptureService,
  processAudio: ProcessAudioService,
  updates: UpdateService,
  settings: SettingsStore,
  shortcuts: ShortcutService,
  clips: ClipStore,
): void {
  let unavailableShortcuts = shortcuts.apply(settings.get().shortcuts);
  function authorize(event: IpcMainInvokeEvent): void {
    const window = getWindow();
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url.split('#')[0] !== rendererUrl
    )
      throw new Error('IPC origin rejected');
  }
  ipcMain.handle(IPC.windowMinimize, (event, ...args: unknown[]) => {
    authorize(event);
    noArguments.parse(args);
    getWindow()?.minimize();
  });
  ipcMain.handle(IPC.windowToggleMaximize, (event, ...args: unknown[]) => {
    authorize(event);
    noArguments.parse(args);
    const current = getWindow();
    if (!current) return false;
    if (current.isMaximized()) current.unmaximize();
    else current.maximize();
    return current.isMaximized();
  });
  ipcMain.handle(IPC.windowClose, (event, ...args: unknown[]) => {
    authorize(event);
    noArguments.parse(args);
    getWindow()?.close();
  });
  ipcMain.handle(IPC.updateGetState, (event, ...args: unknown[]) => {
    authorize(event);
    noArguments.parse(args);
    return updates.snapshot();
  });
  ipcMain.handle(IPC.updateCheck, async (event, ...args: unknown[]) => {
    authorize(event);
    noArguments.parse(args);
    return await updates.check();
  });
  ipcMain.handle(IPC.updateInstall, (event, ...args: unknown[]) => {
    authorize(event);
    noArguments.parse(args);
    return updates.install();
  });
  ipcMain.handle(IPC.signalSend, (event, ...args: unknown[]): CommandResult => {
    authorize(event);
    const parsed = z.tuple([signalSchema]).safeParse(args);
    if (!parsed.success)
      return { status: 'ERROR', message: 'Mensagem de conexão inválida.' };
    try {
      rooms.sendSignal(parsed.data[0]);
      return { status: 'OK' };
    } catch {
      return {
        status: 'ERROR',
        message: 'Não foi possível encaminhar a conexão.',
      };
    }
  });
  ipcMain.handle(IPC.signalPoll, (event, ...args: unknown[]) => {
    authorize(event);
    const [roomId] = z.tuple([z.uuid()]).parse(args);
    return signalBatchSchema.parse(rooms.pollSignals(roomId));
  });
  ipcMain.handle(IPC.captureSources, async (event, ...args: unknown[]) => {
    authorize(event);
    noArguments.parse(args);
    return captureSourcesResultSchema.parse(await capture.list());
  });
  ipcMain.handle(
    IPC.captureSelect,
    (event, ...args: unknown[]): CommandResult => {
      authorize(event);
      const parsed = z.tuple([captureSelectionSchema]).safeParse(args);
      if (!parsed.success)
        return { status: 'ERROR', message: 'Fonte inválida.' };
      try {
        // Audio never comes from Chromium's loopback: it would include Poglive itself.
        capture.select(parsed.data[0].id);
        return { status: 'OK' };
      } catch {
        return {
          status: 'ERROR',
          message: 'Fonte indisponível. Atualize a lista.',
        };
      }
    },
  );
  ipcMain.handle(IPC.captureCancel, (event, ...args: unknown[]) => {
    authorize(event);
    noArguments.parse(args);
    capture.cancel();
  });
  ipcMain.handle(
    IPC.processAudioStart,
    (event, ...args: unknown[]): CommandResult => {
      authorize(event);
      const parsed = z.tuple([processAudioTargetSchema]).safeParse(args);
      if (!parsed.success)
        return { status: 'ERROR', message: 'Modo de áudio inválido.' };
      try {
        const target = parsed.data[0];
        processAudio.start(
          target.mode === 'WINDOW'
            ? {
                mode: 'INCLUDE_WINDOW',
                windowHandle: capture.windowHandle(target.sourceId),
              }
            : // Poglive's own tree (voice, players) and Discord never
              // leak into a share, so nobody hears a call twice.
              {
                mode: 'SYSTEM_EXCEPT',
                processId: process.pid,
                excludeDiscord: true,
              },
          event.sender,
        );
        return { status: 'OK' };
      } catch {
        return {
          status: 'ERROR',
          message: 'Este modo de áudio não está disponível neste Windows.',
        };
      }
    },
  );
  ipcMain.handle(IPC.processAudioStop, (event, ...args: unknown[]) => {
    authorize(event);
    noArguments.parse(args);
    processAudio.stop();
  });
  ipcMain.handle(IPC.getAppInfo, (event, ...args: unknown[]) => {
    authorize(event);
    noArguments.parse(args);
    return appInfoSchema.parse({
      name: 'Poglive',
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    });
  });
  ipcMain.handle(IPC.settingsGet, (event, ...args: unknown[]) => {
    authorize(event);
    noArguments.parse(args);
    return {
      status: 'OK',
      settings: settings.get(),
      unavailableShortcuts,
    } satisfies SettingsResult;
  });
  ipcMain.handle(
    IPC.settingsUpdate,
    async (event, ...args: unknown[]): Promise<SettingsResult> => {
      authorize(event);
      const parsed = z.tuple([settingsSchema]).safeParse(args);
      if (!parsed.success)
        return { status: 'ERROR', message: 'Configurações inválidas.' };
      const previous = settings.get().shortcuts;
      try {
        const saved = await settings.save(parsed.data[0]);
        if (JSON.stringify(previous) !== JSON.stringify(saved.shortcuts))
          unavailableShortcuts = shortcuts.apply(saved.shortcuts);
        return { status: 'OK', settings: saved, unavailableShortcuts };
      } catch {
        return {
          status: 'ERROR',
          message: 'Não foi possível salvar as configurações.',
        };
      }
    },
  );
  ipcMain.handle(
    IPC.openExternal,
    async (event, ...args: unknown[]): Promise<CommandResult> => {
      authorize(event);
      const parsed = z.tuple([externalUrlSchema]).safeParse(args);
      if (!parsed.success)
        return { status: 'ERROR', message: 'Link inválido.' };
      try {
        await shell.openExternal(new URL(parsed.data[0]).toString());
        return { status: 'OK' };
      } catch {
        return { status: 'ERROR', message: 'Não foi possível abrir o link.' };
      }
    },
  );
  ipcMain.handle(
    IPC.clipSave,
    async (event, ...args: unknown[]): Promise<ClipResult> => {
      authorize(event);
      const parsed = z
        .tuple([z.instanceof(Uint8Array), clipLabelSchema])
        .safeParse(args);
      if (!parsed.success || parsed.data[0].byteLength > MAX_CLIP_BYTES)
        return { status: 'ERROR', message: 'Clipe inválido.' };
      try {
        const fileName = await clips.save(parsed.data[0], parsed.data[1]);
        return { status: 'OK', fileName };
      } catch {
        return {
          status: 'ERROR',
          message: 'Não foi possível salvar o clipe na pasta Vídeos.',
        };
      }
    },
  );
  ipcMain.handle(IPC.clipReveal, (event, ...args: unknown[]): CommandResult => {
    authorize(event);
    const parsed = z.tuple([clipFileNameSchema]).safeParse(args);
    if (!parsed.success || !clips.reveal(parsed.data[0]))
      return { status: 'ERROR', message: 'Clipe não encontrado.' };
    return { status: 'OK' };
  });
  ipcMain.handle(
    IPC.clipOpenFolder,
    async (event, ...args: unknown[]): Promise<CommandResult> => {
      authorize(event);
      noArguments.parse(args);
      try {
        await clips.openFolder();
        return { status: 'OK' };
      } catch {
        return { status: 'ERROR', message: 'Não foi possível abrir a pasta.' };
      }
    },
  );
  ipcMain.handle(IPC.chatHistory, (event, ...args: unknown[]) => {
    authorize(event);
    noArguments.parse(args);
    return chatHistorySchema.parse(rooms.chatHistory());
  });
  ipcMain.handle(IPC.getState, (event, ...args: unknown[]) => {
    authorize(event);
    noArguments.parse(args);
    return localStateSchema.parse(rooms.snapshot());
  });
  ipcMain.handle(
    IPC.command,
    async (event, ...args: unknown[]): Promise<CommandResult> => {
      authorize(event);
      const parsed = z.tuple([commandSchema]).safeParse(args);
      if (!parsed.success)
        return {
          status: 'ERROR',
          message: 'Dados inválidos. Confira os campos.',
        };
      try {
        const [command] = parsed.data;
        if (command.type === 'COPY_INVITE') {
          const state = rooms.snapshot().room;
          if (state.status !== 'HOSTING')
            throw new Error('Crie uma sala para copiar o convite.');
          await clipboard.writeText(state.invite);
        } else if (command.type === 'UPDATE_VOICE')
          rooms.updateVoice(command.voice);
        else if (command.type === 'TYPING') rooms.sendTyping();
        else if (command.type === 'SEND_CHAT')
          rooms.sendChat(command.id, command.text);
        else await rooms.execute(command);
        return { status: 'OK' };
      } catch (error: unknown) {
        return {
          status: 'ERROR',
          message:
            error instanceof Error
              ? error.message.slice(0, 200)
              : 'Não foi possível concluir a operação.',
        };
      }
    },
  );
}
