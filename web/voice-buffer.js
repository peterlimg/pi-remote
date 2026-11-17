class VoiceBuffer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(sampleRate * 30);
    this.read = 0;
    this.write = 0;
    this.size = 0;
    this.recording = true;
    this.playing = false;
    this.drained = false;
    this.port.onmessage = ({ data }) => {
      if (data === 'play') this.playing = true;
      if (data === 'stop') this.recording = false;
      if (data === 'dispose') { this.samples.fill(0); this.disposed = true; this.port.close(); }
    };
  }
  process(inputs, outputs) {
    if (this.disposed) return false;
    const input = inputs[0]?.[0], output = outputs[0][0];
    if (this.recording && input) {
      if (this.size + input.length > this.samples.length) {
        this.port.postMessage('overflow');
        return false;
      }
      for (const sample of input) {
        this.samples[this.write] = sample;
        this.write = (this.write + 1) % this.samples.length;
      }
      this.size += input.length;
    }
    if (this.playing) {
      for (let i = 0; i < output.length && this.size; i++) {
        output[i] = this.samples[this.read];
        this.samples[this.read] = 0;
        this.read = (this.read + 1) % this.samples.length;
        this.size--;
      }
    }
    if (!this.recording && this.playing && !this.size && !this.drained) {
      this.drained = true;
      this.port.postMessage('drained');
    }
    return true;
  }
}
registerProcessor('voice-buffer', VoiceBuffer);
