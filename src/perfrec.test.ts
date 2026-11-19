import { afterEach, expect, it, vi } from 'vitest';
import type { WebGLRenderer } from 'three';
import { PerfRecorder } from './perfrec';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps a late frame's own simulation steps and events, taken when it ended", () => {
  vi.stubGlobal('location', { search: '?perf=rec' });
  vi.stubGlobal('document', { addEventListener: () => {} });
  vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
  vi.stubGlobal('devicePixelRatio', 1);
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const gl = { getExtension: () => null, getParameter: () => 'test', RENDERER: 0 };
  const renderer = { info: { programs: [], memory: { textures: 0 } }, getContext: () => gl, domElement: { width: 1, height: 1 } } as unknown as WebGLRenderer;
  const rec = new PerfRecorder(renderer, {});
  expect(rec.on).toBe(true);
  // Frame 1 ran two simulation steps with a building done, then the game cleared its counts.
  const happened: Record<string, number> = { done: 1 };
  rec.begin();
  now = 1010;
  rec.end('0,0,17', { tick: 40, ticks: 2, events: { ...happened } }, () => 7);
  delete happened.done;
  // Frame 2 starts 120 ms after frame 1: frame 1 was a spike.
  now = 1120;
  rec.begin();
  const [spike] = JSON.parse(rec.report()).worst;
  expect(spike.ctx).toEqual({ tick: 40, ticks: 2, events: { done: 1 }, units: 7, moving: true });
});
