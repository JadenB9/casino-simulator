// The DOM labels over the 3D scene (name tags, speech and emote bubbles, a table's totals): what
// three's CSS2DRenderer draws, for the CSS2DObjects it makes, at a fraction of its cost.
//
// CSS2DRenderer brings the whole scene's matrices up to date again after the WebGL render has just
// done it, walks every object in the scene every frame (thousands on the floor, hidden ones
// included, writing `display: none` to each hidden label again), then walks the scene once more to
// stack the labels. This walks only what is shown, reuses the render's matrices (Engine3D draws the
// labels straight after the scene), hides a label once when it drops out rather than every frame,
// and touches an element's style only when what it shows changes. Labels look and stack exactly as
// CSS2DRenderer places them (the same transform, `center`, `rotation2D` and z-order).

import * as THREE from 'three';
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

interface Drawn {
  transform: string;
  z: number;
  /** Squared distance to the camera this frame, for the stacking order. */
  d: number;
}

const _v = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _vp = new THREE.Matrix4();

export class Labels {
  readonly domElement: HTMLElement;
  private width = 0;
  private height = 0;
  /** Labels drawn last frame and what was last written to each. */
  private drawn = new Map<CSS2DObject, Drawn>();
  private next = new Map<CSS2DObject, Drawn>();
  private readonly order: CSS2DObject[] = [];
  private readonly stack: THREE.Object3D[] = [];

  constructor(opts: { element?: HTMLElement } = {}) {
    this.domElement = opts.element ?? document.createElement('div');
    this.domElement.style.overflow = 'hidden';
  }

  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.domElement.style.width = `${width}px`;
    this.domElement.style.height = `${height}px`;
  }

  /** Draw the labels shown in `scene`; call straight after rendering it (its matrices are this frame's). */
  render(scene: THREE.Object3D, camera: THREE.Camera): void {
    _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _cam.setFromMatrixPosition(camera.matrixWorld);
    const hw = this.width / 2;
    const hh = this.height / 2;
    const next = this.next;
    const order = this.order;
    order.length = 0;
    const stack = this.stack;
    stack.length = 0;
    if (scene.visible) stack.push(scene);
    while (stack.length) {
      const o = stack.pop()!;
      const children = o.children;
      for (let i = children.length - 1; i >= 0; i--) if (children[i]!.visible) stack.push(children[i]!);
      if (!(o as { isCSS2DObject?: boolean }).isCSS2DObject) continue;
      const label = o as CSS2DObject;
      _v.setFromMatrixPosition(label.matrixWorld).applyMatrix4(_vp);
      if (_v.z < -1 || _v.z > 1 || !label.layers.test(camera.layers)) continue;
      label.onBeforeRender(this, scene as THREE.Scene, camera);
      const el = label.element;
      const cx = 100 * label.center.x;
      const cy = 100 * label.center.y;
      const transform = `translate(${-cx}%, ${-cy}%) translate(${_v.x * hw + hw}px, ${-_v.y * hh + hh}px) rotate(${-label.rotation2D}rad)`;
      const was = this.drawn.get(label);
      if (!was) el.style.display = '';
      if (was?.transform !== transform) {
        el.style.transformOrigin = `${cx}% ${cy}%`;
        el.style.transform = transform;
      }
      if (el.parentNode !== this.domElement) this.domElement.appendChild(el);
      label.onAfterRender(this, scene as THREE.Scene, camera);
      next.set(label, { transform, z: was?.z ?? -1, d: _v.setFromMatrixPosition(label.matrixWorld).distanceToSquared(_cam) });
      order.push(label);
    }
    // what was drawn last frame and isn't now (hidden, behind the camera, taken off the scene)
    for (const label of this.drawn.keys()) if (!next.has(label)) label.element.style.display = 'none';
    // nearest on top, as CSS2DRenderer stacks them (a higher renderOrder first)
    order.sort((a, b) => (a.renderOrder !== b.renderOrder ? b.renderOrder - a.renderOrder : next.get(a)!.d - next.get(b)!.d));
    for (let i = 0; i < order.length; i++) {
      const d = next.get(order[i]!)!;
      const z = order.length - i;
      if (d.z !== z) {
        d.z = z;
        order[i]!.element.style.zIndex = String(z);
      }
    }
    this.drawn.clear();
    this.next = this.drawn;
    this.drawn = next;
  }
}
