import { z } from 'zod';
import type { LocalState, RoomCommand, CommandResult } from './schemas/room';
import type { CaptureSourcesResult, CaptureOptions } from './schemas/capture';
import type { Signal, SignalBatch } from './protocols/signaling';

export const IPC = {
  getAppInfo: 'app:get-info',
  getState: 'room:get-state',
  command: 'room:command',
  captureSources: 'capture:sources',
  captureSelect: 'capture:select',
  captureCancel: 'capture:cancel',
  processAudioStart: 'capture:process-audio-start',
  processAudioStop: 'capture:process-audio-stop',
  processAudioData: 'capture:process-audio-data',
  processAudioEnded: 'capture:process-audio-ended',
  signalSend: 'signal:send',
  signalPoll: 'signal:poll',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
} as const;
export const appInfoSchema = z
  .object({
    name: z.literal('Poglive'),
    version: z.string().min(1).max(40),
    platform: z.string().min(1).max(20),
    arch: z.string().min(1).max(20),
  })
  .strict();
export type AppInfo = z.infer<typeof appInfoSchema>;
export interface DesktopBridge {
  getAppInfo: () => Promise<AppInfo>;
  getState: () => Promise<LocalState>;
  command: (command: RoomCommand) => Promise<CommandResult>;
  captureSources: () => Promise<CaptureSourcesResult>;
  captureSelect: (
    id: string,
    options: CaptureOptions,
  ) => Promise<CommandResult>;
  captureCancel: () => Promise<void>;
  processAudioStart: (sourceId: string) => Promise<CommandResult>;
  processAudioStop: () => Promise<void>;
  onProcessAudioData: (listener: (data: Uint8Array) => void) => () => void;
  onProcessAudioEnded: (listener: (reason: string) => void) => () => void;
  sendSignal: (signal: Signal) => Promise<CommandResult>;
  pollSignals: (roomId: string) => Promise<SignalBatch>;
  windowMinimize: () => Promise<void>;
  windowToggleMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
}

export type StreamState =
  | { status: 'IDLE' }
  | { status: 'SELECTING_SOURCE' }
  | { status: 'STREAMING'; streamId: string }
  | { status: 'WATCHING'; streamId: string; peerId: string }
  | { status: 'ERROR'; message: string };

export type PeerState =
  | { status: 'DISCOVERING' }
  | { status: 'CONNECTED'; peerId: string; displayName: string }
  | { status: 'DISCONNECTED'; reason: 'NOT_STARTED' | 'TIMEOUT' | 'LEFT' };
