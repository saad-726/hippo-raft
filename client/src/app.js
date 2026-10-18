import { CONFIG, PHYSICS, PLAYERS } from '../../shared/physics.js';
import { createGameState, tickGame } from '../../shared/simulation.js';
import { assertLevelSet } from '../../shared/levelSchema.js';
import { PROGRESS_KEY, ROOM_FROM_LINK, SETTINGS_KEY } from './config.js';
import { GameAudio } from './game/audio.js';
import { GameConnection } from './net/connection.js';

const levels = await fetch('/shared/levels.json').then(async (response) => {
  if (!response.ok) throw new Error('Could not load river levels.');
  return assertLevelSet(await response.json());
});
const $ = (selector) => document.querySelector(selector);
const screenIds = ['menu-screen', 'select-screen', 'online-screen', 'lobby-screen', 'pause-screen', 'results-screen'];
let settingsFromStorage = {};
try { settingsFromStorage = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { /* corrupted, use defaults */ }
const settings = { sound: true, music: true, screenShake: true, colorblind: false, renderQuality: 'medium', partyCamera: false, ...settingsFromStorage };
const physicsTuningKey = 'hippo-raft-physics-tuning';
const physicsRanges = {
  mass: [6, 26], raftRadius: [44, 84], thrustImpulse: [250, 1400], thrustDuration: [0.1, 0.5],
  cooldown: [0.25, 1.2], linearDamp: [0.02, 0.6], angDamp: [0.2, 3], currentStrength: [0.5, 8], maxSpeed: [80, 300],
  tangentialOffset: [4, 40],
};
let savedPhysicsTuning = {};
try { savedPhysicsTuning = JSON.parse(localStorage.getItem(physicsTuningKey) || '{}'); } catch { /* corrupted, use defaults */ }
for (const [key, [minimum, maximum]] of Object.entries(physicsRanges)) {
  const value = Number(savedPhysicsTuning[key]);
  if (Number.isFinite(value)) CONFIG[key] = Math.max(minimum, Math.min(maximum, value));
}
const { RiverRenderer3D } = await import('./game/renderer-3d.js');
const renderer = new RiverRenderer3D($('#river'), settings);
try {
  await renderer.ready;
  $('#loading-screen').hidden = true;
} catch (error) {
  $('#loading-screen').querySelector('strong').textContent = '3D river could not start';
  $('#loading-screen').querySelector('.eyebrow').textContent = error.message;
  throw error;
}
const audio = new GameAudio();
audio.enabled = settings.sound;
audio.musicEnabled = settings.music;
let progressRaw = {};
try { progressRaw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch { /* corrupted, use defaults */ }
const progress = progressRaw;
let selectedLevel = 0;
let selectedMode = 'coop';
let campaignMode = null;
let campaignNextLevel = 0;
let campaignBlame = [0, 0, 0, 0];
let gameState = createGameState(levels[0]);
let previousLocalState = { ...gameState, raft: { ...gameState.raft } };
let localGame = false;
let onlineGame = false;
let paused = false;
let connection = null;
let room = null;
let seat = 0;
let pendingInputs = new Set();
let snapshotHistory = [];
let lastState = 'idle';
let uiTimer = 0;
let connectionIntent = '';
let tutorialVisible = true;
let debugEnabled = false;
let fps = 0;
let fpsFrames = 0;
let fpsSampleStart = performance.now();

const seatNames = ['NORTH', 'EAST', 'SOUTH', 'WEST'];

function showScreen(id) {
  $('.app-shell').dataset.screen = id;
  if (id !== 'game' && gameState) gameState.shake = 0;
  for (const screenId of screenIds) $(`#${screenId}`).hidden = screenId !== id;
  $('#hud').hidden = id !== 'game';
  $('#touch-controls').hidden = id !== 'game' || !matchMedia('(pointer: coarse)').matches;
  if (id === 'game') {
    for (const screenId of screenIds) $(`#${screenId}`).hidden = true;
    $('#hud').hidden = false;
  }
}

function setMode(mode) {
  selectedMode = mode;
  document.querySelectorAll('.mode-option').forEach((button) => button.classList.toggle('selected', button.dataset.mode === mode));
  $('#launch-button').textContent = `Launch ${levels[selectedLevel].name} ↗`;
}

function renderLevelOptions() {
  $('#level-list').replaceChildren(...levels.map((level, index) => {
    const button = document.createElement('button');
    const best = Number(progress[level.id] || 0);
    button.className = `level-option${selectedLevel === index ? ' selected' : ''}`;
    button.dataset.level = String(index);
    button.innerHTML = `<strong>${String(level.id).padStart(2, '0')} · ${level.name}</strong><span>${level.subtitle}</span><em>${'★'.repeat(best)}${'☆'.repeat(3 - best)}</em>`;
    return button;
  }));
  $('#launch-button').textContent = `Launch ${levels[selectedLevel].name} ↗`;
  $('#lobby-level').replaceChildren(...levels.map((level, index) => new Option(`${String(level.id).padStart(2, '0')} · ${level.name}`, String(index))));
}

function setConnectionStatus(status) {
  const label = $('#connection-label');
  label.textContent = onlineGame || connectionIntent ? status === 'connected' ? 'ONLINE RIVER' : status === 'offline' ? 'SERVER OFFLINE' : 'WAKING SERVER' : 'LOCAL RIVER';
  label.dataset.status = status;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('visible');
  window.clearTimeout(toast.timeout);
  toast.timeout = window.setTimeout(() => element.classList.remove('visible'), 2500);
}

function getPlayerName() {
  return localStorage.getItem('hippo-raft-name') || 'River pal';
}
const nameInput = $('#player-name');
nameInput.value = localStorage.getItem('hippo-raft-name') || '';
nameInput.addEventListener('input', () => localStorage.setItem('hippo-raft-name', nameInput.value.trim()));

function connectOnline(intent, code = '') {
  connection?.close();
  connectionIntent = intent;
  setConnectionStatus('waking');
  $('#online-message').textContent = 'Waking up the river server…';
  connection = new GameConnection(handleNetworkMessage, setConnectionStatus);
  connection.connect().then(() => {
    $('#online-message').textContent = '';
    if (intent === 'create') connection.send({ type: 'create', name: getPlayerName(), mode: selectedMode });
    else connection.send({ type: 'join', code, name: getPlayerName(), token: localStorage.getItem(`hippo-raft-token-${code}`) || '' });
  }).catch((error) => {
    $('#online-message').textContent = `${error.message} You can still play locally.`;
    setConnectionStatus('offline');
  });
}

function handleNetworkMessage(message) {
  if (message.type === 'error') {
    $('#online-message').textContent = message.message;
    toast(message.message);
  }
  if (message.type === 'assigned') {
    room = { ...(room || {}), code: message.code, hostSeat: message.isHost ? message.seat : room?.hostSeat ?? 0 };
    seat = message.seat;
    localStorage.setItem(`hippo-raft-token-${message.code}`, message.token);
    $('#lobby-code').textContent = message.code;
    $('#invite-link').textContent = makeInviteLink(message.code);
    showScreen('lobby-screen');
  }
  if (message.type === 'room') {
    room = message.room;
    selectedMode = room.mode;
    selectedLevel = room.levelIndex;
    $('#lobby-code').textContent = room.code;
    $('#lobby-mode').value = room.mode;
    $('#lobby-level').value = String(room.levelIndex);
    $('#lobby-start').disabled = room.hostSeat !== seat;
    $('#lobby-start').textContent = room.hostSeat === seat ? 'Start trip ↗' : 'Waiting for host';
    $('#lobby-mode').disabled = room.hostSeat !== seat;
    $('#lobby-level').disabled = room.hostSeat !== seat;
      $('#player-slots').replaceChildren(...room.players.map((player, index) => createPlayerSlot(player, index)));
    if (room.started && message.state) beginOnlineGame(message.state, room.levelIndex);
    else if (onlineGame && !room.started && room.state !== 'playing') {
      onlineGame = false;
      showScreen('lobby-screen');
    }
  }
  if (message.type === 'state') {
    if (!onlineGame) beginOnlineGame(message.state, message.levelIndex);
    snapshotHistory.push({ state: message.state, receivedAt: performance.now() });
    if (snapshotHistory.length > 4) snapshotHistory.shift();
    gameState = message.state;
    updateGameUI();
    checkGameEnd();
  }
}

function createPlayerSlot(player, index) {
  const element = document.createElement('div');
  element.className = `player-slot${player.name ? '' : ' empty'}`;
  element.style.setProperty('--slot-color', PLAYERS[index].color);
  const color = document.createElement('span');
  color.className = 'slot-color';
  const name = document.createElement('strong');
    name.textContent = player.name || 'Open seat';
  if (index === seat) name.textContent += ' (YOU)';
  if (index === seat) element.classList.add('you');
  const status = document.createElement('span');
    status.textContent = `${PLAYERS[index].label} · ${player.connected ? 'CONNECTED' : player.name ? 'DISCONNECTED' : 'EMPTY'}`;
  element.append(color, name, status);
  return element;
}

function makeInviteLink(code) {
  const link = new URL(window.location.href);
  link.searchParams.set('room', code);
  return link.toString();
}

function beginLocalGame(mode, levelIndex) {
  const continuingCampaign = campaignMode === mode && campaignNextLevel === levelIndex;
  if (!continuingCampaign) campaignBlame = [0, 0, 0, 0];
  campaignMode = mode;
  campaignNextLevel = levelIndex + 1;
  connection?.close();
  connection = null;
  localGame = true;
  onlineGame = false;
  paused = false;
  tutorialVisible = true;
  selectedMode = mode;
  selectedLevel = levelIndex;
  renderer.resetCamera();
  renderer.setMySeat(null);
  gameState = createGameState(levels[levelIndex], mode);
  previousLocalState = { ...gameState, raft: { ...gameState.raft } };
  gameState.blame = [...campaignBlame];
  lastState = 'playing';
  pendingInputs.clear();
  showScreen('game');
  $('#touch-controls').hidden = !matchMedia('(pointer: coarse)').matches;
  setConnectionStatus('connected');
  audio.start();
  updateGameUI();
}

function beginOnlineGame(state, levelIndex) {
  campaignMode = null;
  onlineGame = true;
  localGame = false;
  paused = false;
  selectedLevel = levelIndex;
  renderer.resetCamera();
  renderer.setMySeat(seat);
  selectedMode = room?.mode || state.mode || 'coop';
  gameState = state;
  previousLocalState = { ...state, raft: { ...state.raft } };
  lastState = 'playing';
  showScreen('game');
  $('#ping-label').hidden = false;
  $('#touch-controls').hidden = !matchMedia('(pointer: coarse)').matches;
  audio.start();
  updateGameUI();
}

function renderGasMeter() {
  $('#gas-meter').replaceChildren(...PLAYERS.map((player, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = `gas-player${onlineGame && index === seat ? ' me' : ''}`;
    wrapper.innerHTML = `<span>${player.key.toUpperCase()}</span><div class="gas-track"><div class="gas-fill" style="width:${Math.round((1 - (gameState.cooldowns[index] || 0) / PHYSICS.fartCooldown) * 100)}%"></div></div>`;
    return wrapper;
  }));
}

function updateGameUI() {
  if (!gameState) return;
  const level = levels[selectedLevel];
  $('#hud-stage').textContent = `STAGE ${String(level.id).padStart(2, '0')}`;
  $('#hud-title').textContent = level.name;
  $('#heart-meter').textContent = `${'♥ '.repeat(gameState.health)}${'♡ '.repeat(3 - gameState.health)}`;
  $('#timer').textContent = `${String(Math.floor(gameState.remaining / 60)).padStart(2, '0')}:${String(Math.floor(gameState.remaining % 60)).padStart(2, '0')}`;
  $('#progress-fill').style.width = `${Math.min(100, Math.max(0, gameState.raft.y / level.length * 100))}%`;
  renderGasMeter();
  if (selectedLevel === 0 && tutorialVisible && gameState.elapsed < 10) {
    $('#tutorial').textContent = gameState.elapsed < 4 ? 'Press Q on the top side to push downstream.' : 'Work together. The grass is downstream.';
  } else $('#tutorial').textContent = '';
  if (connection) $('#ping-label').textContent = connection.ping === null ? 'PING --' : `PING ${Math.round(connection.ping)} ms`;
  const youLabel = $('#you-label');
  youLabel.hidden = !onlineGame;
  if (onlineGame) youLabel.textContent = `YOU ARE ${PLAYERS[seat].label}`;
}

function checkGameEnd() {
  if (!gameState || !['won', 'lost'].includes(gameState.status) || gameState.status === lastState) return;
  lastState = gameState.status;
  localGame = false;
  if (gameState.status === 'won') {
    audio.win();
    if (gameState.stars > Number(progress[levels[selectedLevel].id] || 0)) {
      progress[levels[selectedLevel].id] = gameState.stars;
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    }
  } else audio.lose();
  campaignBlame = [...gameState.blame];
  $('#results-eyebrow').textContent = gameState.status === 'won' ? 'RIVER REPORT · MADE IT' : 'RIVER REPORT · WASHED OUT';
  $('#results-title').textContent = gameState.status === 'won' ? ['A fine float.', 'Nice teamwork.', 'River legends.'][gameState.stars - 1] : 'Into the drink.';
  const finalBlameWinner = selectedMode === 'blame' && selectedLevel === levels.length - 1
    ? Math.min(...campaignBlame)
    : null;
  const winningSeats = finalBlameWinner === null ? [] : campaignBlame.map((score, index) => score === finalBlameWinner ? index : -1).filter((index) => index >= 0);
  const blameResult = winningSeats.length > 1
    ? `Least-blame tie: ${winningSeats.map((index) => seatNames[index]).join(', ')}.`
    : winningSeats.length === 1 ? `${seatNames[winningSeats[0]]} finishes with the least blame.` : '';
  $('#results-copy').textContent = gameState.status === 'won'
    ? `Finished ${levels[selectedLevel].name} with ${gameState.health} raft hearts.${blameResult ? ` ${blameResult}` : ''}`
    : `${gameState.health} hearts left. The river won this round.`;
  $('#result-stars').textContent = `${'★ '.repeat(gameState.stars)}${'☆ '.repeat(3 - gameState.stars)}`;
  $('#next-button').hidden = gameState.status !== 'won' || selectedLevel >= levels.length - 1;
  $('#next-button').textContent = onlineGame ? 'Return to lobby ↗' : 'Next river ↗';
  $('#blame-board').replaceChildren(...(selectedMode === 'blame' ? campaignBlame.map((score, index) => {
    const item = document.createElement('div');
    item.className = 'blame-score';
    item.style.color = PLAYERS[index].color;
    const isWinner = finalBlameWinner !== null && score === finalBlameWinner;
    item.innerHTML = `<strong>${seatNames[index]} · ${score}${isWinner && winningSeats.length === 1 ? ' · WINNER' : ''}</strong><span>BLAME POINTS</span>`;
    return item;
  }) : []));
  showScreen('results-screen');
  $('#touch-controls').hidden = true;
  // Show physics sliders only in local play (they have no effect on the server in online mode)
  document.querySelector('.physics-tuning').hidden = Boolean(onlineGame);
  if (gameState.status === 'won') makeConfetti();
}

function makeConfetti() {
  const colors = ['#e66d59', '#f3bf55', '#53b7a6', '#83a5df'];
  $('#confetti-layer').replaceChildren(...Array.from({ length: 32 }, (_, index) => {
    const piece = document.createElement('span');
    piece.className = 'confetti';
    piece.style.left = `${(index * 37) % 100}%`;
    piece.style.top = `${(index * 23) % 30}%`;
    piece.style.setProperty('--confetti', colors[index % colors.length]);
    piece.style.setProperty('--drift', `${(index % 2 ? 1 : -1) * (20 + index % 40)}px`);
    piece.style.animationDelay = `${(index % 8) * 0.08}s`;
    return piece;
  }));
}

function triggerFart(pressedId) {
  const playerId = onlineGame ? seat : pressedId;
  if (paused || (!localGame && !onlineGame) || gameState.status !== 'playing') return;
  if (gameState.cooldowns[playerId] > 0) return;
  audio.fart();
  // Particles are now spawned in draw() from state.bursts so they work for all players including online/bots
  if (localGame) pendingInputs.add(playerId);
  if (onlineGame) connection?.send({ type: 'input', seat });
}

function interpolateOnlineState(now) {
  if (snapshotHistory.length < 2) return gameState;
  const latest = snapshotHistory[snapshotHistory.length - 1];
  const previous = snapshotHistory[snapshotHistory.length - 2];
  const alpha = Math.min(1, Math.max(0, (now - latest.receivedAt + 80) / (latest.receivedAt - previous.receivedAt)));
  const interpolated = { ...latest.state, raft: { ...latest.state.raft } };
  for (const key of ['x', 'y', 'vx', 'vy', 'angle', 'angularVelocity']) {
    interpolated.raft[key] = previous.state.raft[key] + (latest.state.raft[key] - previous.state.raft[key]) * alpha;
  }
  return interpolated;
}

function interpolateLocalState(amount) {
  if (!localGame || paused) return gameState;
  const interpolated = { ...gameState, raft: { ...gameState.raft } };
  for (const key of ['x', 'y', 'vx', 'vy', 'angle', 'angularVelocity']) {
    interpolated.raft[key] = previousLocalState.raft[key] + (gameState.raft[key] - previousLocalState.raft[key]) * amount;
  }
  return interpolated;
}

function frame(now) {
  const delta = Math.min(0.08, (now - frame.last) / 1000 || 0);
  frame.last = now;
  fpsFrames += 1;
  if (now - fpsSampleStart >= 500) {
    fps = Math.round(fpsFrames * 1000 / (now - fpsSampleStart));
    fpsFrames = 0;
    fpsSampleStart = now;
  }
  if (localGame && !paused) {
    frame.accumulator += delta;
    while (frame.accumulator >= PHYSICS.fixedStep) {
      previousLocalState = { ...gameState, raft: { ...gameState.raft } };
      tickGame(gameState, levels[selectedLevel], [...pendingInputs], PHYSICS.fixedStep, selectedMode === 'solo' ? [1, 2, 3] : []);
      pendingInputs.clear();
      if (gameState.event?.type === 'hit') { audio.splash(); renderer.emit('hit', 0, 22, gameState.raft); }
      frame.accumulator -= PHYSICS.fixedStep;
      checkGameEnd();
    }
  }
  if (onlineGame && connection?.ping !== null) $('#ping-label').textContent = `PING ${Math.round(connection.ping)} ms`;
  const renderState = onlineGame ? interpolateOnlineState(now) : interpolateLocalState(frame.accumulator / PHYSICS.fixedStep);
  renderer.draw(renderState, levels[selectedLevel], now, { paused, activeGame: !$('#hud').hidden, debug: debugEnabled, fps });
  uiTimer += delta;
  if (uiTimer > 0.12 && !$('#hud').hidden) { updateGameUI(); uiTimer = 0; }
  requestAnimationFrame(frame);
}
frame.last = performance.now();
frame.accumulator = 0;

function buildTouchControls() {
  $('#touch-controls').replaceChildren(...PLAYERS.map((player, index) => {
    const button = document.createElement('button');
    button.className = 'touch-zone';
    button.innerHTML = `<span>◉</span><strong>${player.label}</strong>`;
    button.addEventListener('pointerdown', (event) => { event.preventDefault(); triggerFart(index); });
    return button;
  }));
}

$('#menu-screen').addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'play') showScreen('select-screen');
  if (action === 'online') showScreen('online-screen');
});

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'home') {
    connection?.close(); connection = null; room = null; onlineGame = false; localGame = false; paused = false; lastState = 'idle';
    campaignMode = null;
    setConnectionStatus('connected'); showScreen('menu-screen'); renderLevelOptions();
  }
  if (action === 'start') beginLocalGame(selectedMode, selectedLevel);
  if (action === 'camera') {
    settings.partyCamera = !settings.partyCamera;
    renderer.settings.partyCamera = settings.partyCamera;
    $('#camera-button').title = settings.partyCamera ? 'Switch to chase camera' : 'Switch to party camera';
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  if (action === 'create-room') connectOnline('create');
  if (action === 'copy-link') {
    try { await navigator.clipboard.writeText(makeInviteLink(room.code)); toast('Invite link copied.'); }
    catch { toast('Copy the link from the room address bar.'); }
  }
  if (action === 'online-start') {
    if (room?.hostSeat !== seat) return;
    connection?.send({ type: 'start' });
  }
  if (action === 'pause') {
    if (onlineGame) { toast('The river keeps moving online.'); return; }
    paused = true; showScreen('pause-screen');
  }
  if (action === 'resume') { paused = false; showScreen('game'); }
  if (action === 'quit') { paused = false; localGame = false; lastState = 'idle'; campaignMode = null; showScreen('menu-screen'); }
  if (action === 'next') {
    if (onlineGame) { connection?.send({ type: 'next' }); onlineGame = false; showScreen('lobby-screen'); }
    else beginLocalGame(selectedMode, Math.min(levels.length - 1, selectedLevel + 1));
  }
  if (action === 'retry') {
    if (onlineGame) { connection?.send({ type: 'retry' }); }
    else beginLocalGame(selectedMode, selectedLevel);
  }
  if (action === 'close-settings') $('#settings-panel').hidden = true;
});

