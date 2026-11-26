import { type Camera, type Material, type Mesh, type Object3D, type OrthographicCamera, PMREMGenerator, type Scene, type Sprite, Vector2, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { inkPass } from './ink';
import { drawXray, XrayPass } from './xray';
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
  private readonly ink: ShaderPass | null = null;
  /** The silhouettes of units behind buildings (render/xray.ts); off at the basse level, where they cost two more
   * draws of the scene with no early depth test. */
  xray = true;

  /** `fx` holds particles: drawn after ambient occlusion, which would otherwise shade their quads. */
  /** `light` (phones and tablets): fewer occlusion samples, half-size bloom, no SMAA (the ink line already hides most jaggies). */
  constructor(private readonly renderer: WebGLRenderer, private readonly scene: Scene, private readonly fx: Scene, private readonly camera: Camera, enabled: boolean, light = false, warmShadows = 1) {
    // Soft image-based light so metal and glass pick up reflections.
    const environment = () => new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment();
    scene.environmentIntensity = 0.35;
    // It lives in a render target, which comes back empty after a lost GPU context (a heavy job on the same GPU,
    // a driver reset): without it buildings and units turned flat dark grey. Baked again once the context is back.
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      scene.environment?.dispose();
      scene.environment = environment();
    });
    // Shadows are drawn once per frame, in render(): the ambient occlusion pass renders the scene again
    // and would otherwise redraw the whole shadow map, every skinned unit included.
    renderer.shadowMap.autoUpdate = false;
    if (!enabled) {
      this.composer = null;
      return;
    }
    const size = renderer.getSize(new Vector2());
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new XrayPass(scene, camera));
    this.ao = new GTAOPass(scene, camera, size.x, size.y);
    this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1.2, samples: light ? 8 : 16 });
    this.ao.blendIntensity = 0.85;
    // Its depth-and-normal render also skips see-through overlays (selection rings, halos, effects): drawn
    // there as solid, a ring floating over the ground came out as a pale shaded disc, inked too.
    const ao = this.ao as unknown as { _overrideVisibility(): void; _visibilityCache: Object3D[] };
    const hideLines = ao._overrideVisibility.bind(ao);
    ao._overrideVisibility = () => {
      hideLines();
      scene.traverse((o) => {
        const m = (o as Mesh).material as Material | undefined;
        // So does a painted scenery (render/painted.ts): its shading and its lines are in the picture already; and an
        // Isdaris building materialising (render/materialise.ts), cut at its front, which this pass would draw whole.
        if (o.visible && ((o as Mesh).isMesh || (o as Sprite).isSprite) && m && !Array.isArray(m) && ((m.transparent && !m.depthWrite) || o.userData.painted || o.userData.noAo)) {
          o.visible = false;
          ao._visibilityCache.push(o);
        }
      });
    };
    // Units leave alpha 0.5 in the normal buffer, so the ink pass can tell them apart: animated characters
    // (skinned), and static unit models, whose geometry carries aUnit = 1 (unset elsewhere, so read as 0).
    this.ao.normalMaterial.onBeforeCompile = (sh) => {
      sh.vertexShader = `attribute float aUnit;\nvarying float vUnit;\n${sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvUnit = aUnit;')}`;
      sh.fragmentShader = `varying float vUnit;\n${sh.fragmentShader.replace(/}\s*$/, '#ifdef USE_SKINNING\n  gl_FragColor.a = 0.5;\n#endif\n  if (vUnit > 0.5) gl_FragColor.a = 0.5;\n}')}`;
    };
    composer.addPass(this.ao);
    // Its depth texture has no size until the pass first renders into it, but the ink pass samples it too: given
    // its target's size now, it is never bound as a 0×0 texture (WebGL: « dimensions must be greater than zero »).
    const target = (this.ao as unknown as { normalRenderTarget?: { width: number; height: number } }).normalRenderTarget;
    if (target) Object.assign(this.ao.depthTexture.image, { width: target.width, height: target.height });
    // `?noink` keeps the plain 3D look.
    if (!new URLSearchParams(location.search).has('noink')) {
      this.ink = inkPass(this.ao.depthTexture, this.ao.normalTexture, camera as OrthographicCamera);
      this.ink.uniforms.resolution.value.set(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio());
      this.ink.uniforms.warmShadows.value = warmShadows;
      composer.addPass(this.ink);
    }
    const fxPass = new RenderPass(fx, camera);
    fxPass.clear = false;
    composer.addPass(fxPass);
    const bloom = new UnrealBloomPass(size, 0.5, 0.4, 0.9);
    // Light mode: the bloom at half resolution. The composer sizes every pass to the screen (on addPass and on
    // resize), so the halving goes in the pass's own setSize.
    if (light) {
      const full = bloom.setSize.bind(bloom);
      bloom.setSize = (w, h) => full(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    }
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    if (!light) composer.addPass(new SMAAPass());
    this.composer = composer;
  }

  /**
   * The moyenne level: no ambient occlusion shading. The pass still draws the scene's depth and normals, which the ink
   * lines are found in, but no longer works the occlusion out, smooths it and lays it over the picture (three
   * full-screen passes, the heaviest of the light post-processing on a phone's graphics chip). What goes: the soft
   * darkening where things meet the ground and each other.
   */
  noOcclusion(): void {
    if (!this.ao) return;
    const ao = this.ao as unknown as { _overrideVisibility(): void; _restoreVisibility(): void; _renderOverride(r: WebGLRenderer, m: Material, t: WebGLRenderTarget, color: number, alpha: number): void; normalRenderTarget: WebGLRenderTarget };
    this.ao.render = (renderer) => {
      ao._overrideVisibility();
      ao._renderOverride(renderer, this.ao!.normalMaterial, ao.normalRenderTarget, 0x7777ff, 1.0);
      ao._restoreVisibility();
    };
    this.ao.needsSwap = false; // it writes nothing to the picture
  }

  setSize(w: number, h: number): void {
    // The composer keeps a pixel ratio of its own, taken when it was made: the renderer's may have changed since (the
    // window moved to a screen of another density, or the basse level's cap), and its buffers would stay at the old one.
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    this.ink?.uniforms.resolution.value.set(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
  }

  /** The ambient occlusion's depth-and-normal material, drawn over the whole scene: the warm-up draws with it too
   * (render/prewarm.ts), or its skinned variant compiled when the first animated character came into view. */
  get normalMaterial(): Material | null {
    return this.ao?.normalMaterial ?? null;
  }

  /** Where the scene itself is drawn: the composer's buffer, else the screen. Its programs differ (tone mapping,
   * colour space), so the scene is compiled there. */
  get sceneTarget(): WebGLRenderTarget | null {
    return this.composer?.readBuffer ?? null;
  }

  render(): void {
    this.renderer.shadowMap.needsUpdate = true;
    if (this.composer) this.composer.render();
    else {
      this.renderer.render(this.scene, this.camera);
      if (this.xray) drawXray(this.renderer, this.scene, this.camera);
      this.renderer.autoClear = false;
      this.renderer.render(this.fx, this.camera);
      this.renderer.autoClear = true;
    }
  }
}
