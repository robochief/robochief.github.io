import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Explode distance per part (node name prefix before "__"): [radial outward, up] in metres.
// First match wins, so motor_holder_ must come before motor_.
const EXPLODE = [
  [/^top_alu_plate/, 0, 0.30],
  [/^(wall_|tu_|fraunhofer|flw|iml)/, 0.15, 0.06],
  [/^wheel_/, 0.20, 0],
  [/^motor_holder_/, 0.10, 0],
  [/^motor_/, 0.03, 0.02],
  [/^hub_top/, 0, 0.15],
  [/^battery_holder_/, 0.05, 0.03],
  [/^battery_/, 0.05, 0.13],
  [/^lattepanda_board/, 0.06, 0.18],
  [/^lattepanda_body/, 0.06, 0],
];

const el = document.getElementById('viewer');
const slider = document.getElementById('explode');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // transparent: page background shows through
renderer.setPixelRatio(window.devicePixelRatio);
el.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10);
camera.position.set(0.75, 0.6, 0.75);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.12, 0);
controls.enableDamping = true;
controls.autoRotate = true;
controls.addEventListener('start', () => (controls.autoRotate = false));

new ResizeObserver(() => {
  renderer.setSize(el.clientWidth, el.clientHeight);
  camera.aspect = el.clientWidth / el.clientHeight;
  camera.updateProjectionMatrix();
}).observe(el);

const parts = []; // { meshes, base positions, offset }
new GLTFLoader().load('./static/models/robochief.glb', (gltf) => {
  scene.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true); // Box3 below needs world matrices before the first render
  const byPart = {};
  gltf.scene.traverse((o) => {
    if (o.isMesh) (byPart[o.name.split('__')[0]] ??= []).push(o);
  });
  for (const [name, meshes] of Object.entries(byPart)) {
    const rule = EXPLODE.find(([re]) => re.test(name));
    if (!rule) continue;
    const c = new THREE.Box3();
    meshes.forEach((m) => c.expandByObject(m));
    const center = c.getCenter(new THREE.Vector3());
    const radial = new THREE.Vector3(center.x, 0, center.z);
    radial.length() > 0.01 ? radial.normalize() : radial.set(0, 0, 0); // centred parts only move up
    const offset = radial.multiplyScalar(rule[1]).add(new THREE.Vector3(0, rule[2], 0));
    parts.push({ meshes, base: meshes.map((m) => m.position.clone()), offset });
  }
  explode(+slider.value);
});

function explode(t) {
  for (const p of parts) p.meshes.forEach((m, i) => m.position.copy(p.base[i]).addScaledVector(p.offset, t));
}
slider.addEventListener('input', () => explode(+slider.value));
const initial = new URLSearchParams(location.search).get('explode');
if (initial !== null) slider.value = initial;

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
