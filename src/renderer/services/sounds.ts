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
  wave?: OscillatorType;
}

interface Static {
  at: number;
  duration: number;
  gain: number;
}

interface Cue {
  notes: Note[];
  /** Band-passed noise burst: the radio squelch of Poglive's identity. */
  static?: Static;
}

// Short synthesized cues with a two-way-radio character: squelch on joining
// and leaving the voice channel, "roger beeps" for mute. No audio files.
const CUES: Record<SoundCue, Cue> = {
  voiceJoin: {
    static: { at: 0, duration: 0.08, gain: 0.05 },
    notes: [
      { frequency: 659.25, at: 0.07, duration: 0.07, wave: 'triangle' },
      { frequency: 987.77, at: 0.13, duration: 0.12, wave: 'triangle' },
    ],
  },
  voiceLeave: {
    notes: [
      { frequency: 987.77, at: 0, duration: 0.07, wave: 'triangle' },
      { frequency: 587.33, at: 0.06, duration: 0.11, wave: 'triangle' },
    ],
    static: { at: 0.15, duration: 0.09, gain: 0.05 },
  },
  peerJoin: {
    static: { at: 0, duration: 0.04, gain: 0.025 },
    notes: [
      { frequency: 783.99, at: 0.04, duration: 0.06, gain: 0.05 },
      { frequency: 1046.5, at: 0.09, duration: 0.09, gain: 0.05 },
    ],
  },
  peerLeave: {
    notes: [
      { frequency: 1046.5, at: 0, duration: 0.06, gain: 0.05 },
      { frequency: 698.46, at: 0.05, duration: 0.09, gain: 0.05 },
    ],
    static: { at: 0.13, duration: 0.04, gain: 0.025 },
  },
  mute: {
    notes: [
      { frequency: 440, at: 0, duration: 0.07, wave: 'square', gain: 0.025 },
    ],
  },
  unmute: {
    notes: [
      { frequency: 880, at: 0, duration: 0.06, wave: 'square', gain: 0.025 },
    ],
  },
  deafen: {
    notes: [
      { frequency: 523.25, at: 0, duration: 0.06, wave: 'square', gain: 0.022 },
      {
        frequency: 349.23,
        at: 0.07,
        duration: 0.08,
        wave: 'square',
        gain: 0.022,
      },
    ],
  },
  undeafen: {
    notes: [
      { frequency: 349.23, at: 0, duration: 0.06, wave: 'square', gain: 0.022 },
      {
        frequency: 523.25,
        at: 0.07,
        duration: 0.08,
        wave: 'square',
        gain: 0.022,
      },
    ],
  },
  streamStart: {
    notes: [
      { frequency: 523.25, at: 0, duration: 0.09 },
      { frequency: 659.25, at: 0.08, duration: 0.09 },
      { frequency: 1046.5, at: 0.16, duration: 0.16 },
    ],
  },
  streamStop: {
    notes: [
      { frequency: 1046.5, at: 0, duration: 0.09 },
      { frequency: 659.25, at: 0.08, duration: 0.09 },
      { frequency: 392, at: 0.16, duration: 0.16 },
    ],
  },
  message: {
    notes: [
      { frequency: 1318.51, at: 0, duration: 0.05, gain: 0.045 },
      { frequency: 1760, at: 0.05, duration: 0.09, gain: 0.04 },
    ],
  },
};

type SinkContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

let context: SinkContext | null = null;
let noise: AudioBuffer | null = null;
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

function noiseBuffer(audio: AudioContext): AudioBuffer {
  if (noise) return noise;
  const buffer = audio.createBuffer(
    1,
    Math.ceil(audio.sampleRate * 0.2),
    audio.sampleRate,
  );
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index++)
    data[index] = Math.random() * 2 - 1;
  noise = buffer;
  return buffer;
}

function playStatic(audio: AudioContext, start: number, cue: Static): void {
  const source = audio.createBufferSource();
  source.buffer = noiseBuffer(audio);
  // Narrow band around a radio-ish frequency, so it reads as squelch, not hiss.
  const band = audio.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2400;
  band.Q.value = 1.4;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(cue.gain, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + cue.duration);
  source.connect(band).connect(gain).connect(audio.destination);
  source.start(start);
  source.stop(start + cue.duration + 0.01);
}

export async function playSound(cue: SoundCue): Promise<void> {
  if (!enabled) return;
  if (!context) {
    context = new AudioContext() as SinkContext;
    if (sinkId) await context.setSinkId?.(sinkId).catch(() => {});
  }
  if (context.state === 'suspended') await context.resume();
  const startAt = context.currentTime + 0.01;
  const definition = CUES[cue];
  if (definition.static)
    playStatic(context, startAt + definition.static.at, definition.static);
  for (const note of definition.notes) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const noteStart = startAt + note.at;
    const noteEnd = noteStart + note.duration;
    oscillator.type = note.wave ?? 'sine';
    oscillator.frequency.setValueAtTime(note.frequency, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(note.gain ?? 0.07, noteStart + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd + 0.01);
  }
}
