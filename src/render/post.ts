import { type Camera, PMREMGenerator, type Scene, Vector2, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Rendering pipeline: ambient occlusion for contact shadows, bloom for glowing chemicals and fire,
 * filmic tone mapping and anti-aliasing. `?lowfx` falls back to a plain render.
 */
export class Post {
  private readonly composer: EffectComposer | null;
  private readonly ao: GTAOPass | null = null;

  constructor(private readonly renderer: WebGLRenderer, private readonly scene: Scene, private readonly camera: Camera, enabled: boolean) {
    // Soft image-based light so metal and glass pick up reflections.
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    if (!enabled) {
      this.composer = null;
      return;
    }
    const size = renderer.getSize(new Vector2());
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    this.ao = new GTAOPass(scene, camera, size.x, size.y);
    this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1.2 });
    this.ao.blendIntensity = 0.85;
    composer.addPass(this.ao);
    composer.addPass(new UnrealBloomPass(size, 0.5, 0.4, 0.9));
    composer.addPass(new OutputPass());
    composer.addPass(new SMAAPass());
    this.composer = composer;
  }

  setSize(w: number, h: number): void {
    this.composer?.setSize(w, h);
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
