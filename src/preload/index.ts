import { contextBridge, ipcRenderer } from 'electron';
import { appInfoSchema, IPC } from '../shared/contracts';
import type { DesktopBridge } from '../shared/contracts';
import { z } from 'zod';
import { signalSchema, signalBatchSchema } from '../shared/protocols/signaling';
import {
  captureSourcesResultSchema,
  captureSelectionSchema,
  processAudioTargetSchema,
} from '../shared/schemas/capture';
import {
  commandSchema,
  commandResultSchema,
  localStateSchema,
} from '../shared/schemas/room';
import { updateStateSchema } from '../shared/schemas/update';

const bridge: DesktopBridge = {
  getUpdateState: async () => {
    const result: unknown = await ipcRenderer.invoke(IPC.updateGetState);
    return updateStateSchema.parse(result);
  },
  checkForUpdate: async () => {
    const result: unknown = await ipcRenderer.invoke(IPC.updateCheck);
    return commandResultSchema.parse(result);
  },
  installUpdate: async () => {
    const result: unknown = await ipcRenderer.invoke(IPC.updateInstall);
    return commandResultSchema.parse(result);
  },
  onUpdateState: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      const parsed = updateStateSchema.safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(IPC.updateState, handler);
    return () => ipcRenderer.removeListener(IPC.updateState, handler);
  },
  windowMinimize: async () => {
    await ipcRenderer.invoke(IPC.windowMinimize);
  },
  windowToggleMaximize: async () => {
    const result: unknown = await ipcRenderer.invoke(IPC.windowToggleMaximize);
    return z.boolean().parse(result);
  },
  windowClose: async () => {
    await ipcRenderer.invoke(IPC.windowClose);
  },
  sendSignal: async (signal) => {
    const result: unknown = await ipcRenderer.invoke(
      IPC.signalSend,
      signalSchema.parse(signal),
    );
    return commandResultSchema.parse(result);
  },
  pollSignals: async (roomId) => {
    const result: unknown = await ipcRenderer.invoke(
      IPC.signalPoll,
      z.uuid().parse(roomId),
    );
    return signalBatchSchema.parse(result);
  },
  captureSources: async () => {
    const result: unknown = await ipcRenderer.invoke(IPC.captureSources);
    return captureSourcesResultSchema.parse(result);
  },
  captureSelect: async (id, options) => {
    const result: unknown = await ipcRenderer.invoke(
      IPC.captureSelect,
      captureSelectionSchema.parse({ id, options }),
    );
    return commandResultSchema.parse(result);
  },
  captureCancel: async () => {
    await ipcRenderer.invoke(IPC.captureCancel);
  },
  processAudioStart: async (target) => {
    const result: unknown = await ipcRenderer.invoke(
      IPC.processAudioStart,
      processAudioTargetSchema.parse(target),
    );
    return commandResultSchema.parse(result);
  },
  processAudioStop: async () => {
    await ipcRenderer.invoke(IPC.processAudioStop);
  },
  onProcessAudioData: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      if (value instanceof Uint8Array && value.byteLength <= 262144)
        listener(new Uint8Array(value));
    };
    ipcRenderer.on(IPC.processAudioData, handler);
    return () => ipcRenderer.removeListener(IPC.processAudioData, handler);
  },
  onProcessAudioEnded: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      const parsed = z.string().max(200).safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(IPC.processAudioEnded, handler);
    return () => ipcRenderer.removeListener(IPC.processAudioEnded, handler);
  },
  getState: async () => {
    const result: unknown = await ipcRenderer.invoke(IPC.getState);
    return localStateSchema.parse(result);
  },
  command: async (command) => {
    const result: unknown = await ipcRenderer.invoke(
      IPC.command,
      commandSchema.parse(command),
    );
    return commandResultSchema.parse(result);
  },
  getAppInfo: async () => {
    const result: unknown = await ipcRenderer.invoke(IPC.getAppInfo);
    return appInfoSchema.parse(result);
  },
};
contextBridge.exposeInMainWorld('pogLive', Object.freeze(bridge));
