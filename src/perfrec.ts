import type { WebGLRenderer } from 'three';

const KEY = 'xcraft.perfrec';
/** A frame this far from the one before is a spike worth its context (ms). */
const SPIKE = 50;
/** Spikes kept with their details: the first ones, then only the worst. */
const MAX_SPIKES = 200;
/** Frame interval buckets (ms) for the histogram. */
const BUCKETS = [17, 25, 34, 50, 100, 250];

/** What the game says about the moment of a spike. */
export interface SpikeContext {
  tick: number;
  /** Simulation steps run this frame (more than one: it was catching up). */
  ticks: number;
  /** Units drawn on screen. */
  units: number;
  /** The camera moved since the frame before. */
  moving: boolean;
  /** What happened in the simulation steps of this frame (deaths, buildings done…), by kind. */
  events?: Record<string, number>;
}

/** What a frame knows of itself when it ends (the rest is worked out only for a spike). */
export type FrameFacts = Pick<SpikeContext, 'tick' | 'ticks' | 'events'>;

/** A frame's work, kept until the next frame shows whether it came late. */
interface FrameDone {
  facts: FrameFacts;
  start: number;
  work: number;
  steps: Record<string, number>;
  freed: number;
  programs: number;
  /** The new programs' materials (shader compiles hold a frame up). */
  compiled: string[];
  textures: number;
  moving: boolean;
}

interface Spike {
  /** Seconds since recording began. */
  t: number;
  /** Time from this frame's start to the next one's (ms). */
  gap: number;
  /** Our own work in this frame (ms), and by step. */
  work: number;
  steps: Record<string, number>;
  /** Time between the end of this frame's work and the start of the next: the browser's own (GC, compositing, other tasks) and the wait for the display's next refresh. */
  outside: number;
  /** Heap freed during this frame or right after it (MB, Chrome only): a garbage collection ran. */
  gc?: number;
  /** Long tasks the browser saw in this gap (ms each, Chrome only). */
  long?: number[];
  /** Shader programs compiled this frame (their materials), and new textures sent to the GPU. */
  programs?: string;
  textures?: number;
  ctx: SpikeContext;
}

/**
 * Telemetry for real games: off unless asked for (`?perf=rec`, or the Options box, kept for this browser). Times every
 * step of every frame and keeps, for each frame more than 50 ms after the one before, what was going on. At the end
 * of the game its compact JSON can be saved or copied to send. Off, it costs one test a frame.
 */
