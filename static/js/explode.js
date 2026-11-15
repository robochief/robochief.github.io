// Shared by the scroll showcase (viewer.js) and the free 3D view (explore.js).
import * as THREE from 'three';

// Explode distance per part (node name prefix before "__"): [radial outward, up] in metres.
// First match wins, so motor_holder_ must come before motor_.
export const EXPLODE = [
  [/^top_alu_plate/, 0, 0.33],
  [/^(wall_|tu_|fraunhofer|flw|iml)/, 0.15, 0.06],
  [/^wheel_/, 0.20, 0],
  [/^motor_holder_/, 0.10, 0],
  [/^vesc_/, 0.10, 0.035], // lifts just clear of its holder, low enough not to hide the real-time core
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
