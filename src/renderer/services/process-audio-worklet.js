/* global AudioWorkletProcessor, registerProcessor */
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const frames = (milliseconds) =>
  Math.round((SAMPLE_RATE * milliseconds) / 1000);

const MIN_TARGET_FRAMES = frames(40);
const INITIAL_TARGET_FRAMES = frames(80);
const MAX_TARGET_FRAMES = frames(160);
const TARGET_DECREASE_FRAMES = frames(5);
const STABLE_WINDOW_FRAMES = frames(20000);
const CORRECTION_THRESHOLD_FRAMES = frames(8);
const MAX_BUFFERED_FRAMES = SAMPLE_RATE;
const CORRECTION_RATE = 0.005;

class ProcessAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(MAX_BUFFERED_FRAMES * CHANNELS);
    this.readFrame = 0;
    this.writeFrame = 0;
    this.bufferedFrames = 0;
    this.readFraction = 0;
    this.targetFrames = INITIAL_TARGET_FRAMES;
    this.stableFrames = 0;
    this.playing = false;
    this.port.onmessage = ({ data }) => {
      if (!(data instanceof Float32Array) || data.length % CHANNELS !== 0)
        return;
      for (
        let sourceFrame = 0;
        sourceFrame < data.length / CHANNELS;
        sourceFrame++
      ) {
        if (this.bufferedFrames === MAX_BUFFERED_FRAMES) {
          this.readFrame = (this.readFrame + 1) % MAX_BUFFERED_FRAMES;
          this.bufferedFrames--;
          this.readFraction = 0;
        }
        const destination = this.writeFrame * CHANNELS;
        const source = sourceFrame * CHANNELS;
        this.buffer[destination] = data[source] ?? 0;
        this.buffer[destination + 1] = data[source + 1] ?? 0;
        this.writeFrame = (this.writeFrame + 1) % MAX_BUFFERED_FRAMES;
        this.bufferedFrames++;
      }
      if (this.bufferedFrames >= this.targetFrames + 2) this.playing = true;
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || !this.playing) return true;

    const distanceFromTarget = this.bufferedFrames - this.targetFrames;
    const playbackRate =
      distanceFromTarget > CORRECTION_THRESHOLD_FRAMES
        ? 1 + CORRECTION_RATE
        : distanceFromTarget < -CORRECTION_THRESHOLD_FRAMES
          ? 1 - CORRECTION_RATE
          : 1;

    for (let outputFrame = 0; outputFrame < output[0].length; outputFrame++) {
      if (this.bufferedFrames < 2) {
        this.handleUnderrun();
        return true;
      }

      const nextFrame = (this.readFrame + 1) % MAX_BUFFERED_FRAMES;
      const currentOffset = this.readFrame * CHANNELS;
      const nextOffset = nextFrame * CHANNELS;
      for (let channel = 0; channel < output.length; channel++) {
        const sourceChannel = Math.min(channel, CHANNELS - 1);
        const current = this.buffer[currentOffset + sourceChannel] ?? 0;
        const next = this.buffer[nextOffset + sourceChannel] ?? current;
        output[channel][outputFrame] =
          current + (next - current) * this.readFraction;
      }

      this.readFraction += playbackRate;
      const consumedFrames = Math.floor(this.readFraction);
      this.readFraction -= consumedFrames;
      this.readFrame = (this.readFrame + consumedFrames) % MAX_BUFFERED_FRAMES;
      this.bufferedFrames -= consumedFrames;
      this.stableFrames++;
    }

    if (
      this.stableFrames >= STABLE_WINDOW_FRAMES &&
      this.targetFrames > MIN_TARGET_FRAMES
    ) {
      this.targetFrames = Math.max(
        MIN_TARGET_FRAMES,
        this.targetFrames - TARGET_DECREASE_FRAMES,
      );
      this.stableFrames = 0;
    }
    return true;
  }

  handleUnderrun() {
    this.playing = false;
    this.readFraction = 0;
    this.stableFrames = 0;
    this.targetFrames = Math.min(
      MAX_TARGET_FRAMES,
      Math.max(
        this.targetFrames + frames(20),
        Math.round(this.targetFrames * 1.5),
      ),
    );
  }
}

registerProcessor('poglive-process-audio', ProcessAudioProcessor);
