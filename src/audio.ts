// Sound effects, synthesised with WebAudio: no audio files. Music is handled separately.

export type Sfx = 'ranged' | 'melee' | 'heal' | 'death' | 'error' | 'done' | 'alert' | 'click';

const MAX_PER_FRAME = 4;

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private played = 0;
  private noise!: AudioBuffer;

  /** Must be called from a user gesture (browsers keep audio locked until then). */
  start(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate / 4, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Call once per frame to reset the per-frame sound budget. */
  frame(): void {
    this.played = 0;
  }

  play(sfx: Sfx, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || this.played++ >= MAX_PER_FRAME) return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.connect(this.master);
    const env = (peak: number, decay: number) => {
      out.gain.setValueAtTime(peak * volume, t);
      out.gain.exponentialRampToValueAtTime(0.001, t + decay);
    };
    const osc = (type: OscillatorType, f0: number, f1: number, dur: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      o.connect(out);
      o.start(t);
      o.stop(t + dur);
    };
    const noise = (freq: number, q: number, dur: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      src.connect(f).connect(out);
      src.start(t);
      src.stop(t + dur);
    };
    switch (sfx) {
      case 'ranged': // alchemical rifle: a hissing crack
        env(0.25, 0.12);
        noise(2600, 1.5, 0.12);
        osc('square', 900, 300, 0.05);
        break;
      case 'melee': // saw bite
        env(0.18, 0.1);
        osc('sawtooth', 220, 140, 0.1);
        noise(4000, 3, 0.06);
        break;
      case 'heal':
        env(0.08, 0.3);
        osc('sine', 660, 990, 0.3);
        break;
      case 'death':
        env(0.35, 0.4);
        osc('sine', 140, 40, 0.4);
        noise(500, 0.8, 0.25);
        break;
      case 'error':
        env(0.2, 0.25);
        osc('square', 160, 120, 0.25);
        break;
      case 'done':
        env(0.2, 0.6);
        osc('triangle', 523, 523, 0.25);
        setTimeout(() => this.ctx && this.tone(784, 0.4), 120);
        break;
      case 'alert':
        env(0.3, 0.5);
        osc('sawtooth', 440, 330, 0.25);
        setTimeout(() => this.ctx && this.tone(330, 0.3, 'sawtooth'), 220);
        break;
      case 'click':
        env(0.1, 0.05);
        osc('square', 1200, 900, 0.03);
        break;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'triangle'): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(this.master);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g);
    o.start(t);
    o.stop(t + dur);
  }
}
