// Framing a solo player's spots. A game's play pose depends on how many spots its solo player
// plays, so the camera takes in every one of them: the app flies there when you sit down (it asks
// the game module for the pose after the view has seen the table), and the view glides there itself
// when you change the count at the table.

import * as THREE from 'three';
import type { GameId } from '../../../../shared/src/engine.ts';
import type { Pose, TableStage } from '../../table/stage.ts';
import { tween, ease } from '../../table/tween.ts';

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
