import { SERVER_URL } from '../config.js';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

export class GameConnection {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.socket = null;
    this.pingStarted = 0;
    this.ping = null;
    this.pingTimer = null;
    this.retryCount = 0;
    this.intentionalClose = false;
    this.retryTimer = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.intentionalClose = false;
      this.socket = new WebSocket(SERVER_URL);
      const timeout = window.setTimeout(() => reject(new Error('The river server is taking a while to wake up.')), 12000);
      this.socket.addEventListener('open', () => {
        window.clearTimeout(timeout);
        this.retryCount = 0;
        this.onStatus('connected');
        this.pingTimer = window.setInterval(() => this.measurePing(), 2500);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        window.clearTimeout(timeout);
        this.onStatus('offline');
        reject(new Error('Could not reach the river server. It may be waking up.'));
      }, { once: true });
      this.socket.addEventListener('close', () => {
        this.onStatus('offline');
        window.clearInterval(this.pingTimer);
        // Auto-reconnect: retry up to MAX_RETRIES times unless closed intentionally.
        if (!this.intentionalClose && this.retryCount < MAX_RETRIES) {
          this.retryCount += 1;
          this.retryTimer = window.setTimeout(() => {
            this.connect().catch(() => {}); // errors are handled internally
          }, RETRY_DELAY_MS);
        }
      });
      this.socket.addEventListener('message', (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'pong') {
          this.ping = performance.now() - this.pingStarted;
          return;
        }
        this.onMessage(message);
      });
    });
  }

  measurePing() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.pingStarted = performance.now();
    this.send({ type: 'ping' });
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close() {
    this.intentionalClose = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    this.socket?.close();
    this.socket = null;
  }
}
