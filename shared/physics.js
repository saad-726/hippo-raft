export const CONFIG = {
  raftRadius: 62,
  mass: 12,
  thrustImpulse: 760,
  thrustDuration: 0.25,
  cooldown: 0.6,
  tangentialOffset: 20,
  tangentialBias: 0,
  thrustAttack: 0.025,
  thrustDecay: 0.09,
  linearDamp: 0.14,
  angDamp: 1.05,
  maxSpeed: 230,
  maxAngSpeed: 5.5,
  currentStrength: 4,
  wallRestitution: 0.4,
  spikeRestitution: 0.72,
  knockback: 85,
  invulnTime: 1,
  collisionFriction: 0.28,
  fixedStep: 1 / 60,
};

Object.defineProperties(CONFIG, {
  raftWidth: { get() { return this.raftRadius * 2; } },
  raftHeight: { get() { return this.raftRadius * 2; } },
  fartImpulse: { get() { return this.thrustImpulse; }, set(value) { this.thrustImpulse = value; } },
  fartCooldown: { get() { return this.cooldown; }, set(value) { this.cooldown = value; } },
  linearDamping: { get() { return this.linearDamp; }, set(value) { this.linearDamp = value; } },
  angularDamping: { get() { return this.angDamp; }, set(value) { this.angDamp = value; } },
});

export const PHYSICS = CONFIG;

export const PLAYERS = Object.freeze([
  { id: 0, side: 'north', key: 'q', color: '#f5aa46', label: 'NORTH' },
  { id: 1, side: 'east', key: 'p', color: '#e56859', label: 'EAST' },
  { id: 2, side: 'south', key: 'z', color: '#53b7a6', label: 'SOUTH' },
  { id: 3, side: 'west', key: 'm', color: '#83a5df', label: 'WEST' },
]);

const seatAngles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
const seatTorqueSigns = [1, 1, 1, 1];

export function getSeatPose(state, playerId) {
  if (!Number.isInteger(playerId) || playerId < 0 || playerId >= seatAngles.length) return null;
  const angle = state.angle + seatAngles[playerId];
  const outwardX = Math.cos(angle);
  const outwardY = Math.sin(angle);
  const tangentX = -outwardY;
  const tangentY = outwardX;
  const sign = seatTorqueSigns[playerId];
  const tangentOffset = CONFIG.tangentialOffset * sign;
  const position = {
    x: state.x + outwardX * CONFIG.raftRadius + tangentX * tangentOffset,
    y: state.y + outwardY * CONFIG.raftRadius + tangentY * tangentOffset,
  };
  let directionX = -outwardX + tangentX * CONFIG.tangentialBias * sign;
  let directionY = -outwardY + tangentY * CONFIG.tangentialBias * sign;
  const directionLength = Math.hypot(directionX, directionY);
  directionX /= directionLength;
  directionY /= directionLength;
  return { position, direction: { x: directionX, y: directionY }, offset: { x: position.x - state.x, y: position.y - state.y } };
}

export function createRaftState(x = 0, y = 0) {
  const pos = { x, y };
  const vel = { x: 0, y: 0 };
  const state = {
    pos,
    vel,
    angle: 0,
    angularVelocity: 0,
    mass: CONFIG.mass,
    inertia: 0.5 * CONFIG.mass * CONFIG.raftRadius ** 2,
  };
  for (const key of ['x', 'y']) {
    Object.defineProperty(state, key, { enumerable: true, get: () => pos[key], set: (value) => { pos[key] = value; } });
  }
  for (const key of ['vx', 'vy']) {
    const component = key === 'vx' ? 'x' : 'y';
    Object.defineProperty(state, key, { enumerable: true, get: () => vel[component], set: (value) => { vel[component] = value; } });
  }
  Object.defineProperty(state, 'angVel', { enumerable: true, get() { return this.angularVelocity; }, set(value) { this.angularVelocity = value; } });
  return state;
}

export function applyImpulse(state, impulse, point = { x: state.x, y: state.y }) {
  const rx = point.x - state.x;
  const ry = point.y - state.y;
  state.vx += impulse.x / state.mass;
  state.vy += impulse.y / state.mass;
  state.angularVelocity += (rx * impulse.y - ry * impulse.x) / state.inertia;
  return true;
}

