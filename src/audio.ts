// Sound effects, synthesised with WebAudio: no audio files. Music is handled separately.

export type Sfx =
  | 'ranged' | 'melee' | 'heal' | 'death' | 'error' | 'done' | 'alert' | 'click' | 'order' | 'target'
  | 'ray' | 'plasma' | 'stimulant' | 'charge' | 'peauderoc' | 'observation' | 'rappel' | 'arrive';

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
    /** A burst of filtered noise with its own envelope: the bones of every gunshot and impact. */
    const burst = (type: BiquadFilterType, freq: number, peak: number, decay: number, delay = 0) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(peak * volume, t + delay + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + decay);
      g.connect(this.master);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      src.connect(f).connect(g);
      src.start(t + delay);
      src.stop(t + delay + decay + 0.02);
    };
    /** A pitched thump (the body of a shot or a blow): a sine dropping fast. */
    const thump = (f0: number, f1: number, peak: number, decay: number) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(peak * volume, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      g.connect(this.master);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + decay);
      o.connect(g);
      o.start(t);
      o.stop(t + decay + 0.02);
    };
    switch (sfx) {
      case 'ranged': // a chemical rifle shot: a sharp crack, a low punch, a short rolling tail
        burst('highpass', 3000, 0.22, 0.05);
        thump(160, 55, 0.22, 0.09);
        burst('lowpass', 900, 0.1, 0.28, 0.01);
        break;
      case 'melee': // a blade biting: a dull impact with a gritty metallic scrape
        thump(110, 60, 0.2, 0.08);
        burst('bandpass', 3200, 0.07, 0.09, 0.01);
        osc('sawtooth', 180, 130, 0.07);
        env(0.04, 0.08);
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
      case 'click': // a soft, short tick: present but discreet
        env(0.035, 0.03);
        osc('sine', 2400, 1700, 0.02);
        burst('highpass', 6000, 0.012, 0.015);
        break;
      case 'order': // a right-click order: a short, low double tick, under the HUD click
        env(0.05, 0.05);
        osc('triangle', 900, 600, 0.04);
        burst('highpass', 3000, 0.01, 0.012);
        burst('highpass', 3600, 0.007, 0.012, 0.035);
        break;
      case 'target': // an attack order: a sharper, falling metallic tick
        env(0.07, 0.07);
        osc('square', 1400, 500, 0.05);
        burst('bandpass', 2500, 0.02, 0.02);
        break;
      case 'ray': // Isdaris light rifle: a bright falling chirp with a shimmer
        env(0.16, 0.18);
        osc('sine', 2400, 700, 0.16);
        osc('triangle', 3600, 1800, 0.08);
        break;
      case 'plasma': // Orbe plasma: a fat electric zap
        env(0.28, 0.3);
        osc('sawtooth', 120, 60, 0.25);
        noise(1800, 0.7, 0.2);
        osc('sine', 900, 200, 0.12);
        break;
      case 'stimulant': // injection hiss, then the heart races up
        env(0.2, 0.45);
        noise(6000, 2, 0.15);
        osc('square', 180, 420, 0.4);
        break;
      case 'charge': // war cry: a rough rising growl
        env(0.3, 0.5);
        osc('sawtooth', 90, 200, 0.45);
        noise(700, 1.2, 0.3);
        break;
      case 'peauderoc': // stone skin: a heavy metallic clank and a low ring
        env(0.25, 0.6);
        noise(3200, 6, 0.08);
        osc('triangle', 220, 210, 0.6);
        break;
      case 'observation': // the Forge's scan: a sonar ping
        env(0.22, 0.9);
        osc('sine', 1320, 1300, 0.9);
        setTimeout(() => this.ctx && this.tone(1320, 0.5, 'sine'), 380);
        break;
      case 'rappel': // Isdaris recall starting: a long rising shimmer
        env(0.2, 1.6);
        osc('sine', 220, 880, 1.5);
        osc('triangle', 330, 1320, 1.5);
        break;
      case 'arrive': // arrival: a bright whoosh and a chord
        env(0.25, 0.7);
        noise(5000, 0.8, 0.3);
        osc('sine', 880, 880, 0.6);
        setTimeout(() => this.ctx && this.tone(1320, 0.5, 'sine'), 60);
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
