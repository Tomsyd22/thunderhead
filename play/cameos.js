// Build-menu portraits ("cameos"): each unit and structure model rendered once at load into a small image, three-quarter
// view from the front-left, lit like the map. Returns { key: dataURL }.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { STRUCTURES } from './rules.js';

export function makeCameos(renderer, protos, bprotos, spec) {
  const W = 160, H = 120, out = {};
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 }); rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight(0xdfe9f2, 0x4a4234, 1.6)); const sun = new THREE.DirectionalLight(0xfff0dc, 2.6); sun.position.set(-4, 8, 6); scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 2000);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const g = canvas.getContext('2d'); const px = new Uint8Array(W * H * 4);
  const prevTarget = renderer.getRenderTarget(), prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha(), prevShadow = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = false;
  const shoot = (key, obj, yaw = 0.65, el = 0.42) => {
    const holder = new THREE.Group(); holder.add(obj); scene.add(holder); holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() * 0.5;
    const d = r / Math.sin(cam.fov * Math.PI / 360) * 0.92;
    cam.position.set(c.x + Math.sin(yaw) * Math.cos(el) * d, c.y + Math.sin(el) * d, c.z + Math.cos(yaw) * Math.cos(el) * d); cam.lookAt(c); cam.near = d / 50; cam.far = d * 4; cam.updateProjectionMatrix();
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    const img = g.createImageData(W, H); for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);   // flip rows
    g.clearRect(0, 0, W, H); g.putImageData(img, 0, 0); out[key] = canvas.toDataURL('image/png');
    scene.remove(holder);
  };
  for (const [uid, p] of Object.entries(protos)) {
    const o = p.isSkinned ? SkeletonUtils.clone(p.scene) : p.scene.clone(true); o.rotation.y = 0;   // units face −Z (three) = +Y (sim); we look from the front-left
    const air = ['H04', 'A04', 'T04'].includes(uid); shoot(uid, o, 2.5, air ? 0.5 : 0.36);
  }
  for (const [k, S] of Object.entries(STRUCTURES)) {
    let o = bprotos[S.model] ? bprotos[S.model].clone(true) : null;
    if (!o && k === 'airpad') { o = new THREE.Group(); const pad = new THREE.Mesh(new THREE.BoxGeometry(26, 0.6, 26), new THREE.MeshStandardMaterial({ color: 0x8e8c86 })); o.add(pad); const ring = new THREE.Mesh(new THREE.RingGeometry(8, 9, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8e2c8 })); ring.position.y = 0.35; o.add(ring); const hut = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3), new THREE.MeshStandardMaterial({ color: 0x6d7378 })); hut.position.set(10, 1.5, 10); o.add(hut); }
    if (!o) continue; shoot(k, o, 0.7, 0.55);   // doors face model −y (three +z): look from the front
  }
  renderer.setRenderTarget(prevTarget); renderer.setClearColor(prevClear, prevAlpha); renderer.shadowMap.enabled = prevShadow; rt.dispose();
  void spec; return out;
}
