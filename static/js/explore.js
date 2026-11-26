// Free 3D view: orbit, zoom, and an explode slider.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { prepareParts, setExplode, hoverInfo } from './explode.js';

const el = document.getElementById('viewer');
const slider = document.getElementById('explode');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // transparent: page background shows through
renderer.setPixelRatio(window.devicePixelRatio);
el.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10);
camera.position.set(0.95, 0.75, 0.95);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.12, 0);
controls.enableDamping = true;
controls.autoRotate = true;
controls.minDistance = 0.4;
controls.maxDistance = 4;
controls.addEventListener('start', () => (controls.autoRotate = false));

new ResizeObserver(() => {
  renderer.setSize(el.clientWidth, el.clientHeight);
  camera.aspect = el.clientWidth / el.clientHeight;
  // portrait screens: back off so the exploded robot fits the width
  camera.position.setLength(Math.max(1.5, 1.5 * 0.8 / camera.aspect));
  camera.updateProjectionMatrix();
}).observe(el);

let parts = {};
let hover = () => {};
new GLTFLoader().load('./static/models/robochief.glb', (gltf) => {
  scene.add(gltf.scene);
  parts = prepareParts(gltf.scene);
  setExplode(parts, +slider.value);
  hover = hoverInfo(camera, renderer.domElement, parts, () => true);
});
slider.addEventListener('input', () => setExplode(parts, +slider.value));

renderer.setAnimationLoop(() => {
  controls.update();
  hover();
  renderer.render(scene, camera);
});
