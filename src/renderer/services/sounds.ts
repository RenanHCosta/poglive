export type SoundCue =
  | 'voiceJoin'
  | 'voiceLeave'
  | 'peerJoin'
  | 'peerLeave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'streamStart'
  | 'streamStop'
  | 'message';

interface Note {
  frequency: number;
  at: number;
  duration: number;
  gain?: number;
}

// Short synthesized cues: no bundled audio files, no network.
const CUES: Record<SoundCue, Note[]> = {
  voiceJoin: [
    { frequency: 523.25, at: 0, duration: 0.09 },
    { frequency: 783.99, at: 0.08, duration: 0.14 },
  ],
  voiceLeave: [
    { frequency: 659.25, at: 0, duration: 0.09 },
    { frequency: 392, at: 0.08, duration: 0.14 },
  ],
  peerJoin: [
    { frequency: 587.33, at: 0, duration: 0.07, gain: 0.06 },
    { frequency: 880, at: 0.06, duration: 0.1, gain: 0.06 },
  ],
  peerLeave: [
    { frequency: 698.46, at: 0, duration: 0.07, gain: 0.06 },
    { frequency: 440, at: 0.06, duration: 0.1, gain: 0.06 },
  ],
  mute: [{ frequency: 349.23, at: 0, duration: 0.08 }],
  unmute: [{ frequency: 523.25, at: 0, duration: 0.08 }],
  deafen: [
    { frequency: 392, at: 0, duration: 0.07 },
    { frequency: 293.66, at: 0.06, duration: 0.1 },
  ],
  undeafen: [
    { frequency: 392, at: 0, duration: 0.07 },
    { frequency: 587.33, at: 0.06, duration: 0.1 },
  ],
  streamStart: [
    { frequency: 392, at: 0, duration: 0.12 },
    { frequency: 523.25, at: 0.085, duration: 0.12 },
  ],
  streamStop: [
    { frequency: 523.25, at: 0, duration: 0.12 },
    { frequency: 349.23, at: 0.085, duration: 0.12 },
  ],
  message: [
    { frequency: 880, at: 0, duration: 0.06, gain: 0.05 },
    { frequency: 1174.66, at: 0.05, duration: 0.09, gain: 0.05 },
  ],
};

type SinkContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

let context: SinkContext | null = null;
let enabled = true;
let sinkId = '';

export function configureSounds(options: {
  enabled: boolean;
  deviceId: string | null;
}): void {
  enabled = options.enabled;
  const next = options.deviceId ?? '';
  if (next !== sinkId) {
    sinkId = next;
    void context?.setSinkId?.(next).catch(() => {});
  }
}

export async function playSound(cue: SoundCue): Promise<void> {
  if (!enabled) return;
  if (!context) {
    context = new AudioContext() as SinkContext;
    if (sinkId) await context.setSinkId?.(sinkId).catch(() => {});
  }
  if (context.state === 'suspended') await context.resume();
  const startAt = context.currentTime + 0.01;
  for (const note of CUES[cue]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const noteStart = startAt + note.at;
    const noteEnd = noteStart + note.duration;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(note.frequency, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(
      note.gain ?? 0.08,
      noteStart + 0.012,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd);
  }
}
