// Framing a solo player's spots. A game's play pose depends on how many spots its solo player
// plays, so the camera takes in every one of them: the app flies there when you sit down (it asks
// the game module for the pose after the view has seen the table), and the view glides there itself
// when you change the count at the table.

import * as THREE from 'three';
import type { GameId } from '../../../../shared/src/engine.ts';
import type { Pose, TableStage } from '../../table/stage.ts';
import { tween, ease } from '../../table/tween.ts';
import { fovFor } from '../../render/engine3d.ts';

const soloSpots = new Map<GameId, number>();

/** How many spots the solo player at this game plays now (one at a shared table). */
export function spotsInPlay(game: GameId): number {
  return soloSpots.get(game) ?? 1;
}

/** Record the count a view has just seen, before the app asks the module for the play pose. */
export function setSpotsInPlay(game: GameId, n: number): void {
  soloSpots.set(game, n);
}

/**
 * Glide the camera to `pose` (table-local) and make it the table's resting pose, so a view that
 * swings the camera away comes back to it.
 */
export function glideTo(stage: TableStage, pose: Pose, ms = 800): Promise<void> {
  stage.setRest(pose);
  const camera = stage.engine.camera;
  const to = stage.worldPose(pose);
  const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(to.position, to.target, camera.up));
  const p0 = camera.position.clone();
  const q0 = camera.quaternion.clone();
  return tween(ms, (k) => {
    camera.position.lerpVectors(p0, to.position, k);
    camera.quaternion.slerpQuaternions(q0, quat, k);
  }, ease.inOut);
}

/**
 * Back the camera off along its line of sight until `halfWidth` metres either side of the target
 * fit across the screen. A landscape screen already takes in a row of spots; a phone held upright
 * sees about half as wide (its view opens up and down, not across), so there it pulls back.
 */
export function fitWidth(pose: Pose, halfWidth: number, aspect = innerWidth / innerHeight): Pose {
  const tanAcross = Math.tan(THREE.MathUtils.degToRad(fovFor(aspect)) / 2) * aspect;
  const eye = new THREE.Vector3(...pose.position);
  const target = new THREE.Vector3(...pose.target);
  const d = eye.distanceTo(target);
  const need = halfWidth / tanAcross;
  if (!(tanAcross > 0) || d >= need) return pose;
  eye.sub(target).multiplyScalar(need / d).add(target);
  return { position: [eye.x, eye.y, eye.z], target: pose.target };
}