$('#select-screen').addEventListener('click', (event) => {
  const modeButton = event.target.closest('[data-mode]');
  if (modeButton) setMode(modeButton.dataset.mode);
  const levelButton = event.target.closest('[data-level]');
  if (levelButton) { selectedLevel = Number(levelButton.dataset.level); renderLevelOptions(); }
});

$('#join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const code = $('#room-code').value.trim().toUpperCase();
  if (code.length !== 4) { $('#online-message').textContent = 'Room codes have four letters.'; return; }
  connectOnline('join', code);
});
$('#room-code').addEventListener('input', (event) => { event.target.value = event.target.value.replace(/[^a-z]/gi, '').toUpperCase(); });
$('#lobby-mode').addEventListener('change', (event) => connection?.send({ type: 'pick', mode: event.target.value, levelIndex: Number($('#lobby-level').value) }));
$('#lobby-level').addEventListener('change', (event) => connection?.send({ type: 'pick', mode: $('#lobby-mode').value, levelIndex: Number(event.target.value) }));
$('#settings-button').addEventListener('click', () => { $('#settings-panel').hidden = !$('#settings-panel').hidden; });
$('#quality-select').value = settings.renderQuality;
$('#quality-select').addEventListener('change', (event) => {
  settings.renderQuality = event.target.value;
  renderer.setQuality(settings.renderQuality);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
});
$('#camera-button').title = settings.partyCamera ? 'Switch to chase camera' : 'Switch to party camera';
$('#mute-button').addEventListener('click', () => {
  audio.enabled = !audio.enabled;
  settings.sound = audio.enabled;
  $('#sound-toggle').checked = audio.enabled;
  $('#mute-button').dataset.muted = String(!audio.enabled);
  $('#mute-button').title = audio.enabled ? 'Mute sound effects' : 'Unmute sound effects';
  $('#mute-button').setAttribute('aria-label', $('#mute-button').title);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
});

