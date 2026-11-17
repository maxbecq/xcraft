// Bakes the interface sounds, their console reverb included, into public/sfx/<name>.mp3: the game only plays them.
// The synthesis runs in Chrome's OfflineAudioContext (headless), then ffmpeg encodes.
// Usage: node tools/sfx/bake.mjs   (needs Google Chrome and ffmpeg with libmp3lame)
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RATE = 48000;

/** Runs in the page: renders one sound, returns its two channels. */
const render = async (name, rate) => {
  const tail = 1.7;
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * (0.45 + tail)), rate);
  const t = 0;
  const noiseBuf = ctx.createBuffer(1, rate / 4, rate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  // Impulse: decaying stereo noise after a short pre-delay, its highs dying faster (a one-pole lowpass closing).
  const ir = ctx.createBuffer(2, Math.floor(rate * 1.6), rate);
  for (let c = 0; c < 2; c++) {
    const h = ir.getChannelData(c);
    let lp = 0;
    for (let i = Math.floor(rate * 0.012); i < h.length; i++) {
      const k = i / rate;
      lp += (Math.random() * 2 - 1 - lp) * Math.max(0.05, 0.9 - k * 0.7);
      h[i] = lp * Math.exp(-k * 3.6);
    }
  }
  // A large, bright metal hall, so the interface rings like a ship's console.
  const space = ctx.createConvolver();
  space.buffer = ir;
  const wetOut = ctx.createGain();
  wetOut.gain.value = 0.55;
  space.connect(wetOut).connect(ctx.destination);
  /** A voice with its own envelope, dry and sent into the reverb by `wet`. */
  const voice = (peak, decay, delay, wet) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + delay);
    g.gain.exponentialRampToValueAtTime(peak, t + delay + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + delay + decay);
    g.connect(ctx.destination);
    const send = ctx.createGain();
    send.gain.value = wet;
    g.connect(send).connect(space);
    return g;
  };
  /** A glassy ping: steady inharmonic sine partials (no pitch glide), ringing into the reverb. */
  const ping = (freqs, peak, decay, delay = 0, wet = 0.7) => {
    const g = voice(peak, decay, delay, wet);
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const p = ctx.createGain();
      p.gain.value = 1 / (i + 1);
      o.connect(p).connect(g);
      o.start(t + delay);
      o.stop(t + delay + decay + 0.02);
    });
  };
  /** A digital tick: a few milliseconds of band-passed noise, also sent into the reverb. */
  const tick = (freq, peak, decay = 0.008, delay = 0, wet = 0.5) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 2;
    src.connect(f).connect(voice(peak, decay, delay, wet));
    src.start(t + delay);
    src.stop(t + delay + decay + 0.02);
  };
  switch (name) {
    case 'click': // a relay tick with a faint glass ring: present but discreet
      tick(7000, 0.05, 0.006);
      ping([3150, 4730], 0.012, 0.07, 0.002, 0.6);
      break;
    case 'menu': // a choice made: a soft low latch, a tick, then a bright ringing chord that fades in the hall
      ping([150], 0.12, 0.06, 0, 0.2);
      tick(3200, 0.07, 0.012);
      ping([1046, 1574, 2793, 4186], 0.035, 0.32, 0.006, 0.9);
      tick(6400, 0.025, 0.006, 0.055, 0.8);
      break;
    case 'order': // an order sent: two quick data ticks and a short ping
      tick(4200, 0.05, 0.007);
      tick(5200, 0.035, 0.007, 0.04);
      ping([1760, 2650], 0.012, 0.1, 0.04, 0.6);
      break;
    case 'target': // an attack order: a harder crack over a low hit and a darker, dissonant ring
      ping([95], 0.16, 0.08, 0, 0.3);
      tick(1900, 0.09, 0.02);
      ping([622, 933, 1408], 0.03, 0.22, 0.004, 0.7);
      break;
  }
  const out = await ctx.startRendering();
  return [0, 1].map((c) => Array.from(out.getChannelData(c)));
};

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9399', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sfx-'))}`, 'about:blank'], { stdio: 'ignore' });
try {
  let ws;
  for (let i = 0; i < 50 && !ws; i++) {
    try {
      const page = (await (await fetch('http://127.0.0.1:9399/json')).json()).find((p) => p.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch {
      // Chrome still starting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r));
  const waiting = new Map();
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    waiting.get(d.id)?.(d.result);
  });
  let id = 0;
  const evaluate = (expression) => new Promise((r) => {
    waiting.set(++id, r);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  const dir = mkdtempSync(join(tmpdir(), 'sfx-wav-'));
  mkdirSync('public/sfx', { recursive: true });
  for (const name of ['click', 'menu', 'order', 'target']) {
    const res = await evaluate(`(${render})(${JSON.stringify(name)}, ${RATE})`);
    const [l, r] = res.result.value;
    // Trim the silent end of the reverb tail (below -80 dB).
    let n = l.length;
    while (n > 0 && Math.abs(l[n - 1]) < 1e-4 && Math.abs(r[n - 1]) < 1e-4) n--;
    const wav = Buffer.alloc(44 + n * 4);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(RATE, 24);
    wav.writeUInt32LE(RATE * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
    for (let i = 0; i < n; i++) {
      wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), 44 + i * 4);
      wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), 46 + i * 4);
    }
    const src = join(dir, `${name}.wav`);
    writeFileSync(src, wav);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-codec:a', 'libmp3lame', '-q:a', '3', `public/sfx/${name}.mp3`]);
    console.log(`public/sfx/${name}.mp3: ${(n / RATE).toFixed(2)} s`);
  }
} finally {
  chrome.kill();
}
process.exit(0);
