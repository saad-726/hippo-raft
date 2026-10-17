import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import { PHYSICS } from '../shared/physics.js';
import { assertLevelSet } from '../shared/levelSchema.js';
import { createGameState, tickGame } from '../shared/simulation.js';

const levels = assertLevelSet(JSON.parse(await readFile(new URL('../shared/levels.json', import.meta.url), 'utf8')));
const port = Number(process.env.PORT || 3001);
const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

// S5 — Origin check: allow all when CLIENT_ORIGIN is empty (local dev).
const allowedOrigins = (process.env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);

// S4 — Canonical name cleaner used by both create and join.
function cleanName(value) {
  return String(value || '').replace(/[^\p{L}\p{N}_\s\-'.!?]/gu, '').trim().slice(0, 18) || 'River pal';
}

const httpServer = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.CLIENT_ORIGIN || '*' });
    response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  response.writeHead(404);
  response.end('Not found');
});

const webSocketServer = new WebSocketServer({
  server: httpServer,
  maxPayload: 2048,
  // S5 — Reject WebSocket connections from unlisted origins (skip check when list is empty).
  verifyClient: ({ origin }) => allowedOrigins.length === 0 || allowedOrigins.includes(origin),
});

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function send(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function getPublicRoom(room) {
  return {
    code: room.code,
    hostSeat: room.hostSeat,
    mode: room.mode,
    levelIndex: room.levelIndex,
    started: Boolean(room.state && room.state.status === 'playing'),
    players: Array.from({ length: 4 }, (_, seat) => {
      const player = room.players[seat];
      return { seat, name: player?.name || '', connected: Boolean(player?.socket), bot: Boolean(player && !player.socket) };
    }),
  };
}

function broadcastRoom(room) {
  const payload = { type: 'room', room: getPublicRoom(room) };
  for (const player of room.players) send(player?.socket, payload);
}

function broadcastState(room) {
  const payload = { type: 'state', state: room.state, levelIndex: room.levelIndex, serverTime: Date.now() };
  for (const player of room.players) send(player?.socket, payload);
}

function assignSocket(room, seat, socket, token, name) {
  const player = room.players[seat] || { name, token, socket: null, disconnectedAt: 0 };
  player.name = cleanName(name || player.name || `Hippo ${seat + 1}`);
  player.token = token || player.token || crypto.randomUUID();
  player.socket = socket;
  player.disconnectedAt = 0;
  room.players[seat] = player;
  socket.roomCode = room.code;
  socket.seat = seat;
  socket.token = player.token;
  send(socket, { type: 'assigned', code: room.code, seat, token: player.token, isHost: player.token === room.hostToken });
  broadcastRoom(room);
}

// Phase 4: hand host rights to the next connected seat when the host disconnects.
function handoverHost(room) {
  for (let seat = 0; seat < 4; seat += 1) {
    const player = room.players[seat];
    if (player?.socket) {
      room.hostToken = player.token;
      room.hostSeat = seat;
      send(player.socket, { type: 'assigned', code: room.code, seat, token: player.token, isHost: true });
      broadcastRoom(room);
      return;
    }
  }
}

webSocketServer.on('connection', (socket) => {
  socket.on('error', () => {}); // absorb oversize-frame and reset errors; never crash

  // S2 — Per-socket message rate limit: 20 messages per second.
  socket.messageCount = 0;
  const rateLimitReset = setInterval(() => { socket.messageCount = 0; }, 1000);

  socket.on('message', (raw) => {
    socket.messageCount += 1;
    if (socket.messageCount > 20) return; // silently drop excess messages

    let message;
    try { message = JSON.parse(raw.toString()); } catch { send(socket, { type: 'error', message: 'That message was not understood.' }); return; }
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;

    if (message.type === 'ping') { send(socket, { type: 'pong' }); return; }

    if (message.type === 'create') {
      // S2 — Room cap: refuse when over 100 rooms.
      if (rooms.size >= 100) { send(socket, { type: 'error', message: 'The river is full right now. Try again soon.' }); return; }
      // S3 — Prevent seat hogging: a socket can only be in one room.
      if (socket.roomCode) { send(socket, { type: 'error', message: 'You are already in a room.' }); return; }
      const code = makeCode();
      const token = crypto.randomUUID();
      const room = { code, hostToken: token, hostSeat: 0, mode: message.mode === 'blame' ? 'blame' : 'coop', levelIndex: 0, players: [], state: null, blame: [0, 0, 0, 0], pendingInputs: new Set(), tick: 0, lastActivity: Date.now() };
      rooms.set(code, room);
      assignSocket(room, 0, socket, token, cleanName(message.name));
      return;
    }

    if (message.type === 'join') {
      // S3 — Prevent seat hogging: reject join if already in a room.
      if (socket.roomCode) { send(socket, { type: 'error', message: 'You are already in a room.' }); return; }
      const joinRoom = rooms.get(String(message.code || '').toUpperCase());
      if (!joinRoom) { send(socket, { type: 'error', message: 'No room by that code. Check the letters and try again.' }); return; }
      const name = cleanName(message.name);
      const seatIds = [0, 1, 2, 3];
      let seat = seatIds.find((seatId) => joinRoom.players[seatId]?.token === message.token && !joinRoom.players[seatId]?.socket);
      if (seat === undefined) seat = seatIds.find((seatId) => {
        const player = joinRoom.players[seatId];
        return !player || (!player.socket && Date.now() - player.disconnectedAt > 90000);
      });
      if (seat === undefined) { send(socket, { type: 'error', message: 'This raft is full. Try another room.' }); return; }
      if (joinRoom.players[seat]?.token) joinRoom.players[seat].token = message.token || joinRoom.players[seat].token;
      joinRoom.lastActivity = Date.now();
      assignSocket(joinRoom, seat, socket, message.token, name);
      if (joinRoom.state) broadcastState(joinRoom);
      return;
    }

    const room = rooms.get(socket.roomCode);
    if (!room || socket.roomCode !== room.code) { send(socket, { type: 'error', message: 'Join a room first.' }); return; }
    room.lastActivity = Date.now();

    if (message.type === 'pick' && socket.token === room.hostToken && !room.state) {
      room.mode = message.mode === 'blame' ? 'blame' : 'coop';
      room.levelIndex = Math.max(0, Math.min(levels.length - 1, Number(message.levelIndex) || 0));
      broadcastRoom(room);
    }
    if (message.type === 'start' && socket.token === room.hostToken && !room.state) {
      room.state = createGameState(levels[room.levelIndex], room.mode);
      room.state.blame = [...room.blame];
      room.startedAt = Date.now();
      room.tick = 0;
      broadcastRoom(room);
      broadcastState(room);
    }
    if (message.type === 'next' && socket.token === room.hostToken && room.state && room.state.status !== 'playing') {
      room.blame = [...room.state.blame];
      room.levelIndex = Math.min(levels.length - 1, room.levelIndex + 1);
      room.state = null;
      room.pendingInputs.clear();
      broadcastRoom(room);
    }
    if (message.type === 'retry' && socket.token === room.hostToken) {
      room.state = null;
      room.pendingInputs.clear();
      broadcastRoom(room);
    }
    if (message.type === 'input' && room.state?.status === 'playing' && Number(message.seat) === socket.seat) {
      room.pendingInputs.add(socket.seat);
    }
  });

  socket.on('close', () => {
    clearInterval(rateLimitReset);
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    const player = room.players[socket.seat];
    if (player?.socket === socket) {
      player.socket = null;
      player.disconnectedAt = Date.now();
      broadcastRoom(room);
      // Phase 4: hand over host if the departing socket was the host.
      if (socket.token === room.hostToken) handoverHost(room);
    }
  });
});

// Phase 4: fixed-step game clock driven by wall time instead of setInterval drift.
let lastTickTime = performance.now();
let tickAccumulator = 0;

setInterval(() => {
  const now = performance.now();
  tickAccumulator += (now - lastTickTime) / 1000;
  lastTickTime = now;
  const step = PHYSICS.fixedStep;
  while (tickAccumulator >= step) {
    tickAccumulator -= step;
    for (const room of rooms.values()) {
      if (!room.state || room.state.status !== 'playing') continue;
      const bots = [0, 1, 2, 3].filter((seat) => !room.players[seat]?.socket);
      tickGame(room.state, levels[room.levelIndex], [...room.pendingInputs], step, bots);
      room.pendingInputs.clear();
      room.tick += 1;
      if (room.tick % 2 === 0 || room.state.status !== 'playing') broadcastState(room);
    }
  }
}, 8); // run more frequently than a tick so accumulator stays accurate

// S2 — Room cleanup: prune rooms that have had no connected human for 10 minutes.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [code, room] of rooms.entries()) {
    const hasHuman = room.players.some((player) => player?.socket);
    if (!hasHuman && room.lastActivity < cutoff) rooms.delete(code);
  }
}, 60 * 1000);

httpServer.listen(port, '0.0.0.0', () => console.log(`Hippo Raft server listening on :${port}`));

// Last-resort safety net — should never fire after the guards above, but keeps
// the process alive if an unexpected throw slips through during development.
process.on('uncaughtException', (error) => console.error('[uncaughtException]', error));
