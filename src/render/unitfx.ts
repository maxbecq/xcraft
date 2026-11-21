import {
  Sprite, SpriteMaterial, AdditiveBlending, BufferAttribute, DoubleSide, CanvasTexture, SRGBColorSpace, Color, PlaneGeometry, Vector3, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, RepeatWrapping, RingGeometry, SphereGeometry, BufferGeometry, type Texture, Points, PointsMaterial,
} from 'three';
import type { Entity } from '../sim/world';
import { owned } from './models';
import { smoothstep } from './gait';

/** A drop for death bursts: deep red ringed with near black, so it shows on pale sand, ice and dark rock alike. */
let dropTex: CanvasTexture | undefined;
export function dropTexture(): CanvasTexture {
  if (dropTex) return dropTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(16, 16, 11, 0, Math.PI * 2);
  g.fillStyle = '#a3170f';
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#1c0402';
  g.stroke();
  dropTex = new CanvasTexture(c);
  dropTex.colorSpace = SRGBColorSpace;
  return dropTex;
}

/** A soft round spark, for the well's stars and geysers. */
let sparkTexture: CanvasTexture | undefined;
export function spark(): CanvasTexture {
  if (sparkTexture) return sparkTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(230,200,255,0.8)');
  grad.addColorStop(1, 'rgba(160,80,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return (sparkTexture = new CanvasTexture(c));
}

/** Swirling eddies drawn as spiral arcs, turned slowly over the pool. */
let eddyTexture: CanvasTexture | undefined;
function eddies(): CanvasTexture {
  if (eddyTexture) return eddyTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(64, 64);
  for (let k = 0; k < 5; k++) {
    g.rotate((Math.PI * 2) / 5);
    g.beginPath();
    for (let a = 0; a < 3.2; a += 0.1) g.lineTo(Math.cos(a) * (8 + a * 15), Math.sin(a) * (8 + a * 15));
    g.strokeStyle = `rgba(255,220,255,${0.35 + 0.1 * k})`;
    g.lineWidth = 3;
    g.stroke();
  }
  eddyTexture = new CanvasTexture(c);
  eddyTexture.center.set(0.5, 0.5);
  return eddyTexture;
}

let haloTexture: Texture | null = null;
/**
 * The Réserve psy at rest: its two bands of dotted light turn on themselves, the upper one the other way and
 * slower, inside a halo of cyan light that slowly swells and fades, phased per building. Render only.
 */
export function reserveFx(body: Object3D, seed: number): { group: Group; update(dt: number, t: number): void } {
  const group = new Group();
  const bands = [body.getObjectByName('psyband_0'), body.getObjectByName('psyband_1')];
  if (!haloTexture) {
    // Brightest at mid-height, fading out at the top and bottom of the shell.
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1, 64);
    haloTexture = new CanvasTexture(c);
  }
  const halo = new Mesh(
    new CylinderGeometry(0.9, 0.9, 0.7, 32, 1, true),
    owned(new MeshBasicMaterial({ map: haloTexture, color: 0x5ae0ff, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })),
  );
  halo.position.y = 0.46;
  halo.userData.noPick = true;
  group.add(halo);
  const phase = (seed * 2.399) % (Math.PI * 2);
  return {
    group,
    update(dt, t) {
      if (bands[0]) bands[0].rotation.y += dt * 0.9;
      if (bands[1]) bands[1].rotation.y -= dt * 0.6;
      const breath = 0.5 + 0.5 * Math.sin(t * 1.3 + phase); // a slow swell, about 5 s
      halo.scale.set(1 + 0.14 * breath, 1, 1 + 0.14 * breath);
      (halo.material as MeshBasicMaterial).opacity = 0.12 + 0.3 * breath;
    },
  };
}

/**
 * The life of an energy well: the glow at the bottom breathes unevenly, eddies turn on the pool, stars drift up
 * out of it and now and then a little geyser of sparks shoots up and falls back. Render only, seeded by the well.
 */
