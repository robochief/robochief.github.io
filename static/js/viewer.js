import * as THREE from 'three';
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

// Scroll timeline (0..1 over #scrolly): camera turns from top view to oblique, then the robot explodes.
const TURN = [0.0, 0.45];
const SPLIT = [0.5, 0.95];
// Camera on a sphere around TARGET. Top view has the robot's front (+x) pointing up the screen.
const TARGET = new THREE.Vector3(0, 0.06, 0);
const FROM = { r: 2.0, polar: 0.001, azimuth: -Math.PI / 2 };
const TO = { r: 1.6, polar: 1.0, azimuth: 0.6 };
const TARGET_END = new THREE.Vector3(0, 0.14, 0); // exploded stack is taller

const el = document.getElementById('viewer');
const section = document.getElementById('scrolly');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // transparent: page background shows through
renderer.setPixelRatio(window.devicePixelRatio);
el.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10);

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
});

const ease = (x) => x * x * (3 - 2 * x); // smoothstep
const phase = (p, [a, b]) => ease(THREE.MathUtils.clamp((p - a) / (b - a), 0, 1));
const lerp = THREE.MathUtils.lerp;
const sph = new THREE.Spherical();
const forced = new URLSearchParams(location.search).get('p'); // ?p=0..1 pins the timeline (screenshots)

function scrollProgress() {
  if (forced !== null) return +forced;
  const r = section.getBoundingClientRect();
  return THREE.MathUtils.clamp(-r.top / (r.height - window.innerHeight), 0, 1);
}

function update(p) {
  const t = phase(p, TURN), e = phase(p, SPLIT);
  // Portrait screens: back off so the width fits, most during the (wide) explode.
  const fit = Math.max(1, 0.7 / camera.aspect) ** (0.5 + 0.5 * e);
  sph.set((lerp(FROM.r, TO.r, t) + 0.3 * e) * fit, lerp(FROM.polar, TO.polar, t), lerp(FROM.azimuth, TO.azimuth, t));
  // Robot starts in the upper part of the pinned view (visible right under the title), centres while turning.
  const h = el.clientHeight, w = el.clientWidth;
  camera.setViewOffset(w, h, 0, 0.2 * h * (1 - t), w, h);
  const target = TARGET.clone().lerp(TARGET_END, e);
  camera.position.setFromSpherical(sph).add(target);
  camera.lookAt(target);
  for (const q of parts) q.meshes.forEach((m, i) => m.position.copy(q.base[i]).addScaledVector(q.offset, e));

  // fixed at the bottom of the screen; fades out as the viewer section scrolls up to the top
  document.getElementById('hint').style.opacity = THREE.MathUtils.clamp(1 - window.scrollY / section.offsetTop, 0, 1);
  for (const c of document.querySelectorAll('#scrolly .caption'))
    c.classList.toggle('on', p >= +c.dataset.from && p < +c.dataset.to);
}

renderer.setAnimationLoop(() => {
  update(scrollProgress());
  renderer.render(scene, camera);
});
