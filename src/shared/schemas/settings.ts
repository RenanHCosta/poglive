import { z } from 'zod';
import { captureOptionsSchema } from './capture';

const deviceIdSchema = z.string().min(1).max(256);
const percentSchema = z.number().int().min(0).max(200);

// Electron accelerators restricted to a modifier combination (or F13–F24) so a
// global shortcut can never swallow ordinary typing in other applications.
const MODIFIER = '(?:CommandOrControl|Control|Ctrl|Alt|Shift|Super)';
const KEY =
  '(?:[A-Z0-9]|F(?:[1-9]|1\\d|2[0-4])|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|num[0-9])';
const acceleratorPattern = new RegExp(
  `^(?:(?:${MODIFIER}\\+){1,3}${KEY}|F(?:1[3-9]|2[0-4]))$`,
);
export const acceleratorSchema = z
  .string()
  .max(64)
  .regex(acceleratorPattern, 'Atalho inválido');

export const shortcutActionSchema = z.enum(['TOGGLE_MUTE', 'TOGGLE_DEAFEN']);
export type ShortcutAction = z.infer<typeof shortcutActionSchema>;

export const peerAudioSchema = z
  .object({ volume: percentSchema, muted: z.boolean() })
  .strict();
export type PeerAudio = z.infer<typeof peerAudioSchema>;

export const MAX_PEER_AUDIO_ENTRIES = 200;

export const settingsSchema = z
  .object({
    version: z.literal(1),
    audio: z
      .object({
        inputDeviceId: deviceIdSchema.nullable(),
        outputDeviceId: deviceIdSchema.nullable(),
        inputVolume: percentSchema,
        outputVolume: percentSchema,
        automaticSensitivity: z.boolean(),
        sensitivityDb: z.number().min(-100).max(0),
        noiseSuppression: z.boolean(),
        echoCancellation: z.boolean(),
        autoGainControl: z.boolean(),
      })
      .strict(),
    shortcuts: z
      .object({
        TOGGLE_MUTE: acceleratorSchema.nullable(),
        TOGGLE_DEAFEN: acceleratorSchema.nullable(),
      })
      .strict(),
    notifications: z.object({ sounds: z.boolean() }).strict(),
    stream: captureOptionsSchema,
    // Local-only preferences keyed by peer UUID, like per-user volume in voice apps.
    peers: z
      .record(z.uuid(), peerAudioSchema)
      .refine(
        (peers) => Object.keys(peers).length <= MAX_PEER_AUDIO_ENTRIES,
        'Muitas preferências de participantes',
      ),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  audio: {
    inputDeviceId: null,
    outputDeviceId: null,
    inputVolume: 100,
    outputVolume: 100,
    automaticSensitivity: true,
    sensitivityDb: -50,
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
  },
  shortcuts: {
    TOGGLE_MUTE: 'CommandOrControl+Shift+M',
    TOGGLE_DEAFEN: 'CommandOrControl+Shift+D',
  },
  notifications: { sounds: true },
  stream: {
    quality: '1080p',
    frameRate: 30,
    adaptiveQuality: true,
    audioMode: 'SYSTEM',
  },
  peers: {},
};

export const settingsResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('OK'),
      settings: settingsSchema,
      // Shortcuts already registered by another application.
      unavailableShortcuts: z.array(shortcutActionSchema).max(2),
    })
    .strict(),
  z
    .object({ status: z.literal('ERROR'), message: z.string().max(200) })
    .strict(),
]);
export type SettingsResult = z.infer<typeof settingsResultSchema>;

export const externalUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'https:' || url.protocol === 'http:') &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, 'Link inválido');
