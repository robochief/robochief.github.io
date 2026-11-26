// Shared by the scroll showcase (viewer.js) and the free 3D view (explore.js).
import * as THREE from 'three';

// Explode distance per part (node name prefix before "__"): [radial outward, up] in metres.
// First match wins, so motor_holder_ must come before motor_.
export const EXPLODE = [
  [/^top_alu_plate/, 0, 0.33],
  [/^(wall_|tu_|fraunhofer|flw|iml)/, 0.15, 0.06],
  [/^wheel_/, 0.20, 0],
  [/^motor_holder_/, 0.10, 0],
  [/^motor_/, 0.03, 0.02],
  [/^hub_top/, 0, 0.12],
  [/^rt_core/, 0, 0.17], // just above the hub cap, low enough to be seen under the raised top plate
  [/^battery_holder_/, 0.05, 0.03],
  [/^battery_/, 0.05, 0.13],
  [/^lattepanda_board/, 0.15, 0], // out past the top plate's edge, and below rt_core so their callout lines don't cross
  [/^lattepanda_body/, 0.06, 0],
];

// Group the model's meshes by part and work out each part's explode offset.
// -> { name: { meshes, base positions, box, center, offset } }
export function prepareParts(root) {
  root.updateMatrixWorld(true); // Box3 below needs world matrices before the first render
  const byPart = {};
  root.traverse((o) => {
    if (o.isMesh) (byPart[o.name.split('__')[0]] ??= []).push(o);
  });
  const parts = {};
  for (const [name, meshes] of Object.entries(byPart)) {
    const rule = EXPLODE.find(([re]) => re.test(name)) ?? [null, 0, 0];
    const box = new THREE.Box3();
    meshes.forEach((m) => box.expandByObject(m));
    const center = box.getCenter(new THREE.Vector3());
    const radial = new THREE.Vector3(center.x, 0, center.z);
    radial.length() > 0.01 ? radial.normalize() : radial.set(0, 0, 0); // centred parts only move up
    const offset = radial.multiplyScalar(rule[1]).add(new THREE.Vector3(0, rule[2], 0));
    parts[name] = { meshes, base: meshes.map((m) => m.position.clone()), box, center, offset };
  }
  return parts;
}

// e = 0 assembled .. 1 fully exploded
export function setExplode(parts, e) {
  for (const q of Object.values(parts)) q.meshes.forEach((m, i) => m.position.copy(q.base[i]).addScaledVector(q.offset, e));
}

// What each part is, shown on hover. First match wins.
const INFO = [
  [/^top_alu_plate/, 'Top plate', 'Black aluminium deck, carries up to 25 kg of payload.'],
  [/^bottom_steel_plate/, 'Bottom plate', 'Steel chassis base: everything else bolts onto it.'],
  [/^(wall_|tu_|fraunhofer|flw|iml)/, 'Body panel', '3D-printed side panel.'],
  [/^wheel_/, 'Omni wheel', '100 mm, with free rollers so it can slide sideways. Three at 120° make the kiwi drive.'],
  [/^motor_holder_/, 'Motor holder', '3D-printed mount that fixes a motor to the chassis.'],
  [/^motor_/, 'Drive motor', 'Brushless DC motor with a 4.3:1 planetary gearbox.'],
  [/^hub_/, 'Centre hub', '3D-printed hub that ties the three motor mounts together.'],
  [/^rt_core/, 'Real-time core (optional)', 'Microcontroller board for low-latency motor control.'],
  [/^battery_holder_/, 'Battery holder', '3D-printed holder for an 18 V tool battery.'],
  [/^battery_/, '18 V tool battery', 'One of two packs in series, for a 36 V bus and 8 h of mixed use.'],
  [/^lattepanda_board/, 'Compute', 'Single-board computer, x86 or ARM.'],
  [/^lattepanda_body/, 'Compute housing', '3D-printed enclosure for the main computer.'],
];

// Hover (or tap) a part to highlight it and show what it is, while active() is true.
// Returns a function to call every frame, so the tooltip follows scrolling and auto-rotation.
export function hoverInfo(camera, canvas, parts, active) {
  const tip = document.createElement('div');
  Object.assign(tip.style, {
    position: 'fixed', pointerEvents: 'none', display: 'none', maxWidth: '16rem', padding: '0.5rem 0.75rem',
    background: 'rgba(255,255,255,0.95)', border: '1px solid #ddd', borderRadius: '6px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.12)', fontSize: '0.85rem', lineHeight: 1.35, color: '#555', zIndex: 10,
  });
  document.body.appendChild(tip);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), glow = new Map();
  let pointer = null, lit = null;
  const track = (ev) => (pointer = { x: ev.clientX, y: ev.clientY });
  canvas.addEventListener('pointermove', track);
  canvas.addEventListener('pointerdown', track); // touch: tap to inspect
  canvas.addEventListener('pointerleave', (ev) => ev.pointerType === 'mouse' && (pointer = null));

  const light = (name, on) => parts[name]?.meshes.forEach((m) => {
    if (on) {
      m.userData.mat ??= m.material;
      if (!glow.has(m.userData.mat)) glow.set(m.userData.mat, Object.assign(m.userData.mat.clone(), { emissive: new THREE.Color(0x335577) }));
      m.material = glow.get(m.userData.mat);
    } else if (m.userData.mat) m.material = m.userData.mat;
  });

  return () => {
    let hit = null;
    if (pointer && active()) {
      const r = canvas.getBoundingClientRect();
      ndc.set((pointer.x - r.left) / r.width * 2 - 1, -(pointer.y - r.top) / r.height * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const meshes = Object.values(parts).flatMap((q) => q.meshes);
      hit = ray.intersectObjects(meshes, false)[0]?.object.name.split('__')[0] ?? null;
    }
    if (hit !== lit) {
      if (lit) light(lit, false);
      if (hit) light(hit, true);
      lit = hit;
      const info = hit && INFO.find(([re]) => re.test(hit));
      tip.innerHTML = info ? `<b style="color:#222">${info[1]}</b><br>${info[2]}` : '';
      tip.style.display = info ? 'block' : 'none';
      canvas.style.cursor = hit ? 'help' : '';
    }
    if (hit) {
      const x = Math.min(pointer.x + 14, window.innerWidth - tip.offsetWidth - 8);
      Object.assign(tip.style, { left: `${Math.max(8, x)}px`, top: `${Math.max(8, pointer.y - tip.offsetHeight - 14)}px` });
    }
  };
}