let bubbleTexture: CanvasTexture | undefined;
/** Bubbles on a clear ground, tiling top to bottom, for a liquid seen through glass. */
function bubbles(): CanvasTexture {
  if (bubbleTexture) return bubbleTexture;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  let r = 7;
  const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 22; i++) {
    const [x, y, s] = [4 + rand() * 56, rand() * 128, 1.5 + rand() * 4.5];
    for (const dy of [-128, 0, 128]) {
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, y + dy, s, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillRect(x - s * 0.45, y + dy - s * 0.45, Math.max(1, s * 0.35), Math.max(1, s * 0.35)); // a glint
    }
  }
  bubbleTexture = new CanvasTexture(c);
  bubbleTexture.wrapT = RepeatWrapping;
  return bubbleTexture;
}

/**
 * The Z Assimilateur at work: bubbles rising in the blue liquid of its tank (a strip scrolling up over the glass, a
 * few loose ones in front), the liquid lit from within, and a wide halo round the tank that swells and fades in a slow,
 * deep pulse, both kept dim enough not to flare under the bloom. The tank is where Rodin painted it on the model, in
 * the body's frame; nothing shows while the building is still being printed.
 */
export function assimFx(body: Object3D, e: Entity): { group: Group; update(dt: number, t: number): void } {
  const group = new Group();
  group.userData.noPick = true;
  const [w, h, y, z] = [0.5, 0.38, 0.65, 0.475]; // the tank's face
  const tex = owned(bubbles().clone());
  tex.needsUpdate = true;
  tex.repeat.set(1, h / w / 2);
  const rising = new Mesh(new PlaneGeometry(w, h), owned(new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending, color: 0x8fd8ff })));
  rising.position.set(0, y, z);
  // The liquid's own light, under the bubbles.
  const liquid = new Mesh(new PlaneGeometry(w, h), owned(new MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, blending: AdditiveBlending, color: 0x3d6bff })));
  liquid.position.set(0, y, z - 0.005);
  const glow = new Mesh(new PlaneGeometry(w * 1.5, h * 1.6), owned(new MeshBasicMaterial({ map: spark(), transparent: true, opacity: 0.3, depthWrite: false, blending: AdditiveBlending, color: 0x5a7dff })));
  glow.position.set(0, y, z + 0.01);
  // The halo: facing the camera, so it reads from the game's view whatever the side the tank is on.
  const halo = new Sprite(owned(new SpriteMaterial({ map: spark(), transparent: true, opacity: 0.4, depthWrite: false, blending: AdditiveBlending, color: 0x4f7bff })));
  halo.scale.set(w * 3.4, h * 3.6, 1);
  halo.position.set(0, y, z + 0.12);
  group.add(liquid, rising, glow, halo);
  const n = 10;
  const pos = new Float32Array(n * 3);
  let r = e.id * 9301 + 49297;
  const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const reset = (i: number, any?: boolean) => pos.set([(rand() - 0.5) * w * 0.85, y - h / 2 + (any ? rand() * h : 0), z + 0.02], i * 3);
  for (let i = 0; i < n; i++) reset(i, true);
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(pos, 3));
  const loose = new Points(geom, owned(new PointsMaterial({ map: spark(), size: 0.07, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xbfe8ff })));
  loose.frustumCulled = false;
  group.add(loose);
  for (const o of group.children) o.userData.noPick = true;
  body.add(group);
  return {
    group,
    update(dt, t) {
      group.visible = e.buildLeft === 0;
      if (!group.visible) return;
      tex.offset.y -= dt * 0.18;
      // About 3.7 s a beat, eased so it lingers bright and dark.
      const pulse = smoothstep(0.5 + 0.5 * Math.sin(t * 1.7 + e.id));
      (liquid.material as MeshBasicMaterial).opacity = 0.35 + 0.35 * pulse;
      (glow.material as MeshBasicMaterial).opacity = 0.2 + 0.4 * pulse;
      (halo.material as SpriteMaterial).opacity = 0.1 + 0.5 * pulse;
      halo.scale.set(w * (3 + 0.8 * pulse), h * (3.2 + 0.9 * pulse), 1);
      (rising.material as MeshBasicMaterial).opacity = 0.5 + 0.2 * pulse;
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        pos[j + 1] += dt * (0.12 + (i % 3) * 0.04);
        pos[j] += Math.sin(t * 3 + i) * dt * 0.02; // a little wobble
        if (pos[j + 1] > y + h / 2) reset(i);
      }
      geom.getAttribute('position').needsUpdate = true;
    },
  };
}

