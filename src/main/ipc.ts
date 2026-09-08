import { app, clipboard, ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { appInfoSchema, IPC } from '../shared/contracts';
import { commandSchema, localStateSchema } from '../shared/schemas/room';
import type { CommandResult } from '../shared/schemas/room';
import type { RoomService } from './room/service';
import type { CaptureService } from './capture/service';
import type { ProcessAudioService } from './capture/process-audio';
import type { UpdateService } from './update/service';
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
): void {
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
        capture.select(
          parsed.data[0].id,
          parsed.data[0].options.audioMode === 'SYSTEM',
        );
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
            ? capture.windowHandle(target.sourceId)
            : null,
          target.mode === 'SYSTEM_EXCEPT_DISCORD',
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
        } else await rooms.execute(command);
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
