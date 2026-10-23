// Dev page for the floor's post pass on its own (bloom.ts): a small dark room with lit and unlit
// things in it, drawn through the same Bloom as the floor, with no floor to build:
//   /casino/src/world/dev-floor-post.html?quality=high|low&room=pit|online|...&film=0&glow=0
// (`room`: whose grade, bloom.ts GRADES). `window.post` has the Bloom and the engine.

import * as THREE from 'three';
import { Engine3D, type Quality } from '../render/engine3d.ts';
import { setGraphicsPref } from '../render/graphics.ts';
import { Bloom, PixelRatio } from './bloom.ts';
import { shadowGeometry, shadowMaterial, shadowTexture, boxReach } from './grounding.ts';

const q = new URLSearchParams(location.search);
const quality: Quality = q.get('quality') === 'low' ? 'low' : 'high';
if (q.get('film') === '0') setGraphicsPref('film', false);
if (q.get('glow') === '0') setGraphicsPref('glow', false);
const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, quality, { antialias: false });
const scene = engine.scene;
scene.add(new THREE.HemisphereLight('#ffd6a6', '#3a1810', 1.2));
const key = new THREE.SpotLight('#ffcf94', 40, 14, 0.8, 0.6, 1.6);
key.position.set(0, 4, 2);
key.target.position.set(0, 0.6, 0);
scene.add(key, key.target);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#5a1a20' }));
scene.add(floor);
const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 4).translate(0, 2, -3), new THREE.MeshLambertMaterial({ color: '#2a1012' }));
scene.add(wall);
// a table, its shadow, a brass rail, a white card under the light, neon past the bloom's threshold
const table = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 1).translate(0, 0.8, 0), new THREE.MeshStandardMaterial({ color: '#1f5a3d', roughness: 0.9 }));
const rail = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.03, 8, 40).rotateX(Math.PI / 2).translate(0, 0.88, 0), new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 1, roughness: 0.4 }));
const card = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.17).rotateX(-Math.PI / 2).translate(0.3, 0.865, 0.1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }));
const neon = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.04).translate(0, 2.6, -2.95), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff47b8').multiplyScalar(3) }));
const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12).translate(-1.6, 1.6, -1), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff0d0').multiplyScalar(2.6) }));
const shadow = new THREE.Mesh(shadowGeometry({ x: 0, z: 0, yaw: 0, reach: boxReach(2, 1, 24), k: 0.58, spread: 0.19, core: 0.82, room: '' }), shadowMaterial(shadowTexture()));
shadow.renderOrder = -1;
scene.add(table, rail, card, neon, bulb, shadow);
engine.camera.position.set(2.4, 1.9, 3.4);
engine.camera.lookAt(0, 0.9, -0.4);

const bloom = new Bloom(engine);
bloom.setEnabled(quality === 'high');
bloom.setRoom(q.get('room') ?? 'pit');
const pr = new PixelRatio(engine.renderer, engine.maxPixelRatio);
pr.set(quality === 'high');
engine.onFrame((dt) => {
  engine.renderer.info.reset();
  bloom.update(dt);
});
(window as unknown as { post: unknown }).post = { bloom, engine, THREE };
