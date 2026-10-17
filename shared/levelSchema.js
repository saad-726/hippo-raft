const hazardKinds = new Set([
  'checkpoint',
  'gate',
  'log',
  'mine',
  'moving-spike',
  'moving-spike-wall',
  'rapid',
  'rock',
  'rotating-bar',
  'spike',
  'swinging-hammer',
  'swinging-door',
  'whirlpool',
]);

export function assertLevelSet(levels) {
  if (!Array.isArray(levels) || levels.length === 0) throw new TypeError('Levels must be a non-empty array.');
  const ids = new Set();
  for (const [index, level] of levels.entries()) {
    const label = `Level ${index + 1}`;
    if (!Number.isInteger(level.id) || ids.has(level.id)) throw new TypeError(`${label} needs a unique integer id.`);
    ids.add(level.id);
    if (!level.name || !Number.isFinite(level.length) || level.length <= 0) throw new TypeError(`${label} needs a name and positive length.`);
    if (!Number.isFinite(level.riverWidth) || level.riverWidth <= 0) throw new TypeError(`${label} needs a positive river width.`);
    if (!Array.isArray(level.path) || level.path.length < 2) throw new TypeError(`${label} needs at least two river path points.`);
    for (let pointIndex = 0; pointIndex < level.path.length; pointIndex += 1) {
      const point = level.path[pointIndex];
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError(`${label} has an invalid path point.`);
      if (pointIndex > 0 && point.y <= level.path[pointIndex - 1].y) throw new TypeError(`${label} path y values must increase.`);
    }
    if (level.path[0].y > 0 || level.path.at(-1).y < level.length) throw new TypeError(`${label} path must span the full course.`);
    if (!Array.isArray(level.spikeBanks) || !Array.isArray(level.hazards)) throw new TypeError(`${label} needs bank and hazard arrays.`);
    for (const hazard of level.hazards) {
      if (!hazardKinds.has(hazard.kind)) throw new TypeError(`${label} has unsupported hazard kind: ${hazard.kind}.`);
      if (!Number.isFinite(hazard.y) || !Number.isFinite(hazard.offset ?? 0)) throw new TypeError(`${label} has a hazard without a valid position.`);
      if (['gate', 'moving-spike-wall', 'swinging-door'].includes(hazard.kind) && (!Number.isFinite(hazard.gapWidth) || hazard.gapWidth < 2 * 62)) {
        throw new TypeError(`${label} has a gate gap too narrow for the raft.`);
      }
      if (hazard.kind === 'swinging-door' && (!Number.isFinite(hazard.period) || hazard.period <= 0 || !Number.isFinite(hazard.openTime) || hazard.openTime < 0)) {
        throw new TypeError(`${label} has an invalid swinging-door schedule.`);
      }
    }
    if (!Array.isArray(level.stars) || level.stars.length !== 2 || level.stars.some((time) => !Number.isFinite(time))) {
      throw new TypeError(`${label} needs two numeric star thresholds.`);
    }
  }
  return levels;
}
