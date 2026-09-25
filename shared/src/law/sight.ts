// What a member of staff sees: someone within his range, inside the cone in front of him, in the
// same room (plan.ts: walls block sight, doorways too). Close up he notices you whichever way he
// faces. On a detour he is busy with whoever he went to and sees nobody else.

import { roomAt } from './plan.ts';
import type { Pose, StaffSpec } from './patrol.ts';

/** Within this many metres he notices you from any side. */
export const AWARE = 1.6;

export function sees(spec: StaffSpec, pose: Pose, x: number, z: number): boolean {
  if (pose.busy) return false;
  const dx = x - pose.x;
  const dz = z - pose.z;
  const d = Math.hypot(dx, dz);
  if (d > spec.range) return false;
  const room = roomAt(pose.x, pose.z);
  if (room === null || room !== roomAt(x, z)) return false;
  if (d <= AWARE) return true;
  return (dx * Math.sin(pose.yaw) + dz * Math.cos(pose.yaw)) / d >= Math.cos(spec.half);
}
