import { AmbientLight, AnimationMixer, Box3, DirectionalLight, Group, Mesh, PerspectiveCamera, Scene, Texture, Vector3, WebGLRenderer } from 'three';
import { freePreview, preview } from './models';

/**
 * The selected entity, alive in the selection panel: its own model turning slowly (units play their idle
 * clip), drawn in a small canvas of its own. The HUD tints it like the rest of its screen.
 */
/** Milliseconds between two pictures of the portrait (15 a second). */
const PACE = 1000 / 15 - 2;

export class Portrait {
  readonly canvas = document.createElement('canvas');
  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(28, 1, 0.05, 100);
  private readonly holder = new Group();
  private mixer: AnimationMixer | null = null;
  private key = '';
  /** The subject last drawn. */
  private drawn = '';
  private last = performance.now();

  constructor() {
    this.canvas.className = 'portrait';
    this.canvas.hidden = true; // until something is selected
    this.scene.add(this.holder, new AmbientLight(0xffffff, 1.4));
    const sun = new DirectionalLight(0xffffff, 2.6);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
  }

  /** Shows a type for an owner; null clears. Cheap when nothing changed. */
  show(type: string | null, owner = 0): void {
    const key = type ? `${type}/${owner}` : '';
    if (key === this.key) return;
    this.key = key;
    for (const o of this.holder.children) freePreview(o);
    this.holder.clear();
    this.mixer = null;
    if (!type) return;
    const { object, clips } = preview(type, owner);
    this.holder.add(object);
    const idle = clips.find((c) => c.name === 'idle');
    if (idle) {
      this.mixer = new AnimationMixer(object);
      this.mixer.clipAction(idle).play();
    }
    // Units: head and chest, as on a comms screen; buildings and the rest: the whole thing.
    const box = new Box3().setFromObject(object);
    const size = box.getSize(new Vector3());
    const unit = !!idle || size.y < 1.2;
    const focus = unit ? new Vector3(0, box.min.y + size.y * 0.72, 0) : box.getCenter(new Vector3());
    const reach = unit ? size.y * 0.55 : Math.max(size.x, size.y, size.z);
    const dist = reach / 2 / Math.tan((this.camera.fov * Math.PI) / 360) + reach * 0.4;
    this.camera.position.copy(focus).add(new Vector3(0, unit ? 0.05 * size.y : reach * 0.45, 1).normalize().multiplyScalar(dist));
    this.camera.lookAt(focus);
    this.holder.rotation.y = unit ? 0.35 : 0.8;
  }

  /**
   * Readies the portraits of these (type, owner) pairs behind the loading screen: the portrait's own WebGL
   * context, its shader programs (compiled side by side where the browser can) and its textures. Without it the
   * first click on a type froze the game for a third to half a second while its portrait's programs were built.
   */
  async prewarm(entries: [string, number][], stop: () => boolean = () => false): Promise<void> {
    // `stop`: the loading screen's wait is over (an online match must start); asked before each step, the rest left out.
    if (stop()) return;
    const renderer = this.context();
    // A scene of its own, lit as the portrait's (the same programs), so nothing of it ever shows.
    const warm = new Scene();
    warm.add(...this.scene.children.filter((o) => o !== this.holder).map((o) => o.clone()));
    const previews = entries.map(([type, owner]) => preview(type, owner).object);
    warm.add(...previews);
    warm.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      for (const m of [o.material].flat()) for (const v of Object.values(m)) if (v instanceof Texture) renderer.initTexture(v);
    });
    try {
      if (!stop()) await renderer.compileAsync(warm, this.camera);
      // A first draw through an empty scissor: the programs' first use (uniforms, link check) is paid now too.
      if (!stop()) {
        renderer.setScissorTest(true);
        renderer.setScissor(0, 0, 0, 0);
        renderer.render(warm, this.camera);
        renderer.setScissorTest(false);
      }
    } catch {
      // a lost context: the first click builds them as before
    }
    // The copies' own parts (bone textures) go; the programs and shared textures stay compiled.
    previews.forEach(freePreview);
  }

  /** Draws a frame when the portrait is on screen. */
  render(): void {
    const now = performance.now();
    // 15 times a second, and at once for a new subject: it is a second WebGL picture (its own context, skinning),
    // drawn on top of the game's every frame it shows; a slow turn and an idle sway read the same at that pace.
    if (!this.key || (this.drawn === this.key && now - this.last < PACE)) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.canvas.isConnected || this.canvas.offsetParent === null) return;
    this.drawn = this.key;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const renderer = this.context();
    const ratio = Math.min(2, window.devicePixelRatio);
    if (this.canvas.width !== Math.round(w * ratio) || this.canvas.height !== Math.round(h * ratio)) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.mixer?.update(dt);
    if (!this.mixer) this.holder.rotation.y += dt * 0.35; // buildings turn slowly
    renderer.render(this.scene, this.camera);
  }

  /** The portrait's own WebGL context, made on first use. */
  private context(): WebGLRenderer {
    return (this.renderer ??= new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true }));
  }
}
