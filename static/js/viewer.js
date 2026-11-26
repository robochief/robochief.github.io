import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { prepareParts, setExplode, hoverInfo } from './explode.js';

// Spec callouts pinned to parts once the robot is exploded. Optional third entry forces placement:
// side ('left'/'right') on landscape screens, band ('top'/'bottom') on portrait ones.
const CALLOUTS = [
  ['top_alu_plate', '<b>25 kg payload</b>'],
  ['lattepanda_board', '<b>x86 + ARM compute</b>', { band: 'top' }],
  ['rt_core', '<b>Optional real-time core</b>', { side: 'left', band: 'bottom' }],
  ['battery_left', '<b>Dual 36 V tool batteries</b><br>8 h mixed use', { band: 'bottom' }],
  ['wheel_front', '<b>Holonomic kiwi drive</b>'],
  ['lattepanda_body', '<b>3D-printed parts</b><br>mounts, hub and housings'], // printed compute housing, sits on the left
];

// Scroll timeline (0..1 over #scrolly).
const STRAFE = [0.02, 0.11]; // top view: slide to the right edge, across to the left edge, back to centre
const SPIN = [0.11, 0.2]; //    then turn a full circle on the spot
const TURN = [0.22, 0.48]; //   camera turns from top view to oblique
const SPLIT = [0.5, 0.8]; //    explode
const LABELS = [0.8, 0.86]; //  callouts fade in, then hold to the end
// Camera on a sphere around TARGET. Top view has the robot's front (+x) pointing up the screen.
const TARGET = new THREE.Vector3(0, 0.06, 0);
const FROM = { r: 2.0, polar: 0.001, azimuth: -Math.PI / 2 };
const TO = { r: 1.6, polar: 1.0, azimuth: 0.6 };
const TARGET_END = new THREE.Vector3(0, 0.14, 0); // exploded stack is taller

const el = document.getElementById('viewer');
const section = document.getElementById('scrolly');
const svg = document.querySelector('#callouts svg');

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

let robot = null;
let parts = {}; // name -> { meshes, base positions, box, center, offset }
let hover = () => {};
new GLTFLoader().load('./static/models/robochief.glb', (gltf) => {
  robot = gltf.scene;
  scene.add(robot);
  parts = prepareParts(robot);
  hover = hoverInfo(camera, renderer.domElement, parts, () => scrollProgress() >= SPLIT[1]); // fully exploded only
});

// Callout DOM: a label plus a leader line and dot per entry.
const NS = 'http://www.w3.org/2000/svg';
const callouts = CALLOUTS.map(([part, html, { side, band } = {}]) => {
  const label = Object.assign(document.createElement('div'), { className: 'callout', innerHTML: html });
  document.getElementById('callouts').appendChild(label);
  const line = svg.appendChild(document.createElementNS(NS, 'line'));
  const dot = svg.appendChild(document.createElementNS(NS, 'circle'));
  dot.setAttribute('r', 3);
  return { part, side, band, label, line, dot };
});

const ease = (x) => x * x * (3 - 2 * x); // smoothstep
const phase = (p, [a, b]) => ease(THREE.MathUtils.clamp((p - a) / (b - a), 0, 1));
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const sph = new THREE.Spherical();
const v = new THREE.Vector3();
const forced = new URLSearchParams(location.search).get('p'); // ?p=0..1 pins the timeline (screenshots)

function scrollProgress() {
  if (forced !== null) return +forced;
  const r = section.getBoundingClientRect();
  return clamp(-r.top / (r.height - window.innerHeight), 0, 1);
}