for (const [setting, selector, field] of [['sound', '#sound-toggle', 'enabled'], ['music', '#music-toggle', 'music'], ['screenShake', '#shake-toggle', 'screenShake'], ['colorblind', '#colorblind-toggle', 'colorblind']]) {
  $(selector).checked = settings[setting];
  $(selector).addEventListener('change', (event) => {
    settings[setting] = event.target.checked;
    renderer.settings[field] = event.target.checked;
    if (setting === 'sound') audio.enabled = event.target.checked;
    if (setting === 'music') audio.setMusic(event.target.checked);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  });
}
$('#mute-button').dataset.muted = String(!settings.sound);
$('#mute-button').title = settings.sound ? 'Mute sound effects' : 'Unmute sound effects';
$('#mute-button').setAttribute('aria-label', $('#mute-button').title);

document.querySelectorAll('[data-physics-config]').forEach((input) => {
  const key = input.dataset.physicsConfig;
  const output = input.parentElement.querySelector('output');
  const updateOutput = () => { output.value = `${CONFIG[key]}${['thrustDuration', 'cooldown'].includes(key) ? ' s' : ''}`; };
  input.value = CONFIG[key];
  updateOutput();
  input.addEventListener('input', () => {
    CONFIG[key] = Number(input.value);
    updateOutput();
    localStorage.setItem(physicsTuningKey, JSON.stringify(Object.fromEntries(Object.keys(physicsRanges).map((name) => [name, CONFIG[name]]))));
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'F1') {
    event.preventDefault();
    debugEnabled = !debugEnabled;
    toast(debugEnabled ? 'Physics debug on' : 'Physics debug off');
    return;
  }
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (event.repeat) return;
  const player = PLAYERS.find((item) => item.key === event.key.toLowerCase());
  if (player) { event.preventDefault(); triggerFart(player.id); }
  if (event.key === 'Escape' && localGame && !$('#pause-screen').hidden) { paused = false; showScreen('game'); }
  else if (event.key === 'Escape' && localGame && !$('#hud').hidden) { paused = true; showScreen('pause-screen'); }
});

window.addEventListener('beforeunload', () => connection?.close());

renderLevelOptions();
buildTouchControls();
if (ROOM_FROM_LINK) {
  showScreen('online-screen');
  $('#room-code').value = ROOM_FROM_LINK;
  connectOnline('join', ROOM_FROM_LINK);
}
requestAnimationFrame(frame);
