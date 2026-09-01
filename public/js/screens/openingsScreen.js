import { Chess } from 'chess.js';
import { navigate } from '../router.js';
import { createBoard } from '../ui/board.js';

// Openings trainer: an explore board where every legal move is allowed, the
// current position is named live from the lichess openings dataset, popular
// continuations are offered, and a curated grid of common openings can be played
// out move by move.
export const openingsScreen = {
  async mount(root) {
    const wrap = document.createElement('div');
    wrap.className = 'screen openings-screen';
    wrap.innerHTML = `
      <div class="openings-main">
        <div class="board-host"></div>
        <div class="review-controls">
          <button class="btn btn-ghost nav-btn" data-nav="back" title="Back one move (←)">◀ Back</button>
          <button class="btn btn-ghost nav-btn" data-nav="reset" title="Reset">Reset</button>
          <button class="btn btn-ghost nav-btn" data-nav="flip" title="Flip">⇅</button>
        </div>
      </div>
      <aside class="openings-side">
        <div class="analysis-header">
          <h2>Openings</h2>
          <button class="text-link back-link">← Menu</button>
        </div>
        <div class="current-opening">
          <div class="co-eco">—</div>
          <div class="co-name">Start position</div>
          <div class="co-moves"></div>
        </div>
        <div class="continuations">
          <h3 class="side-h3">Continuations</h3>
          <div class="cont-list"></div>
        </div>
        <div class="basics">
          <h3 class="side-h3">Common openings</h3>
          <div class="basics-grid"></div>
        </div>
      </aside>
    `;
    root.appendChild(wrap);

    // Load the datasets (cached by the browser after first fetch).
    let openings = [];
    let basics = [];
    try {
      [openings, basics] = await Promise.all([
        fetch('/data/openings.json').then((r) => r.json()),
        fetch('/data/openings-basics.json').then((r) => r.json()),
      ]);
    } catch {
      wrap.querySelector('.co-name').textContent = 'Could not load opening data.';
    }
    // Index by exact SAN sequence for O(1) name lookup.
    const byLine = new Map();
    for (const o of openings) byLine.set(o.san.join(' '), o);

    const chess = new Chess();
    let orientation = 'w';
    let sanHistory = [];

    const board = createBoard({
      mount: wrap.querySelector('.board-host'),
      orientation,
      onMove: (from, to, promo) => play({ from, to, promotion: promo }),
      legalMovesFor: (sq) => {
        const piece = chess.get(sq);
        if (!piece || piece.color !== chess.turn()) return [];
        return chess.moves({ square: sq, verbose: true }).map((m) => m.to);
      },
    });

    function play(move) {
      const res = chess.move(move);
      if (!res) return;
      sanHistory.push(res.san);
      board.setPosition(chess.fen());
      board.highlightLastMove(res.from, res.to);
      update();
    }

    function loadLine(sanArr) {
      chess.reset();
      sanHistory = [];
      for (const san of sanArr) {
        const res = chess.move(san);
        if (!res) break;
        sanHistory.push(res.san);
      }
      board.setPosition(chess.fen());
      if (sanHistory.length) {
        const last = chess.history({ verbose: true }).slice(-1)[0];
        board.highlightLastMove(last.from, last.to);
      }
      update();
    }

    // Deepest named line that is a prefix of the current moves.
    function currentOpening() {
      let best = null;
      for (let n = sanHistory.length; n >= 1; n--) {
        const hit = byLine.get(sanHistory.slice(0, n).join(' '));
        if (hit) {
          best = hit;
          break;
        }
      }
      return best;
    }

    // Named continuations: openings that extend the current line by at least one
    // move, grouped by the next move played.
    function continuations() {
      const prefix = sanHistory.join(' ');
      const depth = sanHistory.length;
      const byNext = new Map();
      for (const o of openings) {
        if (o.san.length <= depth) continue;
        if (depth > 0 && o.san.slice(0, depth).join(' ') !== prefix) continue;
        const next = o.san[depth];
        if (!byNext.has(next)) byNext.set(next, o);
      }
      return [...byNext.entries()]
        .map(([move, o]) => ({ move, name: o.name, eco: o.eco }))
        .slice(0, 10);
    }

    function update() {
      const co = currentOpening();
      wrap.querySelector('.co-eco').textContent = co ? co.eco : '—';
      wrap.querySelector('.co-name').textContent = co ? co.name : 'Start position';
      wrap.querySelector('.co-moves').textContent = formatMoves(sanHistory);

      const contEl = wrap.querySelector('.cont-list');
      contEl.innerHTML = '';
      const conts = continuations();
      if (!conts.length) {
        contEl.innerHTML = '<div class="op-empty">No named continuations — you\'re out of book.</div>';
      }
      for (const c of conts) {
        const btn = document.createElement('button');
        btn.className = 'cont-btn';
        btn.innerHTML = `<span class="cont-move">${c.move}</span><span class="cont-name">${c.name}</span>`;
        btn.addEventListener('click', () => play(sanToMove(c.move)));
        contEl.appendChild(btn);
      }
    }

    // Convert a SAN string into a move object chess.js can apply from here.
    function sanToMove(san) {
      const legal = chess.moves({ verbose: true });
      const hit = legal.find((m) => m.san === san || m.san.replace(/[+#]/, '') === san.replace(/[+#]/, ''));
      return hit ? { from: hit.from, to: hit.to, promotion: hit.promotion } : san;
    }

    // Render the curated grid.
    const grid = wrap.querySelector('.basics-grid');
    for (const b of basics) {
      const btn = document.createElement('button');
      btn.className = 'basic-btn';
      btn.innerHTML = `<span class="basic-eco">${b.eco}</span><span class="basic-name">${b.name}</span>`;
      btn.addEventListener('click', () => loadLine(b.san));
      grid.appendChild(btn);
    }

    // Controls
    wrap.querySelector('[data-nav="back"]').addEventListener('click', () => {
      if (!sanHistory.length) return;
      chess.undo();
      sanHistory.pop();
      board.setPosition(chess.fen());
      const last = chess.history({ verbose: true }).slice(-1)[0];
      if (last) board.highlightLastMove(last.from, last.to);
      update();
    });
    wrap.querySelector('[data-nav="reset"]').addEventListener('click', () => loadLine([]));
    wrap.querySelector('[data-nav="flip"]').addEventListener('click', () => {
      orientation = orientation === 'w' ? 'b' : 'w';
      board.setOrientation(orientation);
      board.setPosition(chess.fen());
    });
    wrap.querySelector('.back-link').addEventListener('click', () => navigate('menu'));

    this._onKey = (e) => {
      if (e.key === 'ArrowLeft') wrap.querySelector('[data-nav="back"]').click();
    };
    window.addEventListener('keydown', this._onKey);

    update();
  },

  unmount() {
    if (this._onKey) window.removeEventListener('keydown', this._onKey);
  },
};

function formatMoves(sanArr) {
  let out = '';
  for (let i = 0; i < sanArr.length; i += 2) {
    out += `${i / 2 + 1}. ${sanArr[i]} ${sanArr[i + 1] || ''} `;
  }
  return out.trim();
}
