import { navigate } from '../router.js';
import { store } from '../store.js';
import { getSocket } from '../net/socket.js';

// Shows the "finding an opponent" state, joins the matchmaking queue, and
// hands off to the game screen once the server reports a match.
export const queueScreen = {
  mount(root) {
    const socket = getSocket();
    let matched = false;

    const wrap = document.createElement('div');
    wrap.className = 'screen queue-screen';
    wrap.innerHTML = `
      <div class="card queue-card">
        <div class="pulse"><span></span><span></span><span></span></div>
        <h3>Finding an opponent…</h3>
        <p class="queue-sub">Estimated wait: a few seconds</p>
        <button class="text-link cancel-link">Cancel</button>
      </div>
    `;
    const subEl = wrap.querySelector('.queue-sub');

    const offMatch = socket.on('match_found', (msg) => {
      matched = true;
      store.set({ mode: 'online', gameId: msg.gameId, playerColor: msg.color });
      navigate('game', { initialFen: msg.fen, clock: msg.clock });
    });
    const offQueued = socket.on('queued', (msg) => {
      subEl.textContent = msg.position > 1
        ? `You're #${msg.position} in the queue…`
        : 'Estimated wait: a few seconds';
    });

    const join = () => socket.send('queue_join');
    const offOpen = socket.onOpen(join);
    socket.connect();
    if (socket.ws && socket.ws.readyState === WebSocket.OPEN) join();

    wrap.querySelector('.cancel-link').addEventListener('click', () => {
      socket.send('queue_cancel');
      navigate('menu');
    });

    this._cleanup = () => {
      offMatch();
      offQueued();
      offOpen();
      // If leaving the queue without a match, make sure we're dequeued.
      if (!matched) socket.send('queue_cancel');
    };

    root.appendChild(wrap);
  },

  unmount() {
    if (this._cleanup) this._cleanup();
  },
};
