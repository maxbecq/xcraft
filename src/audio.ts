// Sound effects, synthesised with WebAudio, except the interface sounds: those are files with their reverb baked
// in (tools/sfx/bake.mjs), the game adds no effect on top. Music is handled separately.

export type Sfx =
  | 'ranged' | 'melee' | 'heal' | 'death' | 'error' | 'done' | 'alert' | 'click' | 'menu' | 'order' | 'target'
  | 'ray' | 'plasma' | 'stimulant' | 'charge' | 'peauderoc' | 'observation' | 'rappel' | 'arrive'
  /** Units answering, without words: `ack` when selected, `go` when given an order, one voice per faction. */
  | 'ackhumains' | 'gohumains' | 'ackz' | 'goz' | 'ackisdaris' | 'goisdaris';

const MAX_PER_FRAME = 4;

/** Interface sounds played from public/sfx/ (fetched at once, decoded once sound is unlocked). */
const BAKED: readonly Sfx[] = ['click', 'menu', 'order', 'target'];

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private played = 0;
  private noise!: AudioBuffer;
  private readonly files = new Map(BAKED.map((n) => [n, fetch(`${import.meta.env.BASE_URL}sfx/${n}.mp3`).then((r) => r.arrayBuffer()).catch(() => null)]));
  private readonly baked = new Map<Sfx, AudioBuffer>();

  /** Must be called from a user gesture (browsers keep audio locked until then). */
  start(): void {
    // iOS only unlocks audio at the end of a touch: a context made earlier stays suspended until then.
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate / 4, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    for (const [name, file] of this.files) {
      file.then((b) => b && this.ctx!.decodeAudioData(b)).then((buf) => buf && this.baked.set(name, buf)).catch(() => {});
    }
  }

  /** Call once per frame to reset the per-frame sound budget. */
  frame(): void {
    this.played = 0;
  }

  play(sfx: Sfx, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || this.played++ >= MAX_PER_FRAME) return;
    const file = this.baked.get(sfx);
    if (file) {
      const src = ctx.createBufferSource();
      src.buffer = file;
      const g = ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(this.master);
      src.start();
      return;
    }
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
    /** A short tone with its own envelope, `delay` seconds in: the syllables of the units' answers. */
    const blip = (type: OscillatorType, f0: number, f1: number, peak: number, dur: number, delay = 0) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(peak * volume, t + delay + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      g.connect(this.master);
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t + delay);
      o.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
      o.connect(g);
      o.start(t + delay);
      o.stop(t + delay + dur + 0.02);
    };
    switch (sfx) {
      case 'ackhumains': // armour shifting, a low brass note: "ready"
        burst('bandpass', 2400, 0.06, 0.05);
        blip('sawtooth', 220, 220, 0.05, 0.16, 0.02);
        blip('sine', 330, 330, 0.07, 0.18, 0.02);
        break;
      case 'gohumains': // a clank and two firm notes going up: "on it"
        burst('bandpass', 2000, 0.07, 0.05);
        blip('sawtooth', 247, 247, 0.05, 0.09, 0.01);
        blip('sawtooth', 330, 330, 0.05, 0.12, 0.1);
        break;
      case 'ackz': // a machine waking: a square chirp and a bleep
        blip('square', 700, 1100, 0.035, 0.06);
        blip('square', 1650, 1650, 0.03, 0.05, 0.08);
        break;
      case 'goz': // relays clicking, a falling double bleep: "executing"
        burst('highpass', 5000, 0.05, 0.02);
        blip('square', 1300, 1300, 0.03, 0.04, 0.02);
        blip('square', 900, 900, 0.03, 0.05, 0.08);
        break;
      case 'ackisdaris': // a soft bell with its fifth
        blip('sine', 784, 784, 0.07, 0.45);
        blip('sine', 1175, 1175, 0.035, 0.4, 0.01);
        break;
      case 'goisdaris': // two bells rising a fifth, a shimmer
        blip('sine', 659, 659, 0.06, 0.28);
        blip('sine', 988, 988, 0.06, 0.35, 0.08);
        blip('triangle', 1976, 1976, 0.015, 0.3, 0.08);
        break;
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