export function applyFartImpulse(state, playerId, impulse = CONFIG.thrustImpulse) {
  const pose = getSeatPose(state, playerId);
  if (!pose) return false;
  applyImpulse(state, { x: pose.direction.x * impulse, y: pose.direction.y * impulse }, pose.position);
  return true;
}

export function createFartBurst(state, playerId, charge = 1) {
  const pose = getSeatPose(state, playerId);
  if (!pose) return null;
  return {
    playerId,
    age: 0,
    duration: CONFIG.thrustDuration,
    impulse: CONFIG.thrustImpulse * Math.max(0.5, Math.min(1.5, charge)),
  };
}

function burstShape(age) {
  const attack = CONFIG.thrustAttack;
  const decay = CONFIG.thrustDecay;
  return (1 - Math.exp(-age / attack)) * Math.exp(-age / decay);
}

function burstArea(duration) {
  const attack = CONFIG.thrustAttack;
  const decay = CONFIG.thrustDecay;
  const combined = 1 / (1 / attack + 1 / decay);
  return decay * (1 - Math.exp(-duration / decay)) - combined * (1 - Math.exp(-duration / combined));
}

export function sampleFartForce(state, burst) {
  if (!burst || burst.age >= burst.duration) return null;
  const pose = getSeatPose(state, burst.playerId);
  if (!pose) return null;
  const magnitude = burst.impulse * burstShape(burst.age) / burstArea(burst.duration);
  const force = { x: pose.direction.x * magnitude, y: pose.direction.y * magnitude };
  const rx = pose.position.x - state.x;
  const ry = pose.position.y - state.y;
  return { playerId: burst.playerId, force, point: pose.position, torque: rx * force.y - ry * force.x };
}

export function stepRaft(state, dt, options = {}) {
  state.mass = CONFIG.mass;
  state.inertia = 0.5 * CONFIG.mass * CONFIG.raftRadius ** 2;
  const flow = options.flowVelocity || { x: 0, y: 0 };
  const flowStrength = options.currentStrength ?? CONFIG.currentStrength;
  const forceX = (options.forceX || 0) + flowStrength * (flow.x - state.vx);
  const forceY = (options.forceY || 0) + flowStrength * (flow.y - state.vy);
  const linearDamping = Math.exp(-CONFIG.linearDamp * dt);
  const angularDamping = Math.exp(-CONFIG.angDamp * dt);

  state.vx = (state.vx + forceX / state.mass * dt) * linearDamping;
  state.vy = (state.vy + forceY / state.mass * dt) * linearDamping;
  state.angularVelocity = (state.angularVelocity + (options.torque || 0) / state.inertia * dt) * angularDamping;
  const speed = Math.hypot(state.vx, state.vy);
  if (speed > CONFIG.maxSpeed) {
    state.vx *= CONFIG.maxSpeed / speed;
    state.vy *= CONFIG.maxSpeed / speed;
  }
  state.angularVelocity = Math.max(-CONFIG.maxAngSpeed, Math.min(CONFIG.maxAngSpeed, state.angularVelocity));
  state.x += state.vx * dt;
  state.y += state.vy * dt;
  state.angle += state.angularVelocity * dt;
  return state;
}

