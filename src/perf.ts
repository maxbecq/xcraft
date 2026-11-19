import type { WebGLRenderer } from 'three';

const KEY = 'xcraft.debug';
/** A frame this long is a freeze (ms). */
const FREEZE = 100;
/** Frame times kept for the averages and the worst (ms). */
const WINDOW = 3000;

/**
 * Debug readout, a thin monospace line at the top of the screen: frame rate, frame time (average and worst
 * over the last seconds), freezes, skipped frames, simulation ticks per second, draw calls and triangles.
 * On with `?debug` or the Options box (kept for this browser); a click on the line resets its counters.
 * Off, it costs one test a frame.
 */
export class PerfHud {
  private el: HTMLElement | null = null;
  /** Recent frames: when each ended and how long it took (ms). */
  private frames: { at: number; ms: number; tick: number }[] = [];
  private last = 0;
  private painted = 0;
  private freezes = 0;
  private skipped = 0;
  private worst = 0;

  constructor(private readonly renderer: WebGLRenderer) {
    let stored = false;
    try {
      stored = localStorage.getItem(KEY) === '1';
    } catch {
      // private browsing: only ?debug turns it on
    }
    if (new URLSearchParams(location.search).has('debug') || stored) this.show(true);
  }

  /** The Options box (`extra`: more lines in it). */
  field(extra = ''): string {
    return `<fieldset class="options"><legend>Débogage</legend><label><input type="checkbox" data-k="debug"${this.el ? ' checked' : ''}> Mesures de performance en haut de l'écran</label>${extra}</fieldset>`;
  }

  /** Turned on or off from the Options box, and kept for this browser. */
  toggle(on: boolean): void {
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // private browsing: on for this page only
    }
    this.show(on);
  }

  private show(on: boolean): void {
    if (on === !!this.el) return;
    // Draw calls and triangles add up over every pass of a frame, so the counts are reset by hand (frame()).
    this.renderer.info.autoReset = !on;
    if (!on) {
      this.el?.remove();
      this.el = null;
      return;
    }
    this.el = document.body.appendChild(document.createElement('div'));
    this.el.className = 'perf';
    this.el.title = 'Clic : remettre les compteurs à zéro';
    this.el.onclick = () => this.reset();
    this.reset();
  }

  private reset(): void {
    this.frames = [];
    this.freezes = this.skipped = this.worst = 0;
    this.last = 0;
  }

  /** Once a frame, after drawing; `tick` is the simulation's. */
  frame(tick: number): void {
    if (!this.el) return;
    const now = performance.now();
    const info = this.renderer.info.render;
    const calls = info.calls;
    const triangles = info.triangles;
    this.renderer.info.reset();
    if (this.last) {
      const ms = now - this.last;
      this.frames.push({ at: now, ms, tick });
      // The display's own pace: the shortest frames seen lately (60 Hz, 120 Hz…).
      const sorted = this.frames.map((f) => f.ms).sort((a, b) => a - b);
      const target = sorted[Math.floor(sorted.length * 0.05)];
      if (ms > FREEZE) this.freezes++;
      else if (this.frames.length > 30 && ms > target * 1.5) this.skipped++;
    }
    this.last = now;
    while (this.frames.length && this.frames[0].at < now - WINDOW) this.frames.shift();
    if (now - this.painted < 250 || this.frames.length < 2) return;
    this.painted = now;
    const second = this.frames.filter((f) => f.at >= now - 1000);
    const fps = second.length / ((now - second[0].at + second[0].ms) / 1000);
    const avg = this.frames.reduce((s, f) => s + f.ms, 0) / this.frames.length;
    const worst = Math.max(...this.frames.map((f) => f.ms));
    this.worst = Math.max(this.worst, worst);
    const tps = ((tick - second[0].tick) * 1000) / (now - second[0].at + second[0].ms);
    this.el.textContent =
      `${fps.toFixed(0)} i/s · ${avg.toFixed(1)} ms (pire ${worst.toFixed(0)}, max ${this.worst.toFixed(0)})\n` +
      `gels ${this.freezes} · sautées ${this.skipped} · ${tps.toFixed(0)} ticks/s · ${calls} appels · ${(triangles / 1000).toFixed(0)} k tri`;
  }
}