export function wellFx(body: Object3D, seed: number): { group: Group; update(dt: number, t: number): void } {
  const group = new Group();
  group.userData.noPick = true;
  // Its own copies of the glowing materials, so each well breathes on its own.
  const glows: MeshStandardMaterial[] = [];
  body.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = o.material as MeshStandardMaterial;
    if (m.emissive && m.emissive.getHex() !== 0) {
      o.material = owned(m.clone());
      glows.push(o.material as MeshStandardMaterial);
    }
  });
  const base = glows.map((m) => m.emissiveIntensity);
  const swirl = owned(eddies().clone());
  swirl.needsUpdate = true;
  const eddy = new Mesh(new PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2), owned(new MeshBasicMaterial({ map: swirl, transparent: true, opacity: 0.35, depthWrite: false, blending: AdditiveBlending, color: 0xd8a0ff })));
  eddy.position.y = 0.09;
  group.add(eddy);
  // Particles: n stars drifting up, and a geyser of the same sparks from time to time.
  const n = 36;
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const wild = new Uint8Array(n); // geyser sparks, under gravity
  let r = seed * 9301 + 49297;
  const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const reset = (i: number, geyser?: [number, number]) => {
    const a = rand() * Math.PI * 2;
    const d = geyser ? 0.05 : rand() * 0.6;
    pos.set([(geyser?.[0] ?? 0) + Math.cos(a) * d, 0.08, (geyser?.[1] ?? 0) + Math.sin(a) * d], i * 3);
    vel.set(geyser ? [(rand() - 0.5) * 0.6, 1.6 + rand() * 1.2, (rand() - 0.5) * 0.6] : [(rand() - 0.5) * 0.08, 0.25 + rand() * 0.35, (rand() - 0.5) * 0.08], i * 3);
    wild[i] = geyser ? 1 : 0;
  };
  for (let i = 0; i < n; i++) {
    reset(i);
    pos[i * 3 + 1] = 0.08 + rand() * 2;
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(pos, 3));
  const stars = new Points(geom, owned(new PointsMaterial({ map: spark(), size: 0.16, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xe8c8ff })));
  stars.frustumCulled = false;
  group.add(stars);
  let nextGeyser = 1 + rand() * 4;
  return {
    group,
    update(dt, t) {
      // Uneven breathing: two slow waves and a faster flicker.
      const pulse = 0.75 + 0.2 * Math.sin(t * 1.3 + seed) + 0.12 * Math.sin(t * 3.7 + seed * 2) + 0.06 * Math.sin(t * 11 + seed);
      glows.forEach((m, i) => (m.emissiveIntensity = base[i] * pulse));
      swirl.rotation += dt * 0.35;
      (eddy.material as MeshBasicMaterial).opacity = 0.2 + 0.18 * pulse;
      nextGeyser -= dt;
      if (nextGeyser <= 0) {
        // A geyser: a dozen sparks leap from one spot of the pool.
        const a = rand() * Math.PI * 2;
        const spot: [number, number] = [Math.cos(a) * rand() * 0.45, Math.sin(a) * rand() * 0.45];
        for (let k = 0; k < 12; k++) reset(Math.floor(rand() * n), spot);
        nextGeyser = 2 + rand() * 5;
      }
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        if (wild[i]) vel[j + 1] -= dt * 3; // geyser sparks arc up and fall back into the pool
        pos[j] += vel[j] * dt;
        pos[j + 1] += vel[j + 1] * dt;
        pos[j + 2] += vel[j + 2] * dt;
        if (pos[j + 1] > 2.4 || pos[j + 1] < 0.05) reset(i);
      }
      geom.getAttribute('position').needsUpdate = true;
    },
  };
}
const RALLY = 0x4dff6a;
/**
 * Rally point marker: a slim beacon planted in the ground. A dark steel needle on a small hexagonal foot inlaid
 * with light, a lamp on top that flashes softly, a small holographic blade turning round the mast and a thin
 * ring on the ground that now and then breathes out a wider one. Animated by `animateRally`.
 */