export function getRaftCorners(state, inset = 0) {
  const halfWidth = PHYSICS.raftWidth / 2 - inset;
  const halfHeight = PHYSICS.raftHeight / 2 - inset;
  const cosine = Math.cos(state.angle);
  const sine = Math.sin(state.angle);
  return [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map(({ x, y }) => ({
    x: state.x + x * cosine - y * sine,
    y: state.y + x * sine + y * cosine,
  }));
}

export function resolveWallCollision(state, wallX, direction, restitution = 0.42) {
  const edge = state.x + direction * PHYSICS.raftRadius;
  if ((direction < 0 && edge < wallX) || (direction > 0 && edge > wallX)) {
    state.x += wallX - edge;
    if (state.vx * direction > 0) state.vx *= -restitution;
    state.angularVelocity *= 0.72;
    return true;
  }
  return false;
}

function bounceCircle(state, normalX, normalY, penetration, restitution, options = {}) {
  const contactX = -normalX * CONFIG.raftRadius;
  const contactY = -normalY * CONFIG.raftRadius;
  const surfaceSource = options.surfaceVelocity || { x: 0, y: 0 };
  const surfaceVelocity = typeof surfaceSource === 'function' ? surfaceSource({ x: state.x - normalX * CONFIG.raftRadius, y: state.y - normalY * CONFIG.raftRadius }) : surfaceSource;
  const relativeX = state.vx - state.angularVelocity * contactY - surfaceVelocity.x;
  const relativeY = state.vy + state.angularVelocity * contactX - surfaceVelocity.y;
  const normalSpeed = relativeX * normalX + relativeY * normalY;
  state.x += normalX * (penetration + 0.5);
  state.y += normalY * (penetration + 0.5);
  if (normalSpeed < 0) {
    const normalImpulse = -(1 + restitution) * normalSpeed * state.mass;
    const tangentX = -normalY;
    const tangentY = normalX;
    const tangentSpeed = relativeX * tangentX + relativeY * tangentY;
    const inverseMass = 1 / state.mass + (contactX ** 2 + contactY ** 2) / state.inertia;
    const frictionLimit = CONFIG.collisionFriction * normalImpulse;
    const tangentImpulse = Math.max(-frictionLimit, Math.min(frictionLimit, -tangentSpeed / inverseMass));
    const impulseX = normalX * normalImpulse + tangentX * tangentImpulse;
    const impulseY = normalY * normalImpulse + tangentY * tangentImpulse;
    state.vx += impulseX / state.mass;
    state.vy += impulseY / state.mass;
    state.angularVelocity += (contactX * impulseY - contactY * impulseX) / state.inertia;
  }
}

export function resolveCircleCollision(state, obstacle, radius, restitution = 0.5, options = {}) {
  const dx = state.x - obstacle.x;
  const dy = state.y - obstacle.y;
  const distance = Math.hypot(dx, dy);
  const penetration = PHYSICS.raftRadius + radius - distance;
  if (penetration <= 0) return false;
  const normalX = distance > 1e-6 ? dx / distance : 1;
  const normalY = distance > 1e-6 ? dy / distance : 0;
  bounceCircle(state, normalX, normalY, penetration, restitution, options);
  return true;
}

export function resolveCircleSegmentCollision(state, start, end, options = {}) {
  const edgeX = end.x - start.x;
  const edgeY = end.y - start.y;
  const edgeLengthSquared = edgeX * edgeX + edgeY * edgeY;
  if (edgeLengthSquared <= 1e-9) return resolveCircleCollision(state, start, 0, options.restitution ?? CONFIG.wallRestitution);
  const amount = Math.max(0, Math.min(1, ((state.x - start.x) * edgeX + (state.y - start.y) * edgeY) / edgeLengthSquared));
  const point = { x: start.x + amount * edgeX, y: start.y + amount * edgeY };
  const dx = state.x - point.x;
  const dy = state.y - point.y;
  const distance = Math.hypot(dx, dy);
  const penetration = CONFIG.raftRadius - distance;
  if (penetration <= 0) return null;

  let normalX;
  let normalY;
  if (distance > 1e-6) {
    normalX = dx / distance;
    normalY = dy / distance;
  } else {
    const edgeLength = Math.sqrt(edgeLengthSquared);
    normalX = -edgeY / edgeLength;
    normalY = edgeX / edgeLength;
  }

  const contactX = -normalX * CONFIG.raftRadius;
  const contactY = -normalY * CONFIG.raftRadius;
  const surfaceSource = options.surfaceVelocity || { x: 0, y: 0 };
  const surfaceVelocity = typeof surfaceSource === 'function' ? surfaceSource(point) : surfaceSource;
  const relativeX = state.vx - state.angularVelocity * contactY - surfaceVelocity.x;
  const relativeY = state.vy + state.angularVelocity * contactX - surfaceVelocity.y;
  const normalSpeed = relativeX * normalX + relativeY * normalY;
  state.x += normalX * (penetration + 0.5);
  state.y += normalY * (penetration + 0.5);

  let impactSpeed = Math.max(0, -normalSpeed);
  if (normalSpeed < 0) {
    const normalImpulse = -(1 + (options.restitution ?? CONFIG.wallRestitution)) * normalSpeed * state.mass;
    const tangentX = -normalY;
    const tangentY = normalX;
    const tangentSpeed = relativeX * tangentX + relativeY * tangentY;
    const inverseMass = 1 / state.mass + (contactX ** 2 + contactY ** 2) / state.inertia;
    const frictionLimit = (options.friction ?? CONFIG.collisionFriction) * normalImpulse;
    const tangentImpulse = Math.max(-frictionLimit, Math.min(frictionLimit, -tangentSpeed / inverseMass));
    const impulseX = normalX * normalImpulse + tangentX * tangentImpulse;
    const impulseY = normalY * normalImpulse + tangentY * tangentImpulse;
    state.vx += impulseX / state.mass;
    state.vy += impulseY / state.mass;
    state.angularVelocity += (contactX * impulseY - contactY * impulseX) / state.inertia;
  }
  return { point, normal: { x: normalX, y: normalY }, penetration, impactSpeed, surfaceVelocity };
}

export function resolveCirclePolygonCollision(state, polygon, options = {}) {
  if (polygon.length < 3) return null;
  let inside = false;
  let nearest = null;
  let nearestEdge = null;
  let nearestDistanceSquared = Infinity;
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    area += start.x * end.y - end.x * start.y;
    const edgeX = end.x - start.x;
    const edgeY = end.y - start.y;
    const edgeLengthSquared = edgeX * edgeX + edgeY * edgeY;
    if (edgeLengthSquared <= 1e-9) continue;
    const amount = Math.max(0, Math.min(1, ((state.x - start.x) * edgeX + (state.y - start.y) * edgeY) / edgeLengthSquared));
    const point = { x: start.x + amount * edgeX, y: start.y + amount * edgeY };
    const dx = state.x - point.x;
    const dy = state.y - point.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared;
      nearest = point;
      nearestEdge = { start, end };
    }
    if ((start.y > state.y) !== (end.y > state.y) && state.x < ((end.x - start.x) * (state.y - start.y)) / (end.y - start.y) + start.x) inside = !inside;
  }
  if (!nearest) return null;
  const distance = Math.sqrt(nearestDistanceSquared);
  if (!inside && distance >= CONFIG.raftRadius) return null;

  let normalX;
  let normalY;
  if (inside && distance <= 1e-6) {
    const edgeX = nearestEdge.end.x - nearestEdge.start.x;
    const edgeY = nearestEdge.end.y - nearestEdge.start.y;
    const sign = area >= 0 ? 1 : -1;
    const length = Math.hypot(edgeX, edgeY) || 1;
    normalX = sign * edgeY / length;
    normalY = -sign * edgeX / length;
  } else if (inside) {
    normalX = (nearest.x - state.x) / distance;
    normalY = (nearest.y - state.y) / distance;
  } else {
    normalX = (state.x - nearest.x) / distance;
    normalY = (state.y - nearest.y) / distance;
  }
  const penetration = inside ? CONFIG.raftRadius + distance : CONFIG.raftRadius - distance;
  const contactX = -normalX * CONFIG.raftRadius;
  const contactY = -normalY * CONFIG.raftRadius;
  const surfaceSource = options.surfaceVelocity || { x: 0, y: 0 };
  const surfaceVelocity = typeof surfaceSource === 'function' ? surfaceSource(nearest) : surfaceSource;
  const relativeX = state.vx - state.angularVelocity * contactY - surfaceVelocity.x;
  const relativeY = state.vy + state.angularVelocity * contactX - surfaceVelocity.y;
  const normalSpeed = relativeX * normalX + relativeY * normalY;
  state.x += normalX * (penetration + 0.5);
  state.y += normalY * (penetration + 0.5);
  const impactSpeed = Math.max(0, -normalSpeed);
  if (normalSpeed < 0) {
    const normalImpulse = -(1 + (options.restitution ?? CONFIG.wallRestitution)) * normalSpeed * state.mass;
    const tangentX = -normalY;
    const tangentY = normalX;
    const tangentSpeed = relativeX * tangentX + relativeY * tangentY;
    const inverseMass = 1 / state.mass + (contactX ** 2 + contactY ** 2) / state.inertia;
    const frictionLimit = (options.friction ?? CONFIG.collisionFriction) * normalImpulse;
    const tangentImpulse = Math.max(-frictionLimit, Math.min(frictionLimit, -tangentSpeed / inverseMass));
    const impulseX = normalX * normalImpulse + tangentX * tangentImpulse;
    const impulseY = normalY * normalImpulse + tangentY * tangentImpulse;
    state.vx += impulseX / state.mass;
    state.vy += impulseY / state.mass;
    state.angularVelocity += (contactX * impulseY - contactY * impulseX) / state.inertia;
  }
  return { point: nearest, normal: { x: normalX, y: normalY }, penetration, impactSpeed, surfaceVelocity };
}

