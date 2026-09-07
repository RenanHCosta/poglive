/* global AudioWorkletProcessor, registerProcessor */
const CHANNELS = 2;
const PREBUFFER_SAMPLES = 48000 * 0.12 * CHANNELS;
const MAX_BUFFERED_SAMPLES = 48000 * CHANNELS;

class ProcessAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.bufferedSamples = 0;
    this.playing = false;
    this.port.onmessage = ({ data }) => {
      if (!(data instanceof Float32Array) || data.length % CHANNELS !== 0)
        return;
      this.queue.push(data);
      this.bufferedSamples += data.length;
      while (
        this.bufferedSamples > MAX_BUFFERED_SAMPLES &&
        this.queue.length > 1
      ) {
        const removed = this.queue.shift();
        this.bufferedSamples -= (removed?.length ?? 0) - this.offset;
        this.offset = 0;
      }
      if (this.bufferedSamples >= PREBUFFER_SAMPLES) this.playing = true;
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || !this.playing) return true;
    for (let frame = 0; frame < output[0].length; frame++) {
      const current = this.queue[0];
      if (!current) {
        // An IPC scheduling gap drained the queue. Rebuffer before resuming so
        // the following quanta do not alternate rapidly between sound/silence.
        this.playing = false;
        return true;
      }
      for (let channel = 0; channel < output.length; channel++) {
        output[channel][frame] = current?.[this.offset + channel] ?? 0;
      }
      this.offset += CHANNELS;
      this.bufferedSamples -= CHANNELS;
      if (current && this.offset >= current.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-share-process-audio', ProcessAudioProcessor);