export class PerfRecorder {
  on = false;
  private t0 = 0;
  private frameStart = 0;
  private lastStart = 0;
  private lastEnd = 0;
  private stepStart = 0;
  private steps: Record<string, number> = {};
  /** Per step: total and worst (ms). */
  private totals: Record<string, { sum: number; max: number }> = {};
  private frames = 0;
  private hist = BUCKETS.map(() => 0).concat(0);
  private gaps: number[] = [];
  private spikes: Spike[] = [];
  private spikeCount = 0;
  private heap = 0;
  private gcCount = 0;
  private gcMb = 0;
  private longTasks: { at: number; ms: number }[] = [];
  private programs = 0;
  private textures = 0;
  private camera = '';
  private prev: FrameDone | null = null;
  private unitsOnScreen: (() => number) | null = null;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly about: Record<string, unknown>,
  ) {
    let stored = false;
    try {
      stored = localStorage.getItem(KEY) === '1';
    } catch {
      // private browsing: only ?perf=rec turns it on
    }
    if (new URLSearchParams(location.search).get('perf') === 'rec' || stored) this.start();
  }

  /** The Options box. */
  field(): string {
    return `<label><input type="checkbox" data-k="perfrec"${this.on ? ' checked' : ''}> Enregistrer les performances de chaque partie (un fichier à envoyer à la fin ; réglage gardé pour les suivantes)</label>`;
  }

  toggle(on: boolean): void {
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // private browsing: for this page only
    }
    if (on && !this.on) this.start();
    this.on = on;
  }

  private start(): void {
    this.on = true;
    this.t0 = performance.now();
    document.addEventListener('visibilitychange', () => this.idle());
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) this.longTasks.push({ at: e.startTime, ms: e.duration });
        if (this.longTasks.length > 64) this.longTasks.splice(0, this.longTasks.length - 64);
      }).observe({ type: 'longtask', buffered: false });
    } catch {
      // only Chrome reports long tasks
    }
  }

  /** A frame not timed (paused, or the tab hidden): the next one is no spike. */
  idle(): void {
    this.lastStart = this.lastEnd = 0;
    this.prev = null;
  }

  /** At the start of a frame's work: the time since the one before tells whether that one was a spike. */
  begin(): void {
    if (!this.on) return;
    const now = performance.now();
    const gap = this.lastStart ? now - this.lastStart : 0;
    if (gap) {
      this.frames++;
      this.gaps.push(gap);
      if (this.gaps.length > 100000) this.gaps.splice(0, 50000); // about half an hour at 60 a second: keep the recent half
      const b = BUCKETS.findIndex((x) => gap < x);
      this.hist[b < 0 ? BUCKETS.length : b]++;
    }
    if (gap > SPIKE && this.prev && this.unitsOnScreen) {
      // A collection between the two frames shows here, before the next frame's own.
      const heap = heapNow();
      this.spike(gap, now - this.lastEnd, this.prev, this.unitsOnScreen(), this.heap > heap ? (this.heap - heap) / 1048576 : 0);
    }
    this.frameStart = this.stepStart = now;
    this.steps = {};
  }

  /** The step just done, timed from the last mark (ms; a name may come back, it adds up). */
  lap(name: string): void {
    if (!this.on) return;
    const now = performance.now();
    this.steps[name] = (this.steps[name] ?? 0) + now - this.stepStart;
    this.stepStart = now;
  }

  /** A step timed apart, inside another (the fog inside the simulation). */
  add(name: string, ms: number): void {
    if (this.on) this.steps[name] = (this.steps[name] ?? 0) + ms;
  }

  /**
   * At the end of a frame's work. `facts` are taken now: the game clears its counts for the next frame right after.
   * `unitsOnScreen`, costlier, is only asked for if the next frame comes late.
   */
  end(cameraAt: string, facts: FrameFacts, unitsOnScreen: () => number): void {
    if (!this.on) return;
    const now = performance.now();
    this.unitsOnScreen = unitsOnScreen;
    for (const [k, ms] of Object.entries(this.steps)) {
      const t = (this.totals[k] ??= { sum: 0, max: 0 });
      t.sum += ms;
      t.max = Math.max(t.max, ms);
    }
    const heap = heapNow();
    const freed = this.heap > heap ? (this.heap - heap) / 1048576 : 0;
    if (freed > 0.5) {
      this.gcCount++;
      this.gcMb += freed;
    }
    this.heap = heap;
    const info = this.renderer.info;
    const programs = info.programs?.length ?? 0;
    const textures = info.memory.textures;
    this.prev = {
      facts,
      start: this.frameStart,
      work: now - this.frameStart,
      steps: this.steps,
      freed,
      programs: Math.max(0, programs - this.programs),
      compiled: programs > this.programs ? info.programs!.slice(this.programs).map((p) => (p as unknown as { name: string }).name) : [],
      textures: Math.max(0, textures - this.textures),
      moving: cameraAt !== this.camera,
    };
    this.camera = cameraAt;
    this.programs = programs;
    this.textures = textures;
    this.lastStart = this.frameStart;
    this.lastEnd = now;
  }

  /** The frame before came this late: what it did, and what the browser did after it. */
  private spike(gap: number, outside: number, f: FrameDone, units: number, freedAfter: number): void {
    this.spikeCount++;
    const r = (x: number) => Math.round(x * 10) / 10;
    const long = this.longTasks.filter((l) => l.at + l.ms > f.start && l.at < f.start + gap).map((l) => Math.round(l.ms));
    const spike: Spike = {
      t: r((f.start - this.t0) / 1000),
      gap: r(gap),
      work: r(f.work),
      steps: Object.fromEntries(Object.entries(f.steps).filter(([, ms]) => ms >= 1).map(([k, ms]) => [k, r(ms)])),
      outside: r(outside),
      ctx: { ...f.facts, units, moving: f.moving },
    };
    if (f.freed + freedAfter > 0.5) spike.gc = r(f.freed + freedAfter);
    if (long.length) spike.long = long;
    if (f.programs) spike.programs = f.compiled.join(',');
    if (f.textures) spike.textures = f.textures;
    if (this.spikes.length < MAX_SPIKES) this.spikes.push(spike);
    else {
      // Full: the mildest one gives way.
      let i = 0;
      for (let j = 1; j < this.spikes.length; j++) if (this.spikes[j].gap < this.spikes[i].gap) i = j;
      if (this.spikes[i].gap < spike.gap) this.spikes[i] = spike;
    }
  }

  /** Everything recorded, small enough to paste. */
  report(extra: Record<string, unknown> = {}): string {
    const sorted = [...this.gaps].sort((a, b) => a - b);
    const q = (p: number) => Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0) * 10) / 10;
    const r = (x: number) => Math.round(x * 100) / 100;
    return JSON.stringify({
      v: 1,
      ...this.about,
      ...extra,
      device: device(this.renderer),
      seconds: Math.round((performance.now() - this.t0) / 1000),
      frames: this.frames,
      gap: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1) },
      hist: Object.fromEntries(this.hist.map((n, i) => [i < BUCKETS.length ? `<${BUCKETS[i]}` : `>=${BUCKETS[BUCKETS.length - 1]}`, n])),
      steps: Object.fromEntries(Object.entries(this.totals).map(([k, t]) => [k, { avg: r(t.sum / Math.max(1, this.frames)), max: r(t.max) }])),
      gc: { count: this.gcCount, mb: Math.round(this.gcMb) },
      spikes: this.spikeCount,
      worst: [...this.spikes].sort((a, b) => a.t - b.t),
    });
  }

}

/** JavaScript heap in use (bytes; Chrome only, else 0). */
function heapNow(): number {
  return (performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
}

function device(renderer: WebGLRenderer): Record<string, unknown> {
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    ua: navigator.userAgent,
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    cores: navigator.hardwareConcurrency,
    memory: nav.deviceMemory,
    screen: `${window.innerWidth}x${window.innerHeight}@${devicePixelRatio}`,
    canvas: `${renderer.domElement.width}x${renderer.domElement.height}`,
  };
}
