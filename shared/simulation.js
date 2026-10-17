import { createFartBurst, createRaftState, CONFIG, getSeatPose, PHYSICS, resolveCircleCollision, resolveCirclePolygonCollision, resolveCircleSegmentCollision, sampleFartForce, stepRaft } from './physics.js';

export function riverCenter(level, y) {
  if (level.path) {
    if (y <= level.path[0].y) return level.path[0].x;
    for (let index = 1; index < level.path.length; index += 1) {
      const next = level.path[index];
      if (y <= next.y) {
        const previous = level.path[index - 1];
        const before = level.path[Math.max(0, index - 2)];
        const after = level.path[Math.min(level.path.length - 1, index + 1)];
        const amount = (y - previous.y) / (next.y - previous.y);
        const amount2 = amount * amount;
        const amount3 = amount2 * amount;
        const span = next.y - previous.y;
        const tangentStart = (next.x - before.x) / (next.y - before.y) * span;
        const tangentEnd = (after.x - previous.x) / (after.y - previous.y) * span;
        return (2 * amount3 - 3 * amount2 + 1) * previous.x
          + (amount3 - 2 * amount2 + amount) * tangentStart
          + (-2 * amount3 + 3 * amount2) * next.x
          + (amount3 - amount2) * tangentEnd;
      }
    }
    return level.path.at(-1).x;
  }
  return 500 + Math.sin(y / level.curveFrequency) * level.curveAmplitude;
}

export function createGameState(level, mode = 'coop') {
  return {
    raft: createRaftState(riverCenter(level, 120), 120),
    elapsed: 0,
    remaining: level.timeLimit,
    health: 3,
    cooldowns: [0, 0, 0, 0],
    bursts: [],
    lastFartForces: [],
    hazardRespawns: {},
    checkpoint: { x: riverCenter(level, 120), y: 120, index: -1 },
    blame: [0, 0, 0, 0],
    lastFarter: null,
    invulnerable: 0,
    mode,
    status: 'playing',
    stars: 0,
    shake: 0,
    event: null,
  };
}

function hazardPosition(level, hazard, elapsed) {
  let xOffset = hazard.offset || 0;
  if (hazard.kind === 'moving-spike') xOffset += Math.sin(elapsed * (hazard.speed || 1.7) + hazard.y) * hazard.amplitude;
  if (hazard.kind === 'swinging-hammer') xOffset += Math.sin(elapsed * hazard.swingSpeed + (hazard.phase || 0)) * hazard.swingAmplitude;
  return { x: riverCenter(level, hazard.y) + xOffset, y: hazard.y };
}

function rectanglePolygon(x, y, length, thickness, angle = 0) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [[-length / 2, -thickness / 2], [length / 2, -thickness / 2], [length / 2, thickness / 2], [-length / 2, thickness / 2]]
    .map(([localX, localY]) => ({ x: x + localX * cosine - localY * sine, y: y + localX * sine + localY * cosine }));
}

export function getHazardPolygons(level, hazard, elapsed) {
  if (hazard.kind === 'rotating-bar') {
    const center = hazardPosition(level, hazard, elapsed);
    return [rectanglePolygon(center.x, center.y, hazard.length, hazard.thickness, (hazard.angle || 0) + elapsed * hazard.spinSpeed)];
  }
  if (!['gate', 'moving-spike-wall', 'swinging-door'].includes(hazard.kind)) return [];
  if (hazard.kind === 'swinging-door') {
    const phase = ((elapsed + (hazard.phase || 0)) % hazard.period + hazard.period) % hazard.period;
    if (phase < hazard.openTime) return [];
  }
  const centerX = riverCenter(level, hazard.y);
  const halfWidth = level.riverWidth / 2;
  const motion = hazard.kind === 'moving-spike-wall' ? Math.sin(elapsed * hazard.speed + hazard.y) * hazard.amplitude : 0;
  const gapCenter = centerX + (hazard.gapOffset || 0) + motion;
  const gapLeft = Math.max(centerX - halfWidth, gapCenter - hazard.gapWidth / 2);
  const gapRight = Math.min(centerX + halfWidth, gapCenter + hazard.gapWidth / 2);
  return [[centerX - halfWidth, gapLeft], [gapRight, centerX + halfWidth]]
    .filter(([start, end]) => end - start > 0)
    .map(([start, end]) => rectanglePolygon((start + end) / 2, hazard.y, end - start, hazard.thickness || 30));
}

