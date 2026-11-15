import {
  AmbientLight, BoxGeometry, Color, DirectionalLight, GridHelper, Mesh,
  MeshStandardMaterial, PCFSoftShadowMap, PlaneGeometry, Scene, WebGLRenderer,
} from 'three';
import { createIsoCamera } from './camera';

const VIEW_HEIGHT = 24;

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x1b1f24);

const ground = new Mesh(new PlaneGeometry(64, 64), new MeshStandardMaterial({ color: 0x4a5a3a }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground, new GridHelper(64, 64, 0x000000, 0x334028));

// Placeholder block standing in for a building until M1+.
const block = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial({ color: 0x3a6ea5 }));
block.position.y = 1;
block.castShadow = true;
scene.add(block);

scene.add(new AmbientLight(0xffffff, 0.6));
const sun = new DirectionalLight(0xffffff, 2);
sun.position.set(-10, 20, 8);
sun.castShadow = true;
scene.add(sun);

const camera = createIsoCamera(window.innerWidth / window.innerHeight, VIEW_HEIGHT);

function resize(): void {
  const aspect = window.innerWidth / window.innerHeight;
  const h = VIEW_HEIGHT / 2;
  camera.left = -h * aspect;
  camera.right = h * aspect;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => renderer.render(scene, camera));
