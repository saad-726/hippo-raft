import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyFartImpulse, applyImpulse, createFartBurst, createRaftState, CONFIG, PHYSICS, resolveCircleCollision, resolveCirclePolygonCollision, resolveCircleSegmentCollision, sampleFartForce, stepRaft } from '../shared/physics.js';
import { assertLevelSet } from '../shared/levelSchema.js';
import { createGameState, getHazardPolygons, riverCenter, tickGame } from '../shared/simulation.js';

const stillRiver = {
  timeLimit: 30,
  length: 5000,
  riverWidth: 1000,
  curveAmplitude: 0,
  curveFrequency: 1000,
  current: 50,
  spikeBanks: [],
  hazards: [],
  goalOffset: 0,
  goalRange: 100,
  stars: [20, 25],
};

test('seven authored levels satisfy the shared course schema', async () => {
  const levels = JSON.parse(await readFile(new URL('../shared/levels.json', import.meta.url), 'utf8'));
  assertLevelSet(levels);
  assert.deepEqual(levels.map((level) => level.name), [
    'Lazy River', 'Bendy Creek', 'Spike Alley', 'Rapids', 'Hammer Time', 'Whirlpool Pond', 'Chaos Finale',
  ]);
});

test('river path interpolation is smooth through a bend', () => {
  const level = { path: [{ x: 500, y: 0 }, { x: 650, y: 100 }, { x: 500, y: 200 }] };
  const before = (riverCenter(level, 100) - riverCenter(level, 99)) / 1;
  const after = (riverCenter(level, 101) - riverCenter(level, 100)) / 1;
  assert.ok(Math.abs(before - after) < 2);
});

test('an impulse through the center produces translation without spin', () => {
  const raft = createRaftState();
  applyImpulse(raft, { x: 0, y: 120 }, { x: raft.x, y: raft.y });
  assert.equal(raft.vx, 0);
  assert.equal(raft.vy, 10);
  assert.equal(raft.angularVelocity, 0);
});

test('the raft exposes pos, vel, and angular-velocity aliases without desync', () => {
  const raft = createRaftState();
  raft.pos.x = 12;
  raft.vel.y = 7;
  raft.angVel = 0.5;
  assert.equal(raft.x, 12);
  assert.equal(raft.vy, 7);
  assert.equal(raft.angularVelocity, 0.5);
});

test('an off-center impulse produces translation and torque', () => {
  const raft = createRaftState();
  applyImpulse(raft, { x: 0, y: 120 }, { x: raft.x + 20, y: raft.y });
  assert.equal(raft.vy, 10);
  assert.equal(raft.angularVelocity, 20 * 120 / raft.inertia);
});

test('equal opposite-seat farts cancel translation but both contribute the same-direction torque', () => {
  const raft = createRaftState();
  applyFartImpulse(raft, 0);
  applyFartImpulse(raft, 2);
  // With seatTorqueSigns = [1,1,1,1] opposite seats cancel linear motion but spin in the same direction.
  assert.ok(Math.hypot(raft.vx, raft.vy) < 2);    // translation mostly cancels
  assert.ok(Math.abs(raft.angularVelocity) > 0.1); // but they both spin the raft
});

test('two adjacent seats produce visible spin', () => {
  const raft = createRaftState();
  applyFartImpulse(raft, 0);
  applyFartImpulse(raft, 1);
  assert.ok(Math.abs(raft.angularVelocity) > 0.5);
});

test('a fart burst spreads its configured impulse over the thrust duration', () => {
  const raft = createRaftState();
  const burst = createFartBurst(raft, 0);
  let impulseX = 0;
  let impulseY = 0;
  const dt = 1 / 600;
  while (burst.age < burst.duration) {
    const sample = sampleFartForce(raft, burst);
    if (sample) {
      impulseX += sample.force.x * dt;
      impulseY += sample.force.y * dt;
    }
    burst.age += dt;
  }
  assert.ok(Math.abs(Math.hypot(impulseX, impulseY) - PHYSICS.thrustImpulse) < PHYSICS.thrustImpulse * 0.02);
});

test('a single fart keeps the raft gliding after the burst ends', () => {
  const level = { ...stillRiver, current: 0 };
  const game = createGameState(level);
  tickGame(game, level, [0]);
  for (let frame = 0; frame < 120; frame += 1) tickGame(game, level);
  assert.ok(game.raft.y > 120);
  assert.ok(game.raft.vy > 20);
  assert.equal(game.bursts.length, 0);
});

test('a hippo cannot start a second fart during cooldown', () => {
  const game = createGameState({ ...stillRiver, current: 0 });
  tickGame(game, { ...stillRiver, current: 0 }, [0]);
  tickGame(game, { ...stillRiver, current: 0 }, [0]);
  assert.equal(game.bursts.length, 1);
  assert.ok(game.cooldowns[0] > 0);
});

