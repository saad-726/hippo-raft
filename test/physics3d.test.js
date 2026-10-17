import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Group } from 'three';
import { getSeatPose } from '../shared/physics.js';
import { PlanarRapierBody, WORLD_SCALE } from '../client/src/game/physics3d.js';

test('Rapier adapter keeps raft motion planar and preserves yaw spin', async () => {
  const body = await PlanarRapierBody.create({ mass: 12, radius: 62 });
  try {
    const pose = body.syncFromPlanar({
      x: 520,
      y: 100,
      vx: 0,
      vy: 20,
      angle: 0.4,
      angularVelocity: 0.2,
    });
    assert.ok(Math.abs(pose.x - 520) < 1e-4);
    assert.ok(Math.abs(pose.y - (100 + 20 / 60)) < 1e-3);
    assert.ok(Math.abs(pose.angle - (0.4 + 0.2 / 60)) < 0.01);
    assert.ok(Math.abs(pose.vy - 20) < 1e-4);
    assert.ok(Math.abs(pose.angularVelocity - 0.2) < 1e-4);
  } finally {
    body.dispose();
  }
});

// Regression test for the rotation sign bug.
// The raft group is rotated by -simAngle (sign flip required by Three.js handedness).
// Hippos are children at their seat offsets in local space.
// The test asserts that the hippo's world position matches getSeatPose at several angles.
test('raftGroup rotation sign puts each hippo at its correct world position', () => {
  const angles = [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3];

  for (const simAngle of angles) {
    const raftState = { x: 500, y: 200, angle: simAngle };

    // Reproduce what draw() does: position and rotate raftGroup, then place hippos.
    const raftGroup = new Group();
    raftGroup.position.set(0, 0, 0); // raft at world origin for simplicity
    raftGroup.rotation.y = -simAngle; // the fixed sign
    raftGroup.updateMatrixWorld(true);

    for (let playerId = 0; playerId < 4; playerId += 1) {
      const seat = getSeatPose({ x: 0, y: 0, angle: 0 }, playerId);
      const hippo = new Group();
      hippo.position.set(seat.offset.x * WORLD_SCALE, 0, seat.offset.y * WORLD_SCALE);
      raftGroup.add(hippo);
      raftGroup.updateMatrixWorld(true);

      const worldPos = new Vector3();
      hippo.getWorldPosition(worldPos);

      // The physics seat at the given sim angle
      const physSeat = getSeatPose(raftState, playerId);
      // Map sim coords to Three.js world coords (same as toWorld but with raft at origin)
      const expectedX = (physSeat.position.x - raftState.x) * WORLD_SCALE;
      const expectedZ = (physSeat.position.y - raftState.y) * WORLD_SCALE;

      assert.ok(
        Math.abs(worldPos.x - expectedX) < 0.01,
        `angle=${simAngle.toFixed(3)} playerId=${playerId}: x mismatch ${worldPos.x.toFixed(4)} vs ${expectedX.toFixed(4)}`,
      );
      assert.ok(
        Math.abs(worldPos.z - expectedZ) < 0.01,
        `angle=${simAngle.toFixed(3)} playerId=${playerId}: z mismatch ${worldPos.z.toFixed(4)} vs ${expectedZ.toFixed(4)}`,
      );
    }
  }
});