export function getRiverFlow(level, state, elapsed = state.elapsed) {
  const y = state.raft.y;
  const tangentX = riverCenter(level, y + 16) - riverCenter(level, y - 16);
  const tangentY = 32;
  const tangentLength = Math.hypot(tangentX, tangentY);
  let speed = level.current || 0;
  for (const zone of level.currentZones || []) {
    if (y >= zone.start && y <= zone.end) speed *= zone.multiplier;
  }
  for (const hazard of level.hazards) {
    if (hazard.kind !== 'rapid') continue;
    const center = hazardPosition(level, hazard, elapsed);
    if (Math.hypot(state.raft.x - center.x, y - center.y) < hazard.radius) speed += hazard.flowBonus || level.current * 0.8;
  }
  return { x: tangentX / tangentLength * speed, y: tangentY / tangentLength * speed };
}

function hazardSurfaceVelocity(hazard, center, contact, elapsed) {
  if (hazard.kind === 'rotating-bar' && contact) {
    const angularSpeed = hazard.spinSpeed;
    const dx = contact.point.x - center.x;
    const dy = contact.point.y - center.y;
    return { x: -angularSpeed * dy, y: angularSpeed * dx };
  }
  if (hazard.kind === 'moving-spike-wall') {
    return { x: Math.cos(elapsed * hazard.speed + hazard.y) * hazard.amplitude * hazard.speed, y: 0 };
  }
  if (hazard.kind === 'swinging-hammer') {
    return { x: Math.cos(elapsed * hazard.swingSpeed + (hazard.phase || 0)) * hazard.swingAmplitude * hazard.swingSpeed, y: 0 };
  }
  return { x: 0, y: 0 };
}

function bankZoneAt(level, side, y) {
  return level.spikeBanks.find((zone) => zone.side === side && y >= zone.start && y <= zone.end);
}

function damage(state, mode, contact = null, hazard = null) {
  if (state.invulnerable > 0 || state.status !== 'playing') return;
  const impactSpeed = contact?.impactSpeed || Math.hypot(state.raft.vx, state.raft.vy);
  state.health -= 1;
  state.invulnerable = CONFIG.invulnTime;
  state.shake = Math.min(0.65, impactSpeed / CONFIG.maxSpeed * 0.65);
  let normal = contact?.normal || { x: 0, y: -1 };
  if (['rotating-bar', 'swinging-hammer'].includes(hazard?.kind) && contact?.surfaceVelocity) {
    const speed = Math.hypot(contact.surfaceVelocity.x, contact.surfaceVelocity.y);
    if (speed > 0) normal = { x: contact.surfaceVelocity.x / speed, y: contact.surfaceVelocity.y / speed };
  }
  const knockback = CONFIG.knockback * (hazard?.kind === 'mine' ? 1.5 : 0.45);
  state.raft.vx += normal.x * knockback;
  state.raft.vy += normal.y * knockback;
  state.event = { type: 'hit', at: state.elapsed, impactSpeed, normal, hazard: hazard?.kind || 'bank' };
  if (mode === 'blame' && state.lastFarter !== null) state.blame[state.lastFarter] += 1;
  if (state.health <= 0) state.status = 'lost';
}

export function getHazardWorldPosition(level, hazard, elapsed) {
  return hazardPosition(level, hazard, elapsed);
}