export function rallyFlag(): Group {
  const flag = new Group();
  const steel = new MeshStandardMaterial({ color: 0x2c333c, metalness: 0.75, roughness: 0.35 });
  const light = (opacity: number) => new MeshBasicMaterial({ color: RALLY, transparent: true, opacity, depthWrite: false, side: DoubleSide });
  const flat = (inner: number, outer: number, opacity: number, y: number) => {
    const m = new Mesh(new RingGeometry(inner, outer, 48), light(opacity));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    return m;
  };
  const foot = new Mesh(new CylinderGeometry(0.13, 0.16, 0.06, 6), steel);
  foot.position.y = 0.03;
  const inlay = flat(0.07, 0.095, 0.9, 0.065);
  const mast = new Mesh(new CylinderGeometry(0.012, 0.03, 1, 6), steel);
  mast.position.y = 0.55;
  const collar = new Mesh(new CylinderGeometry(0.035, 0.035, 0.025, 8), new MeshBasicMaterial({ color: RALLY }));
  collar.position.y = 0.88;
  const lamp = new Mesh(new SphereGeometry(0.05, 10, 8), new MeshBasicMaterial({ color: RALLY }));
  lamp.position.y = 1.08;
  const halo = new Mesh(new SphereGeometry(0.12, 12, 10), light(0.3));
  halo.position.y = 1.08;
  // A small blade of light, hinged on the mast, turning slowly.
  const blade = new Group();
  blade.position.y = 0.72;
  blade.add(new Mesh(new BufferGeometry().setFromPoints([new Vector3(0.03, 0.07, 0), new Vector3(0.24, 0, 0), new Vector3(0.09, 0, 0), new Vector3(0.09, 0, 0), new Vector3(0.24, 0, 0), new Vector3(0.03, -0.07, 0)]), light(0.75)));
  const ring = flat(0.27, 0.295, 0.45, 0.02);
  const wave = flat(0.27, 0.29, 0.4, 0.02);
  flag.add(foot, inlay, mast, collar, lamp, halo, blade, ring, wave);
  flag.userData.rally = { lamp, halo, blade, wave };
  flag.traverse((o) => (o.userData.noPick = true));
  return flag;
}

/** The beacon's life: a soft flash of the lamp every 1.6 s, the blade turning, a ring breathing out and fading. */
export function animateRally(flag: Group, now: number, phase: number): void {
  const { lamp, halo, blade, wave } = flag.userData.rally as Record<'lamp' | 'halo' | 'blade' | 'wave', Mesh>;
  const t = now / 1000 + phase;
  const flash = Math.exp(-((t % 1.6) * 6)); // 1 at the flash, fading quickly
  (lamp.material as MeshBasicMaterial).color.setHex(RALLY).lerp(WHITE, flash);
  (halo.material as MeshBasicMaterial).opacity = 0.12 + 0.45 * flash;
  halo.scale.setScalar(0.8 + 0.6 * flash);
  blade.rotation.y = t * 1.2;
  const k = (t / 2) % 1;
  wave.scale.setScalar(1 + 1.4 * k);
  (wave.material as MeshBasicMaterial).opacity = 0.4 * (1 - k) ** 2;
}
const WHITE = new Color(0xffffff);

