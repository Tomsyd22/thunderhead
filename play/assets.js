// Asset loading for the game client. The .gltf.json files embed their binary buffer as base64; rather than letting the loader
// fetch a data: URI (refused by strict content-security policies), an in-memory GLB is rebuilt from the JSON + decoded buffer.
// (Same loader as units/sandbox/app.js and play/maprender.js.)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MECH } from './engine/mech.js';

const loader = new GLTFLoader();
export async function loadGltfJson(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const js = await r.json(); let bin = new Uint8Array(0);
  if (js.buffers && js.buffers[0] && js.buffers[0].uri && js.buffers[0].uri.startsWith('data:')) {
    const b64 = js.buffers[0].uri.slice(js.buffers[0].uri.indexOf(',') + 1); const raw = atob(b64); bin = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i); delete js.buffers[0].uri;
  }
  const enc = new TextEncoder().encode(JSON.stringify(js)); const jl = (enc.length + 3) & ~3, bl = (bin.length + 3) & ~3;
  const glb = new Uint8Array(12 + 8 + jl + (bl ? 8 + bl : 0)); const dv = new DataView(glb.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, glb.length, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4E4F534A, true); glb.set(enc, 20); for (let i = enc.length; i < jl; i++) glb[20 + i] = 0x20;
  if (bl) { dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, 0x004E4942, true); glb.set(bin, 28 + jl); }
  return new Promise((res, rej) => loader.parse(glb.buffer, '', res, rej));
}

const UNIT_FILE = { HV: 'unit_harvester' };
/** unit prototypes: { scene, isSkinned, lods: [lod1, lod2] }; the harvester (+X forward maps asset) is wrapped to the units' +Y forward */
export async function loadUnitProtos(uids, base, spec, onOne) {
  const protos = {}, errors = [];
  const fix = (root) => root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && !/^(GLOW|DISC)/.test(m.name || '')) m.envMapIntensity = 0.6; });
  await Promise.all(uids.map(async (uid) => {
    try {
      const g = await loadGltfJson(`${base}${UNIT_FILE[uid] || uid}.gltf.json`); let skinned = false; g.scene.traverse((o) => { if (o.isSkinnedMesh) skinned = true; }); fix(g.scene);
      let root = g.scene; if (MECH[uid] && MECH[uid].modelFwd === 'x') { root = new THREE.Group(); g.scene.rotation.y = Math.PI / 2; root.add(g.scene); }
      protos[uid] = { scene: root, isSkinned: skinned, lods: [] };
      if (!UNIT_FILE[uid]) for (const lv of [1, 2]) { try { const gl = await loadGltfJson(`${base}${uid}_lod${lv}.gltf.json`); protos[uid].lods.push(gl.scene); } catch (e) { break; } }
    } catch (e) {
      errors.push(`model ${uid}: ${e.message || e}`); const s = spec.find((x) => x.id === uid).dimensions_m; const grp = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.width, s.height, s.length), new THREE.MeshStandardMaterial({ color: 0x888888 })); m.position.y = s.height / 2; grp.add(m); protos[uid] = { scene: grp, isSkinned: false, lods: [] };
    }
    if (onOne) onOne(uid);
  }));
  return { protos, errors };
}

/** building prototypes (maps assets, model x/y = sim x/y, z up) */
export async function loadBuildingProtos(names, base, onOne) {
  const out = {}, errors = [];
  await Promise.all(names.map(async (n) => {
    try { const g = await loadGltfJson(`${base}${n}.gltf.json`); g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; for (const m of [].concat(o.material)) if (m && 'envMapIntensity' in m) m.envMapIntensity = 0.55; } }); out[n] = g.scene; }
    catch (e) { errors.push(`building ${n}: ${e.message || e}`); }
    if (onOne) onOne(n);
  }));
  return { protos: out, errors };
}

/** engineer prototype on a rifleman's frame (round 1, until a modelled engineer exists): the rifle is replaced by a rugged
 * tool case carried at the same two grips, and a safety-yellow hard hat sits on the head bone. Shares the base's LODs
 * (the added meshes keep their LOD0 geometry at every level; the hidden rifle swaps as before). */
export function makeEngineerProto(base) {
  const scene = base.isSkinned ? SkeletonUtils.clone(base.scene) : base.scene.clone(true); let weapon = null, head = null;
  scene.traverse((o) => { if (o.name === 'weapon') weapon = o; if (o.name === 'head' && o.isBone) head = o; });
  const hat = new THREE.MeshStandardMaterial({ name: 'ENG_hat', color: 0xf2c230, roughness: 0.45, metalness: 0.05 });
  const caseM = new THREE.MeshStandardMaterial({ name: 'ENG_case', color: 0xc8501e, roughness: 0.55, metalness: 0.2 });
  const steel = new THREE.MeshStandardMaterial({ name: 'ENG_steel', color: 0x8d949b, roughness: 0.35, metalness: 0.8 });
  if (weapon) {
    weapon.traverse((o) => { if (o.isMesh) o.visible = false; });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.34), caseM); box.name = 'eng_case'; box.position.set(0, -0.13, -0.07); weapon.add(box);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.35), steel); lid.position.set(0, -0.025, -0.07); weapon.add(lid);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 12, Math.PI), steel); handle.rotation.y = Math.PI / 2; handle.position.set(0, -0.012, -0.07); weapon.add(handle);
  }
  if (head) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.122, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hat); dome.position.set(0, 0.12, 0.0); dome.scale.set(1, 0.85, 1.12); head.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.148, 0.148, 0.012, 18), hat); brim.position.set(0, 0.122, -0.018); brim.scale.set(1, 1, 1.15); head.add(brim);
  }
  for (const m of [hat, caseM, steel]) m.envMapIntensity = 0.6;
  scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { scene, isSkinned: base.isSkinned, lods: base.lods };
}