function update(p) {
  const t = phase(p, TURN), e = phase(p, SPLIT), w = el.clientWidth, h = el.clientHeight;
  // Portrait screens: back off so the width fits, most during the (wide) explode.
  const fit = Math.max(1, 0.7 / camera.aspect) ** (0.5 + 0.5 * e);
  sph.set((lerp(FROM.r, TO.r, t) + 0.3 * e) * fit, lerp(FROM.polar, TO.polar, t), lerp(FROM.azimuth, TO.azimuth, t));
  // Before the section pins, lift the robot so it shows right under the title; centred once pinned.
  camera.setViewOffset(w, h, 0, clamp(section.getBoundingClientRect().top, 0, 0.2 * h), w, h);
  const target = TARGET.clone().lerp(TARGET_END, e);
  camera.position.setFromSpherical(sph).add(target);
  camera.lookAt(target);

  if (robot) {
    // Holonomic beat: +z is screen-right in the top view, so this is a pure sideways slide.
    // Amplitude = visible half-width at the robot's distance minus its radius, so it reaches the screen edges.
    const halfW = (sph.radius - 0.06) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    robot.position.z = Math.max(0, halfW - 0.26) * Math.sin(2 * Math.PI * phase(p, STRAFE));
    robot.rotation.y = 2 * Math.PI * phase(p, SPIN);
    setExplode(parts, e);
  }

  // scroll hint (fixed at the bottom) and title fade out as the viewer section scrolls up to the top
  const intro = clamp(1 - window.scrollY / section.offsetTop, 0, 1);
  document.getElementById('hint').style.opacity = intro;
  document.getElementById('title').style.opacity = intro; // title and authors fade out together
  for (const c of document.querySelectorAll('#scrolly .caption'))
    c.classList.toggle('on', p >= +c.dataset.from && p < +c.dataset.to);

  const a = phase(p, LABELS);
  document.getElementById('callouts').style.opacity = a;
  if (a && robot) placeCallouts(e, w, h);
}

// Callouts sit outside the exploded model's screen outline so they never cover it:
// side gutters on landscape screens, bands above/below on portrait ones.
const box = new THREE.Box3();
function toScreen(vec, w, h) {
  vec.project(camera);
  return [(vec.x + 1) / 2 * w, (1 - vec.y) / 2 * h];
}
function placeCallouts(e, w, h) {
  camera.updateMatrixWorld();
  let L = Infinity, R = -Infinity, T = Infinity, B = -Infinity;
  for (const q of Object.values(parts)) {
    box.copy(q.box).translate(v.copy(q.offset).multiplyScalar(e));
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      const [x, y] = toScreen(v, w, h);
      L = Math.min(L, x); R = Math.max(R, x); T = Math.min(T, y); B = Math.max(B, y);
    }
  }
  const items = callouts.filter((c) => parts[c.part]).map((c) => {
    const [x, y] = toScreen(v.copy(parts[c.part].center).addScaledVector(parts[c.part].offset, e), w, h);
    return { c, x, y, lw: c.label.offsetWidth, lh: c.label.offsetHeight };
  });
  const GAP = 8;
  if (w >= h) {
    for (const left of [true, false]) {
      let next = -Infinity; // stack labels on each side without overlap
      const onLeft = (it) => (it.c.side ? it.c.side === 'left' : it.x < (L + R) / 2);
      for (const it of items.filter((it) => onLeft(it) === left).sort((p, q) => p.y - q.y)) {
        it.lx = clamp(left ? L - 16 - it.lw : R + 16, GAP, w - it.lw - GAP);
        it.ly = clamp(Math.max(it.y - it.lh / 2, next), GAP, h - it.lh - GAP);
        next = it.ly + it.lh + GAP;
        it.ex = left ? it.lx + it.lw + 4 : it.lx - 4;
        it.ey = it.ly + it.lh / 2;
        it.align = left ? 'right' : 'left';
      }
    }
  } else {
    items.sort((p, q) => p.y - q.y);
    const half = Math.ceil(items.length / 2);
    items.forEach((it, i) => (it.top = it.c.band ? it.c.band === 'top' : i < half));
    for (const top of [true, false]) {
      let edge = top ? T - 16 : B + 16; // one row per label, stacked away from the model
      const band = items.filter((it) => it.top === top);
      for (const it of top ? band.reverse() : band) {
        it.lx = clamp(it.x - it.lw / 2, GAP, w - it.lw - GAP);
        it.ly = clamp(top ? edge - it.lh : edge, GAP, h - it.lh - GAP);
        edge = top ? it.ly - GAP : it.ly + it.lh + GAP;
        it.ex = it.lx + it.lw / 2;
        it.ey = top ? it.ly + it.lh + 4 : it.ly - 4;
        it.align = 'center';
      }
    }
  }
  for (const it of items) {
    Object.assign(it.c.label.style, { left: `${it.lx}px`, top: `${it.ly}px`, textAlign: it.align });
    Object.entries({ x1: it.x, y1: it.y, x2: it.ex, y2: it.ey }).forEach(([k, val]) => it.c.line.setAttribute(k, val));
    it.c.dot.setAttribute('cx', it.x);
    it.c.dot.setAttribute('cy', it.y);
  }
}

renderer.setAnimationLoop(() => {
  update(scrollProgress());
  hover();
  renderer.render(scene, camera);
});
