import RAPIER from '@dimforge/rapier3d-compat';

export const WORLD_SCALE = 0.045;

export class PlanarRapierBody {
  constructor(world, body) {
    this.world = world;
    this.body = body;
  }

  static async create({ mass, radius }) {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = 1 / 60;
    const descriptor = RAPIER.RigidBodyDesc.dynamic()
      .setCanSleep(false)
      .setAdditionalMass(mass)
      .enabledTranslations(true, false, true)
      .enabledRotations(false, true, false);
    const body = world.createRigidBody(descriptor);
    const collider = RAPIER.ColliderDesc.ball(radius * WORLD_SCALE)
      .setFriction(0.38)
      .setRestitution(0.32);
    world.createCollider(collider, body);
    return new PlanarRapierBody(world, body);
  }

  syncFromPlanar(raft, dt = 1 / 60) {
    const yaw = -raft.angle;
    this.world.timestep = Math.max(1 / 120, Math.min(1 / 30, dt));
    this.body.setTranslation({ x: (raft.x - 500) * WORLD_SCALE, y: 0, z: raft.y * WORLD_SCALE }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: raft.vx * WORLD_SCALE, y: 0, z: raft.vy * WORLD_SCALE }, true);
    this.body.setAngvel({ x: 0, y: -raft.angularVelocity, z: 0 }, true);
    this.world.step();

    const position = this.body.translation();
    const rotation = this.body.rotation();
    const velocity = this.body.linvel();
    const angularVelocity = this.body.angvel();
    return {
      x: position.x / WORLD_SCALE + 500,
      y: position.z / WORLD_SCALE,
      angle: -2 * Math.atan2(rotation.y, rotation.w),
      vx: velocity.x / WORLD_SCALE,
      vy: velocity.z / WORLD_SCALE,
      angularVelocity: -angularVelocity.y,
    };
  }

  dispose() {
    this.world.free();
  }
}
