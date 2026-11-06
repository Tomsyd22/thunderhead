// Ore field visuals: gold ore clumps on every patch (three per patch, instanced) over a dark ore-stained ground disc.
// Clumps shrink as a patch is mined and grow back as it regrows; an empty patch shows bare ground. One draw call for the
// clumps and one for the stains across the whole map; instance matrices are rewritten at most four times a second.
import * as THREE from 'three';

const PER = 3;
export class OreView {
  constructor(scene, T, ore) {
    this.ore = ore; this.T = T; const cells = this.cells = ore.fields.flatMap((F) => F.cells); const n = cells.length;
    const rock = new THREE.IcosahedronGeometry(1, 0); rock.translate(0, 0.35, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.45, flatShading: true, emissive: 0x3a2400, emissiveIntensity: 0.35 });
    this.clumps = new THREE.InstancedMesh(rock, mat, n * PER); this.clumps.castShadow = true; this.clumps.receiveShadow = true; this.clumps.name = 'ore_clumps';
    const disc = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
    const smat = new THREE.MeshStandardMaterial({ color: 0x5b4518, roughness: 0.95, metalness: 0, transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.stains = new THREE.InstancedMesh(disc, smat, n); this.stains.receiveShadow = true; this.stains.renderOrder = 1; this.stains.name = 'ore_stains';
    const col = new THREE.Color(); this.base = [];
    cells.forEach((c, i) => {
      const h = Math.max(T.height(c.x, c.y), 0); c.h = h;
      for (let k = 0; k < PER; k++) {   // fixed per-patch layout (seeded by the patch), so clumps don't jump as they shrink
        const a = c.rot + k * 2.1, r = 0.4 + 0.75 * ((k * 0.37 + c.ox * 0.3 + 0.5) % 1), sz = 0.55 + 0.45 * ((k * 0.61 + c.oy * 0.4 + 0.5) % 1);
        const bx = c.x + c.ox + Math.cos(a) * r * 1.4, by = c.y + c.oy + Math.sin(a) * r * 1.4; this.base.push({ x: bx, y: by, z: Math.max(T.height(bx, by), 0) - 0.1, sz, yaw: a * 1.7, tilt: (k - 1) * 0.25 });
        col.setHSL(0.105 + 0.02 * ((k + i) % 3 - 1), 0.78, 0.36 + 0.07 * (k % 2)); this.clumps.setColorAt(i * PER + k, col);
      }
    });
    scene.add(this.stains); scene.add(this.clumps); this.acc = 1; this.update(0, true);
  }
  update(dt, force = false) {
    this.acc += dt; if (!force && (this.acc < 0.25 || !this.ore.dirty)) return; this.acc = 0; this.ore.dirty = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), min = this.ore.E.min_patch;
    this.cells.forEach((c, i) => {
      const f = c.max > 0 ? Math.max(0, c.amt / c.max) : 0, on = c.amt >= min;
      const k0 = on ? 0.3 + 0.7 * Math.sqrt(f) : 0, sd = on ? 1.6 + 1.2 * Math.sqrt(f) : 0.001;
      p.set(c.x, c.h + 0.02, -c.y); s.set(sd, 1, sd); m.compose(p, q.identity(), s); this.stains.setMatrixAt(i, m);
      for (let k = 0; k < PER; k++) { const b = this.base[i * PER + k], z = b.sz * k0 * 0.95;
        p.set(b.x, b.z, -b.y); e.set(b.tilt, b.yaw, b.tilt * 0.5); q.setFromEuler(e); s.set(z, z * 0.62, z * 0.9); m.compose(p, q, s); this.clumps.setMatrixAt(i * PER + k, m); }
    });
    this.clumps.instanceMatrix.needsUpdate = true; this.stains.instanceMatrix.needsUpdate = true;
    if (this.clumps.instanceColor) this.clumps.instanceColor.needsUpdate = true;
  }
  dispose(scene) { scene.remove(this.clumps); scene.remove(this.stains); }
}