/** Effects kept sober on the low graphics level (src/quality.ts): no embers, a fainter spill. Set once by main.ts. */
let lite = false;
export function setFxLite(on: boolean): void {
  lite = on;
}

/** A furnace mouth: a white-hot core low down, in orange going red and out at the rim. */
let mouthTexture: CanvasTexture | undefined;
function kilnMouth(): CanvasTexture {
  if (mouthTexture) return mouthTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 38, 0, 32, 38, 30);
  grad.addColorStop(0, 'rgba(255,245,200,1)');
  grad.addColorStop(0.35, 'rgba(255,170,50,0.95)');
  grad.addColorStop(0.75, 'rgba(230,70,20,0.7)');
  grad.addColorStop(1, 'rgba(160,20,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  mouthTexture = new CanvasTexture(c);
  mouthTexture.colorSpace = SRGBColorSpace;
  return mouthTexture;
}

/** A soft warm round glow, white at the heart: tinted by the material's colour. */
let warmTexture: CanvasTexture | undefined;
function warm(): CanvasTexture {
  if (warmTexture) return warmTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return (warmTexture = new CanvasTexture(c));
}

/**
 * The Z Centre d'armement's forge: the furnace mouth glowing on the back wall inside the dome and flickering, a halo
 * round it, its warm light spilt on the floor out to the gate, and embers rising from it and drifting out. Rodin left the back wall
 * plain, so the mouth is drawn here, where the board has it (left of the arm), in the body's frame (glTF +Z forward,
 * the gate). Nothing shows while the building is being printed.
 */
export function forgeFx(body: Object3D, e: Entity): { group: Group; update(dt: number, t: number): void } {
  const group = new Group();
  const [x, y, z, w, h] = [-0.22, 0.45, -0.09, 0.62, 0.5]; // the mouth, on the back wall (measured on the model)
  const mouth = new Mesh(new PlaneGeometry(w, h), owned(new MeshBasicMaterial({ map: kilnMouth(), transparent: true, depthWrite: false, blending: AdditiveBlending })));
  mouth.position.set(x, y, z);
  const halo = new Sprite(owned(new SpriteMaterial({ map: warm(), transparent: true, opacity: 0.35, depthWrite: false, blending: AdditiveBlending, color: 0xff6a20 })));
  halo.scale.set(w * 2.6, h * 2.6, 1);
  halo.position.set(x, y, z + 0.15);
  // The spill: a long warm patch on the floor, from the furnace out through the gate.
  const spill = new Mesh(new PlaneGeometry(1.3, 1.7).rotateX(-Math.PI / 2), owned(new MeshBasicMaterial({ map: warm(), transparent: true, opacity: 0.3, depthWrite: false, blending: AdditiveBlending, color: 0xff7a30 })));
  spill.position.set(x * 0.6, 0.09, 0.55);
  group.add(spill, mouth, halo);
  const n = lite ? 0 : 14;
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  let r = e.id * 9301 + 49297;
  const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const reset = (i: number) => {
    pos.set([x + (rand() - 0.5) * w * 0.7, y - h * 0.2 + rand() * h * 0.3, z + 0.05], i * 3);
    vel.set([(rand() - 0.5) * 0.1, 0.16 + rand() * 0.2, 0.3 + rand() * 0.25], i * 3); // drawn out through the gate
  };
  for (let i = 0; i < n; i++) {
    reset(i);
    pos[i * 3 + 1] += rand() * 0.5;
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(pos, 3));
  const embers = new Points(geom, owned(new PointsMaterial({ map: warm(), size: 6, sizeAttenuation: false, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xffc060 })));
  embers.frustumCulled = false; // size in pixels: the game's orthographic camera ignores attenuation anyway
  embers.visible = n > 0;
  group.add(embers);
  group.traverse((o) => (o.userData.noPick = true));
  group.userData.ownMaterials = true; // each forge's own: freed with a warm-up view too (EntityRenderer.clear)
  body.add(group);
  const seed = e.id * 1.7;
  return {
    group,
    update(dt, t) {
      group.visible = e.buildLeft === 0;
      if (!group.visible) return;
      // A fire's flicker: a slow breath, two quicker waves and a fast shiver.
      const f = 0.78 + 0.1 * Math.sin(t * 1.1 + seed) + 0.07 * Math.sin(t * 4.3 + seed * 2) + 0.05 * Math.sin(t * 9.7 + seed * 3) + 0.03 * Math.sin(t * 23 + seed);
      (mouth.material as MeshBasicMaterial).opacity = Math.min(1, 0.75 + 0.3 * (f - 0.78) / 0.25);
      (halo.material as SpriteMaterial).opacity = 0.5 * f;
      halo.scale.set(w * (2.4 + 0.4 * f), h * (2.4 + 0.4 * f), 1);
      (spill.material as MeshBasicMaterial).opacity = (lite ? 0.22 : 0.4) * f;
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        pos[j] += (vel[j] + Math.sin(t * 2.3 + i) * 0.05) * dt;
        pos[j + 1] += vel[j + 1] * dt;
        pos[j + 2] += vel[j + 2] * dt;
        if (pos[j + 1] > 1.0 || pos[j + 2] > 1.3) reset(i); // under the dome's roof, or a little past the gate
      }
      if (n) geom.getAttribute('position').needsUpdate = true;
    },
  };
}

