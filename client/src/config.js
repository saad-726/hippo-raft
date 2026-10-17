const queryServer = new URLSearchParams(window.location.search).get('server');
const configuredServer = queryServer || window.HIPPO_RAFT_SERVER_URL || '';

export const SERVER_URL = configuredServer
  ? configuredServer.replace(/^http/, 'ws').replace(/\/$/, '')
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:3001`;
export const ROOM_FROM_LINK = new URLSearchParams(window.location.search).get('room')?.toUpperCase() || '';
export const SETTINGS_KEY = 'hippo-raft-settings';
export const PROGRESS_KEY = 'hippo-raft-stars';
