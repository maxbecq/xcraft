import { AmbientLight, AnimationMixer, Box3, DirectionalLight, Group, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { preview } from './units';

/**
 * The selected entity, alive in the selection panel: its own model turning slowly (units play their idle
 * clip), drawn in a small canvas of its own. The HUD tints it like the rest of its screen.
 */
export class Portrait {
  readonly canvas = document.createElement('canvas');
  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(28, 1, 0.05, 100);
  private readonly holder = new Group();
  private mixer: AnimationMixer | null = null;
  private key = '';
  private last = performance.now();

  constructor() {
    this.canvas.className = 'portrait';
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

  /** Draws a frame when the portrait is on screen. */
  render(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.key || !this.canvas.isConnected || this.canvas.offsetParent === null) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer ??= new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    const ratio = Math.min(2, window.devicePixelRatio);
    if (this.canvas.width !== Math.round(w * ratio) || this.canvas.height !== Math.round(h * ratio)) {
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.mixer?.update(dt);
    if (!this.mixer) this.holder.rotation.y += dt * 0.35; // buildings turn slowly
    this.renderer.render(this.scene, this.camera);
  }
}
