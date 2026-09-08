type StreamSound = 'start' | 'stop';

let context: AudioContext | null = null;

export async function playStreamSound(sound: StreamSound): Promise<void> {
  context ??= new AudioContext();
  if (context.state === 'suspended') await context.resume();

  const frequencies = sound === 'start' ? [392, 523.25] : [523.25, 349.23];
  const startAt = context.currentTime;
  for (const [index, frequency] of frequencies.entries()) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const noteStart = startAt + index * 0.085;
    const noteEnd = noteStart + 0.12;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(0.09, noteStart + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd);
  }
}