export function tickGame(state, level, inputs = [], dt = PHYSICS.fixedStep, bots = []) {
  if (state.status !== 'playing') return state;
  state.event = null;
  state.lastCollision = null;
  state.elapsed += dt;
  state.remaining = Math.max(0, level.timeLimit - state.elapsed);
  state.invulnerable = Math.max(0, state.invulnerable - dt);
  state.shake = Math.max(0, state.shake - dt);
  state.cooldowns = state.cooldowns.map((cooldown) => Math.max(0, cooldown - dt));

  for (let playerId = 0; playerId < 4; playerId += 1) {
    let botReady = false;
    if (bots.includes(playerId) && state.cooldowns[playerId] <= 0) {
      // A bot fires only when its seat's push direction points toward where the raft needs to go.
      // Using dot product > 0.55 prevents the raft from getting stuck sideways.
      const pose = getSeatPose(state.raft, playerId);
      if (pose) {
        // Desired direction: toward river centre from raft position.
        const idealX = riverCenter(level, state.raft.y) - state.raft.x;
        // Always include a small downstream component so bots make progress even on a straight river.
        const idealY = Math.max(10, level.current || 0);
        const idealLen = Math.hypot(idealX, idealY);
        const dot = (pose.direction.x * idealX + pose.direction.y * idealY) / idealLen;
        botReady = dot > 0.55;
      }
    }
    const playerInput = inputs.find((input) => (typeof input === 'number' ? input : input.playerId) === playerId);
    if ((playerInput !== undefined || botReady) && state.cooldowns[playerId] <= 0) {
      const charge = typeof playerInput === 'object' ? playerInput.charge || 1 : 1;
      const burst = createFartBurst(state.raft, playerId, charge);
      if (!burst) continue;
      state.bursts.push(burst);
      state.cooldowns[playerId] = CONFIG.cooldown;
      state.lastFarter = playerId;
      state.event = { type: 'fart', playerId, at: state.elapsed };
    }
  }

  const force = { x: 0, y: 0, torque: 0 };
  state.lastFartForces = [];
  state.bursts = state.bursts.filter((burst) => burst.age < burst.duration);
  for (const burst of state.bursts) {
    const sample = sampleFartForce(state.raft, burst);
    if (sample) {
      force.x += sample.force.x;
      force.y += sample.force.y;
      force.torque += sample.torque;
      state.lastFartForces.push(sample);
    }
    burst.age += dt;
  }

  const flow = getRiverFlow(level, state, state.elapsed);
  state.flowVelocity = flow;
  state.boostActive = level.hazards.some((hazard) => {
    if (hazard.kind !== 'rapid') return false;
    const center = hazardPosition(level, hazard, state.elapsed);
    return Math.hypot(state.raft.x - center.x, state.raft.y - center.y) < hazard.radius;
  });
  for (let hazardIndex = 0; hazardIndex < level.hazards.length; hazardIndex += 1) {
    const hazard = level.hazards[hazardIndex];
    if ((state.hazardRespawns[hazardIndex] || 0) > state.elapsed) continue;
    const position = hazardPosition(level, hazard, state.elapsed);
    const nearby = Math.abs(state.raft.y - position.y) < (hazard.radius || hazard.thickness || 40) + CONFIG.raftRadius;
    if (hazard.kind === 'checkpoint' && Math.abs(state.raft.y - position.y) < 48 && Math.abs(state.raft.x - position.x) < 90 && state.checkpoint.index !== hazardIndex) {
      state.checkpoint = { x: position.x, y: position.y, index: hazardIndex };
      state.event = { type: 'checkpoint', at: state.elapsed };
    }
    if (['rotating-bar', 'gate', 'moving-spike-wall', 'swinging-door'].includes(hazard.kind)) {
      const panels = getHazardPolygons(level, hazard, state.elapsed);
      const spiked = hazard.kind === 'moving-spike-wall' || hazard.spiked;
      for (const polygon of panels) {
        const contact = resolveCirclePolygonCollision(state.raft, polygon, {
          restitution: spiked ? CONFIG.spikeRestitution : CONFIG.wallRestitution,
          surfaceVelocity: (point) => hazardSurfaceVelocity(hazard, position, { point }, state.elapsed),
        });
        if (contact) {
          state.lastCollision = contact;
          if (spiked) damage(state, state.mode, contact, hazard);
        }
      }
      continue;
    }
    if (!nearby) continue;
    if (hazard.kind === 'whirlpool' && Math.hypot(state.raft.x - position.x, state.raft.y - position.y) < hazard.radius) {
      const dx = state.raft.x - position.x;
      const dy = state.raft.y - position.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const strength = hazard.force || 180;
      force.x += -dy / distance * strength - dx / distance * strength * 0.15;
      force.y += dx / distance * strength - dy / distance * strength * 0.15;
    }
    if (['rock', 'log', 'spike', 'moving-spike', 'mine', 'swinging-hammer'].includes(hazard.kind)) {
      const surfaceVelocity = (point) => hazardSurfaceVelocity(hazard, position, { point }, state.elapsed);
      const contact = resolveCircleCollision(state.raft, position, hazard.radius, hazard.kind.includes('spike') ? CONFIG.spikeRestitution : CONFIG.wallRestitution, { surfaceVelocity });
      if (!contact) continue;
      const dx = state.raft.x - position.x;
      const dy = state.raft.y - position.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const hit = {
        normal: { x: dx / length, y: dy / length },
        impactSpeed: Math.hypot(state.raft.vx, state.raft.vy),
        surfaceVelocity: surfaceVelocity({ x: state.raft.x - dx / length * CONFIG.raftRadius, y: state.raft.y - dy / length * CONFIG.raftRadius }),
      };
      state.lastCollision = { ...hit, point: position };
      if (hazard.kind === 'mine') {
        state.raft.vx += hit.normal.x * CONFIG.knockback;
        state.raft.vy += hit.normal.y * CONFIG.knockback;
        state.hazardRespawns[hazardIndex] = state.elapsed + (hazard.respawnAfter || 5);
        damage(state, state.mode, hit, hazard);
      } else if (hazard.kind.includes('spike') || hazard.kind === 'swinging-hammer' && hazard.spiked) {
        damage(state, state.mode, hit, hazard);
      }
    }
  }

  stepRaft(state.raft, dt, { forceX: force.x, forceY: force.y, torque: force.torque, flowVelocity: flow });
  const wallSpan = CONFIG.raftRadius * 2.5;
  for (const side of ['left', 'right']) {
    const direction = side === 'left' ? -1 : 1;
    const y0 = state.raft.y - wallSpan;
    const y1 = state.raft.y + wallSpan;
    const wallX = (y) => riverCenter(level, y) + direction * level.riverWidth / 2;
    const contact = resolveCircleSegmentCollision(state.raft, { x: wallX(y0), y: y0 }, { x: wallX(y1), y: y1 }, {
      restitution: bankZoneAt(level, side, state.raft.y) ? CONFIG.spikeRestitution : CONFIG.wallRestitution,
      friction: CONFIG.collisionFriction,
    });
    if (contact) {
      state.lastCollision = contact;
      if (bankZoneAt(level, side, state.raft.y)) damage(state, state.mode, contact);
    }
  }

  if (state.raft.y >= level.length - 190) {
    const targetX = riverCenter(level, level.length) + level.goalOffset;
    if (Math.abs(state.raft.x - targetX) <= level.goalRange) {
      state.status = 'won';
      state.remaining = Math.max(0, level.timeLimit - state.elapsed);
      state.stars = state.elapsed <= level.stars[0] && state.health === 3 ? 3 : state.elapsed <= level.stars[1] && state.health > 0 ? 2 : 1;
      state.event = { type: 'win', at: state.elapsed };
    } else if (state.raft.y > level.length + 80) {
      state.status = 'lost';
    }
  }
  if (state.remaining <= 0) state.status = 'lost';
  return state;
}
