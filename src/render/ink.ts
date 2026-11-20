import { type OrthographicCamera, type Texture, Vector2 } from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Comic-book look: dark ink lines where depth or surface direction breaks (silhouettes, creases,
 * cliff edges), then a painterly grade — richer colours, warm shadows, soft vignette and paper grain.
 * Reuses the depth and normals that the ambient-occlusion pass already rendered.
 */
export function inkPass(depth: Texture, normal: Texture, camera: OrthographicCamera): ShaderPass {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: depth },
      tNormal: { value: normal },
      resolution: { value: new Vector2(1, 1) },
      depthRange: { value: camera.far - camera.near },
      inkColor: { value: [0.09, 0.06, 0.04] },
      inkStrength: { value: 0.85 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse, tDepth, tNormal;
      uniform vec2 resolution;
      uniform float depthRange, inkStrength;
      uniform vec3 inkColor;
      varying vec2 vUv;

      float depthAt(vec2 uv) { return texture2D(tDepth, uv).r * depthRange; }
      vec3 normalAt(vec2 uv) { return texture2D(tNormal, uv).rgb * 2.0 - 1.0; }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

      void main() {
        vec2 px = 1.6 / resolution; // line width, in pixels
        float d = depthAt(vUv);
        vec3 n = normalAt(vUv);
        // Depth: second derivative catches silhouettes without lining flat slopes.
        float dl = depthAt(vUv - vec2(px.x, 0.0)), dr = depthAt(vUv + vec2(px.x, 0.0));
        float du = depthAt(vUv + vec2(0.0, px.y)), dd = depthAt(vUv - vec2(0.0, px.y));
        float depthEdge = smoothstep(0.08, 0.3, abs(dl + dr + du + dd - 4.0 * d));
        // Normals: creases between faces.
        float nEdge = 0.0;
        nEdge = max(nEdge, 1.0 - dot(n, normalAt(vUv + vec2(px.x, 0.0))));
        nEdge = max(nEdge, 1.0 - dot(n, normalAt(vUv + vec2(0.0, px.y))));
        float normalEdge = smoothstep(0.25, 0.6, nEdge);
        // Characters: their outline only, not every crease of their armour, which reads as clutter.
        normalEdge *= step(0.75, texture2D(tNormal, vUv).a);
        float edge = max(depthEdge, normalEdge * 0.75);
        // Nothing drawn (background): no ink.
        if (d >= depthRange * 0.9999) edge = 0.0;

        vec4 c = texture2D(tDiffuse, vUv);
        // Painterly grade: more saturation, warmer shadows, slightly lifted blacks.
        float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        c.rgb = mix(vec3(l), c.rgb, 1.22);
        c.rgb += vec3(0.035, 0.018, -0.01) * (1.0 - l) * smoothstep(0.0, 0.04, l); // the dark past the map's edge stays black
        c.rgb = mix(c.rgb, inkColor, edge * inkStrength);
        // Paper grain and a soft vignette.
        c.rgb *= 0.97 + 0.06 * hash(floor(vUv * resolution / 2.0));
        vec2 v = vUv - 0.5;
        c.rgb *= 1.0 - dot(v, v) * 0.35;
        gl_FragColor = c;
      }`,
  });
  return pass;
}