/**
 * The Mastodonte's two rear engines burning: a cyan-and-white jet out of each nozzle (two stretched additive glows,
 * a hot core and a trail of glows), flickering, while it flies somewhere; none while it hovers.
 * The nozzles are where the model has them (body frame, glTF +Z forward, so the back is -Z).
 */
export function thrusterFx(body: Object3D, e: Entity): { group: Group; update(dt: number, t: number): void } {
  const group = new Group();
  // Per nozzle: a white-hot core, then a trail of cyan glows shrinking and fading back along the jet.
  const jets: Sprite[][] = [];
  for (const x of [-0.36, 0.36]) {
    const trail: Sprite[] = [];
    for (let k = 0; k < 7; k++) {
      const s = new Sprite(owned(new SpriteMaterial({ map: warm(), transparent: true, depthWrite: false, blending: AdditiveBlending, color: k ? 0x28c8ff : 0xf0ffff })));
      s.position.set(x, 0.68, -1.15);
      group.add(s);
      trail.push(s);
    }
    jets.push(trail);
  }
  group.traverse((o) => (o.userData.noPick = true));
  body.add(group);
  let [lx, ly, power] = [e.x, e.y, 0];
  const seed = e.id * 1.3;
  return {
    group,
    update(dt, t) {
      const moving = e.x !== lx || e.y !== ly;
      [lx, ly] = [e.x, e.y];
      power += ((moving ? 1 : 0) - power) * Math.min(1, dt * 3);
      group.visible = power > 0.02; // none at rest: they grow in as it sets off and die down as it stops
      for (const [i, trail] of jets.entries()) {
        const f = 0.85 + 0.1 * Math.sin(t * 23 + seed + i * 2) + 0.05 * Math.sin(t * 41 + i);
        const len = (0.2 + 0.9 * power) * f;
        for (const [k, s] of trail.entries()) {
          const u = k / (trail.length - 1);
          s.position.z = -1.15 - len * u;
          const size = (k ? 0.5 - 0.25 * u : 0.4) * (0.7 + 0.4 * power) * f;
          s.scale.set(size, size, 1);
          (s.material as SpriteMaterial).opacity = (k ? (0.7 - 0.5 * u) : 0.9) * (0.35 + 0.65 * power);
        }
      }
    },
  };
}