test('invalid player inputs do not change the raft', () => {
  const raft = createRaftState();
  assert.equal(applyFartImpulse(raft, 4), false);
  assert.equal(raft.vx, 0);
  assert.equal(raft.angularVelocity, 0);
});

test('fixed step integration applies current and damping', () => {
  const raft = createRaftState();
  stepRaft(raft, 1 / 60);
  assert.equal(raft.vy, 0);
  assert.equal(raft.y, 0);
});

test('river current drags raft velocity toward flow without a constant acceleration', () => {
  const game = createGameState(stillRiver);
  for (let frame = 0; frame < 60; frame += 1) tickGame(game, stillRiver);
  assert.ok(game.raft.y > 120);
  assert.ok(game.raft.vy > 0);
  assert.ok(game.raft.vy < stillRiver.current);

  const beforeFart = game.raft.vy;
  tickGame(game, stillRiver, [0]);
  assert.ok(game.raft.vy > beforeFart);
});

test('circle collisions push the raft clear instead of trapping it in overlap', () => {
  const raft = createRaftState();
  assert.equal(resolveCircleCollision(raft, { x: 0, y: 0 }, 40), true);
  const separatedX = raft.x;
  assert.equal(resolveCircleCollision(raft, { x: 0, y: 0 }, 40), false);
  assert.notEqual(separatedX, 0);
});

test('circle-vs-segment contact resolves penetration and bounces', () => {
  const raft = createRaftState(0, -20);
  raft.vy = 35;
  const wall = { start: { x: -100, y: 0 }, end: { x: 100, y: 0 } };
  const contact = resolveCircleSegmentCollision(raft, wall.start, wall.end);
  assert.ok(contact);
  assert.ok(raft.y < -PHYSICS.raftRadius);
  assert.ok(raft.vy < 0);
  assert.equal(resolveCircleSegmentCollision(raft, wall.start, wall.end), null);
});

test('circle-vs-polygon contact separates the raft from a bar', () => {
  const raft = createRaftState();
  const bar = [{ x: -10, y: -50 }, { x: 10, y: -50 }, { x: 10, y: 50 }, { x: -10, y: 50 }];
  assert.ok(resolveCirclePolygonCollision(raft, bar));
  assert.equal(resolveCirclePolygonCollision(raft, bar), null);
});

test('swinging doors alternate between open gaps and closed panels', () => {
  const level = { riverWidth: 600, curveAmplitude: 0, curveFrequency: 1000 };
  const door = { kind: 'swinging-door', y: 300, gapOffset: 0, gapWidth: 180, thickness: 24, period: 4, openTime: 1 };
  assert.equal(getHazardPolygons(level, door, 0).length, 0);
  assert.equal(getHazardPolygons(level, door, 2).length, 2);
});

test('spiked rotating bars damage the raft on polygon contact', () => {
  const level = { ...stillRiver, hazards: [{ kind: 'rotating-bar', y: 120, offset: 0, length: 240, thickness: 24, spinSpeed: 1, spiked: true }] };
  const game = createGameState(level);
  tickGame(game, level);
  assert.equal(game.health, 2);
  assert.equal(game.event.type, 'hit');
  assert.equal(game.event.hazard, 'rotating-bar');
  assert.ok(game.invulnerable >= CONFIG.invulnTime - PHYSICS.fixedStep);
});

test('checkpoints activate and mines schedule a respawn after impact', () => {
  const level = { ...stillRiver, hazards: [
    { kind: 'checkpoint', y: 120, offset: 0 },
    { kind: 'mine', y: 120, offset: 0, radius: 35, respawnAfter: 6 },
  ] };
  const game = createGameState(level);
  tickGame(game, level);
  assert.equal(game.health, 2);
  assert.ok(game.hazardRespawns[1] > game.elapsed);
  assert.equal(game.checkpoint.index, 0);
});

test('linear and angular damping decay motion without flow input', () => {
  const raft = createRaftState();
  raft.vx = 80;
  raft.angularVelocity = 3;
  stepRaft(raft, 1);
  assert.ok(Math.abs(raft.vx) < 80);
  assert.ok(Math.abs(raft.angularVelocity) < 3);
});

test('the speed cap prevents repeated impulses from becoming unbounded', () => {
  const raft = createRaftState();
  raft.vx = CONFIG.maxSpeed * 2;
  stepRaft(raft, PHYSICS.fixedStep, { flowVelocity: { x: raft.vx, y: 0 } });
  assert.ok(Math.hypot(raft.vx, raft.vy) <= CONFIG.maxSpeed);
});
