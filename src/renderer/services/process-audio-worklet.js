/* global AudioWorkletProcessor, registerProcessor */
class ProcessAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.samples = 0;
    this.port.onmessage = ({ data }) => {
      if (!(data instanceof Float32Array)) return;
      this.queue.push(data);
      this.samples += data.length;
      while (this.samples > 192000 && this.queue.length > 1) {
        const removed = this.queue.shift();
        this.samples -= removed?.length ?? 0;
        this.offset = 0;
      }
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output) return true;
    for (let frame = 0; frame < output[0].length; frame++) {
      for (let channel = 0; channel < output.length; channel++) {
        const current = this.queue[0];
        output[channel][frame] = current?.[this.offset + channel] ?? 0;
      }
      this.offset += 2;
      const current = this.queue[0];
      if (current && this.offset >= current.length) {
        this.queue.shift();
        this.samples -= current.length;
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-share-process-audio', ProcessAudioProcessor);
