import { Box3, Group, Quaternion, Vector3, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import type { Entity } from '../sim/world';

/**
 * Human buildings coming alive: their brass armillary spheres turn slowly, the meridians one way and the
 * tilted ecliptic ring the other, at a pace of their own. Null when the model has no sphere.
 */
export function armillaries(body: Object3D, seed: number): { group: Group; update(dt: number, t: number): void } | null {
  const rings: [Object3D, number][] = [];
  body.traverse((o) => {
    const m = /^armillary(b?)_\d+$/.exec(o.name);
    if (m) rings.push([o, (m[1] ? -0.55 : 0.3) * (0.8 + 0.4 * ((seed * 0.618) % 1))]);
  });
  if (!rings.length) return null;
  return {
    group: new Group(),
    update(dt) {
      for (const [o, speed] of rings) o.rotation.y += speed * dt;
    },
  };
}

/**
 * Isdaris buildings modelled by Fable (tools/meshy/fable.mjs): their floating parts (`float_*`), with the glowing lines laid
 * on them (`fx_*` inside their box), rise and sink slowly, each building at its own pace. Null when the model has none.
 */
export function floaters(body: Object3D, seed: number): { group: Group; update(dt: number, t: number): void } | null {
  // The named node only, not the meshes the loader splits it into (one per material), which carry its name too.
  const top = (prefix: string) => {
    const found = new Set<Object3D>();
    body.traverse((o) => {
      if (!o.name.startsWith(prefix)) return;
      for (let p = o.parent; p; p = p.parent) if (found.has(p)) return;
      found.add(o);
    });
    return [...found];
  };
  const floats = top('float_');
  // The Orbe's rings (`spin_*`), each turning about one of its own diameters, the two opposite ways at their own
  // speeds, as a gyroscope (Fable's proposal): modelled flat in their local XZ plane, so X and Z are diameters.
  // The Drone protecteur's plates (`spin_plaques`) orbit about the vertical; the Discobole's wheel (`spin_anneau`) rolls
  // with its travel instead (units.ts wheels).
  const spins = top('spin_').filter((o) => o.name !== 'spin_anneau').sort((a, b) => a.name.localeCompare(b.name)).map((o, i) => ({
    o, q0: o.quaternion.clone(), axis: o.name === 'spin_plaques' ? new Vector3(0, 1, 0) : new Vector3(i % 2 ? 0 : 1, 0, i % 2 ? 1 : 0), speed: i % 2 ? -1.25 : 0.8,
  }));
  // The Déflecteur's veils (`fx_voile_*`) turn slowly round the building (the user's wish, 2026-11-27): hung on a
  // pivot at their parent's origin, the building's axis, since meshopt leaves each mesh's own origin elsewhere.
  // The Orbe de commandement's black globe turns slowly on itself (an annotation on its board), on the same kind of pivot.
  const globe = floats.filter((f) => { let g = false; f.traverse((m) => { g ||= ((m as Mesh).material as Material | undefined)?.name === 'orbecmd_orbe'; }); return g; });
  const veils = [...top('fx_voile_'), ...globe];
  const pivots = new Set<Group>();
  for (const v of veils) {
    const parent = v.parent!;
    let pivot = parent.children.find((c) => c.userData.veilPivot) as Group | undefined;
    if (!pivot) {
      pivot = new Group();
      pivot.userData.veilPivot = true;
      parent.add(pivot);
      pivots.add(pivot);
    }
    pivot.add(v);
  }
  if (!floats.length && !spins.length && !pivots.size) return null;
  const boxes = floats.map((f) => new Box3().setFromObject(f).expandByScalar(0.1));
  const inFloat = (o: Object3D) => {
    for (let p = o.parent; p; p = p.parent) if (floats.includes(p)) return true;
    return false;
  };
  const riders = top('fx_').filter((o) => {
    if (inFloat(o)) return false; // moves with its float already (the Orbe's core and rings)
    const b = new Box3().setFromObject(o);
    return boxes.some((f) => f.containsBox(b));
  });
  const parts = [...floats, ...riders].map((o) => {
    const scale = o.parent ? o.parent.getWorldScale(new Vector3()).y : 1;
    return { o, y: o.position.y, amp: 0.05 / scale }; // 0.05 world units up and down
  });
  const phase = ((seed * 0.618) % 1) * Math.PI * 2;
  const turn = new Quaternion();
  return {
    group: new Group(),
    update(_dt, t) {
      const k = Math.sin(t * 0.9 + phase);
      for (const p of parts) p.o.position.y = p.y + p.amp * k;
      for (const s of spins) s.o.quaternion.copy(s.q0).multiply(turn.setFromAxisAngle(s.axis, t * s.speed + phase));
      for (const p of pivots) p.rotation.y = t * (globe.length ? 0.25 : 0.35) + phase;
    },
  };
}

/**
 * GLSL for the Human Meshy skins, after the team paint: needs `paint` (the texture colour), `vLife` (offset
 * from the building's origin, world units), `vSeed` and `veinTime`. Warm lamps and windows (orange in the
 * texture) breathe and flicker, dimming now and then; green vats breathe and send up bubbles.
 * Returns the light to add (rgb) and how much of the paint stays (a: dark windows are dimmed).
 */
export const LIFE_GLSL = `
  float lifeHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  vec4 lifeGlow(vec3 paint, vec3 local, float seed, float t) {
    vec3 glow = vec3(0.0);
    float dim = 1.0;
    // Warm glass (lamps, lanterns, the Conseil's dome, a few windows): always lit, a slow breath and a faint
    // flame flicker; below the roofs, now and then one dims to half for a moment, as if someone passed by it.
    float warm = smoothstep(0.12, 0.25, paint.r - paint.b) * smoothstep(0.45, 0.6, paint.r) * step(paint.g, paint.r * 0.85);
    if (warm > 0.0) {
      // The breath is the building's own, so a big lamp never splits into patches; dips go by whole tiles.
      float breath = 0.8 + 0.2 * sin(t * (0.4 + 0.3 * seed) + seed * 6.28) + 0.04 * sin(t * 11.0 + seed * 40.0);
      vec3 cell = floor(local);
      float h = lifeHash(cell + seed);
      float cycle = fract(t / (14.0 + 16.0 * h) + lifeHash(cell + seed + 7.0));
      float dip = smoothstep(0.0, 0.04, cycle) * (1.0 - smoothstep(0.08, 0.12, cycle)) * (1.0 - step(2.0, local.y));
      float lit = breath * (1.0 - 0.5 * dip);
      glow += vec3(1.0, 0.55, 0.18) * warm * lit * 0.8;
      dim = 1.0 - warm * 0.3 * dip;
    }
    // Green vats: a slow breath, and bubbles rising in columns.
    float green = smoothstep(0.08, 0.2, paint.g - max(paint.r, paint.b)) * smoothstep(0.3, 0.45, paint.g);
    if (green > 0.0) {
      // Round bubbles on a grid scrolling up, a third of the cells holding one.
      vec2 q = vec2((local.x + local.z) * 6.0, local.y * 6.0 - t * 1.6);
      float h = lifeHash(vec3(floor(q), seed));
      float bubble = (1.0 - smoothstep(0.18, 0.3, length(fract(q) - 0.5))) * step(0.66, h);
      float breath = 0.55 + 0.45 * sin(t * 1.3 + seed * 6.28);
      glow += green * (vec3(0.35, 1.0, 0.4) * 0.35 * breath + vec3(0.7, 1.0, 0.7) * 1.3 * bubble);
    }
    return vec4(glow, dim);
  }`;

/**
 * The Psycho-assembleur at work (Fable's model, the user's wishes 2026-11-27): while it builds a unit, its rings
 * (`float_anneaux`) and the three parts in assembly (`spin_pieces_1..3`) turn the opposite ways in turn round the tube,
 * the robot (`float_robot`) stands inside, and the beam (`fx_rayon`) flickers in strength. Idle, the tube is empty. The
 * turning parts hang on pivots at their parent's origin, the tube's axis (meshopt leaves their own origins elsewhere).
 */
export function assemblerFx(body: Object3D, e: Entity): { group: Group; update(dt: number, t: number): void } {
  const turning: { pivot: Group; speed: number }[] = [];
  for (const [name, speed] of [['float_anneaux', 0.9], ['spin_pieces_1', -1.3], ['spin_pieces_2', 1.1], ['spin_pieces_3', -1.5]] as const) {
    const o = body.getObjectByName(name);
    if (!o?.parent) continue;
    const pivot = new Group();
    o.parent.add(pivot);
    pivot.add(o);
    turning.push({ pivot, speed });
  }
  const robot = body.getObjectByName('float_robot');
  const ray = body.getObjectByName('fx_rayon');
  // The beam's own copy of the cyan lines' material, so only it flickers; it keeps their breathing.
  const beams: MeshStandardMaterial[] = [];
  ray?.traverse((m) => {
    if (!(m as Mesh).isMesh) return;
    const mat = (m as Mesh).material as MeshStandardMaterial;
    const c = mat.clone();
    c.userData.owned = true; // freed with the view, as models.ts owned() marks it (not imported: models imports this file)
    c.onBeforeCompile = mat.onBeforeCompile;
    c.customProgramCacheKey = mat.customProgramCacheKey;
    (m as Mesh).material = c;
    beams.push(c);
  });
  const base = beams[0]?.emissiveIntensity ?? 1;
  let angle = 0;
  return {
    group: new Group(),
    update(dt, t) {
      const working = e.buildLeft === 0 && e.queue.length > 0;
      for (const p of turning) p.pivot.visible = working;
      if (robot) robot.visible = working;
      if (ray) ray.visible = working;
      if (!working) return;
      angle += dt;
      for (const p of turning) p.pivot.rotation.y = angle * p.speed;
      const k = 0.75 + 0.25 * Math.sin(t * 4.7) + 0.15 * Math.sin(t * 13.1 + 1.3);
      for (const b of beams) b.emissiveIntensity = base * k;
    },
  };
}
