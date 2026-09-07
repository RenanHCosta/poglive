import type { ProcessAudioTarget } from '../../shared/schemas/capture';

const workletUrl = new URL('./process-audio-worklet.js', import.meta.url).href;

let cleanup: (() => void) | null = null;

export async function startProcessAudio(
  target: ProcessAudioTarget,
): Promise<MediaStreamTrack> {
  await stopProcessAudio();
  const context = new AudioContext({
    sampleRate: 48000,
    latencyHint: 'interactive',
  });
  await context.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(context, 'poglive-process-audio', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  const destination = context.createMediaStreamDestination();
  node.connect(destination);
  let remainder = new Uint8Array();
  const unsubscribeData = window.pogLive.onProcessAudioData((incoming) => {
    const joined = new Uint8Array(remainder.length + incoming.length);
    joined.set(remainder);
    joined.set(incoming, remainder.length);
    const usable = joined.length - (joined.length % 4);
    remainder = joined.slice(usable);
    if (!usable) return;
    const view = new DataView(joined.buffer, joined.byteOffset, usable);
    const samples = new Float32Array(usable / 2);
    for (let offset = 0; offset < usable; offset += 2)
      samples[offset / 2] = view.getInt16(offset, true) / 32768;
    node.port.postMessage(samples, [samples.buffer]);
  });
  const unsubscribeEnded = window.pogLive.onProcessAudioEnded(() => {
    destination.stream.getAudioTracks().forEach((track) => track.stop());
    void context.close();
  });
  cleanup = () => {
    unsubscribeData();
    unsubscribeEnded();
    node.disconnect();
    destination.stream.getTracks().forEach((track) => track.stop());
    void context.close();
  };
  const result = await window.pogLive.processAudioStart(target);
  if (result.status === 'ERROR') {
    await stopProcessAudio();
    throw new Error(result.message);
  }
  const track = destination.stream.getAudioTracks()[0];
  if (!track) {
    await stopProcessAudio();
    throw new Error('Audio track unavailable');
  }
  return track;
}

export async function stopProcessAudio(): Promise<void> {
  cleanup?.();
  cleanup = null;
  await window.pogLive.processAudioStop().catch(() => {});
}
