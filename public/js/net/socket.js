// Thin WebSocket client with typed event handlers and automatic reconnect.
// One shared instance is created lazily by getSocket().
class GameSocket {
  constructor() {
    this.ws = null;
    this.handlers = new Map(); // type -> Set<fn>
    this.openHandlers = new Set();
    this.closeHandlers = new Set();
    this.shouldReconnect = false;
    this.backoff = 500;
  }

  connect() {
    this.shouldReconnect = true;
    this._open();
  }

  _open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);

    this.ws.addEventListener('open', () => {
      this.backoff = 500;
      for (const fn of this.openHandlers) fn();
    });

    this.ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      const set = this.handlers.get(msg.type);
      if (set) for (const fn of set) fn(msg);
    });

    this.ws.addEventListener('close', () => {
      for (const fn of this.closeHandlers) fn();
      if (this.shouldReconnect) {
        setTimeout(() => this._open(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 8000);
      }
    });
  }

  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }

  onOpen(fn) {
    this.openHandlers.add(fn);
    return () => this.openHandlers.delete(fn);
  }

  onClose(fn) {
    this.closeHandlers.add(fn);
    return () => this.closeHandlers.delete(fn);
  }

  close() {
    this.shouldReconnect = false;
    if (this.ws) this.ws.close();
  }
}

let instance = null;
export function getSocket() {
  if (!instance) instance = new GameSocket();
  return instance;
}
