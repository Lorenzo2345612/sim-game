// Verifies Rapier heightfield layout/orientation, trimesh ground, and per-wheel ground collider detection.
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); w.timestep = 1 / 120;
// heightfield: nrows x ncols subdivisions => (nrows+1)*(ncols+1) heights; scale = full size
const nr = 2, nc = 4, H = new Float32Array((nr + 1) * (nc + 1));
// height = 10 at one corner to detect layout: set index k and probe where it lands
H[1] = 10; // test: which world point gets the bump?
const hf = w.createCollider(RAPIER.ColliderDesc.heightfield(nr, nc, H, { x: 40, y: 1, z: 40 }));
w.step();
const probe = (x, z) => { const r = w.castRay(new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true); return r ? (50 - r.timeOfImpact).toFixed(2) : 'miss'; };
const pts = [];
for (const x of [-20, 0, 20]) for (const z of [-20, -10, 0, 10, 20]) { const h = probe(x * 0.999, z * 0.999); if (h !== '0.00') pts.push(`(${x},${z})=${h}`); }
console.log('H[1]=10 lands at:', pts.join(' '));
H.fill(0); H[nc + 1] = 10;
const w2 = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
w2.createCollider(RAPIER.ColliderDesc.heightfield(nr, nc, H, { x: 40, y: 1, z: 40 })); w2.step();
const probe2 = (x, z) => { const r = w2.castRay(new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true); return r ? (50 - r.timeOfImpact).toFixed(2) : 'miss'; };
const pts2 = [];
for (const x of [-20, 0, 20]) for (const z of [-20, -10, 0, 10, 20]) { const h = probe2(x * 0.999, z * 0.999); if (h !== '0.00') pts2.push(`(${x},${z})=${h}`); }
console.log(`H[${nc + 1}]=10 lands at:`, pts2.join(' '));

// Trimesh ground with two surfaces + vehicle: which collider does each wheel touch?
const w3 = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); w3.timestep = 1 / 120;
const quad = (x0, x1, z0, z1, y) => RAPIER.ColliderDesc.trimesh(new Float32Array([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1]), new Uint32Array([0, 2, 1, 0, 3, 2]));
const asphalt = w3.createCollider(quad(0, 50, -50, 50, 0));   // right half (x>0)
const grass = w3.createCollider(quad(-50, 0, -50, 50, 0));    // left half (x<0)
const b = w3.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.6, 0).setCanSleep(false));
w3.createCollider(RAPIER.ColliderDesc.cuboid(0.8, 0.2, 2).setMass(650), b);
const v = w3.createVehicleController(b);
for (const p of [[-0.8, 0, -1.3], [0.8, 0, -1.3], [-0.8, 0, 1.25], [0.8, 0, 1.25]]) v.addWheel({ x: p[0], y: p[1], z: p[2] }, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, 0.12, 0.33);
for (let i = 0; i < 4; i++) v.setWheelSuspensionStiffness(i, 60);
for (let k = 0; k < 120; k++) { v.updateVehicle(1 / 120); w3.step(); }
console.log('wheel ground:', [0, 1, 2, 3].map(i => { const g = v.wheelGroundObject(i); return g ? (g.handle === asphalt.handle ? 'asphalt' : g.handle === grass.handle ? 'grass' : 'other') : 'none'; }).join(' '), 'y', b.translation().y.toFixed(3));
// trimesh winding check: ray from above hits both windings?
console.log('trimesh hit from above:', w3.castRay(new RAPIER.Ray({ x: 10, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }), 10, true) ? 'yes' : 'no');
