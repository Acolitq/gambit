import { Chess } from 'chess.js';
import { navigate } from '../router.js';
import { createBoard } from '../ui/board.js';
import { getEngine } from '../analysis/engineSingleton.js';
import { formatEval, numberedLine } from '../analysis/evalFormat.js';

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
          <button class="btn btn-ghost nav-btn" data-nav="back" title="Back one move (←)" aria-label="Back one move"><i data-lucide="chevron-left"></i></button>
          <button class="btn btn-ghost nav-btn" data-nav="reset" title="Reset">Reset</button>
          <button class="btn btn-ghost nav-btn" data-nav="flip" title="Flip" aria-label="Flip board"><i data-lucide="arrow-up-down"></i></button>
        </div>
      </div>
      <aside class="openings-side">
        <div class="analysis-header">
          <h2>Openings</h2>
          <button class="text-link back-link"><i data-lucide="arrow-left"></i> Menu</button>
        </div>
        <div class="current-opening">
          <div class="co-eco">—</div>
          <div class="co-name">Start position</div>
          <div class="co-moves"></div>
        </div>
        <div class="engine-panel">
          <div class="engine-head">
            <span class="engine-title">Engine</span>
            <span class="engine-depth"></span>
          </div>
          <div class="engine-lines"></div>
        </div>
        <div class="continuations">
          <h3 class="side-h3">Continuations</h3>
          <div class="cont-list"></div>
        </div>
        <div class="opening-info">
          <h3 class="side-h3">About this opening</h3>
          <p class="oi-desc">Play a move to see the opening named, a short description, and its main line.</p>
          <div class="oi-mainline-wrap" hidden>
            <div class="oi-label">Main line</div>
            <div class="oi-mainline mono"></div>
          </div>
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
    // Show the starting pieces immediately.
    board.setPosition(chess.fen());

    // Live engine for the current position (eval + best lines).
    const engineDepthEl = wrap.querySelector('.engine-depth');
    const engineLinesEl = wrap.querySelector('.engine-lines');
    let engine = null;
    try {
      engine = getEngine();
    } catch {
      engine = null;
    }
    function runEngine(fen) {
      if (!engine) return;
      engineLinesEl.classList.add('thinking');
      engine
        .analyze(fen, { depth: 18, multiPv: 2, onUpdate: (lines) => renderEngineLines(lines, fen) })
        .then((lines) => {
          engineLinesEl.classList.remove('thinking');
          renderEngineLines(lines, fen);
        });
    }
    function renderEngineLines(lines, fen) {
      if (!lines.length) return;
      engineDepthEl.textContent = `depth ${lines[0].depth}`;
      engineLinesEl.innerHTML = '';
      for (const line of lines) {
        const sans = pvToSan(fen, line.pv, 6);
        const row = document.createElement('div');
        row.className = 'engine-line';
        const positive = (line.mate ?? line.scoreCp ?? 0) >= 0;
        row.innerHTML = `
          <span class="el-eval ${positive ? 'pos' : 'neg'}">${formatEval({ scoreCp: line.scoreCp, mate: line.mate })}</span>
          <span class="el-moves">${numberedLine(fen, sans)}</span>
        `;
        engineLinesEl.appendChild(row);
      }
    }

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

    const oiDesc = wrap.querySelector('.oi-desc');
    const oiMlWrap = wrap.querySelector('.oi-mainline-wrap');
    const oiMl = wrap.querySelector('.oi-mainline');

    function update() {
      const co = currentOpening();
      wrap.querySelector('.co-eco').textContent = co ? co.eco : '—';
      wrap.querySelector('.co-name').textContent = co ? co.name : 'Start position';
      wrap.querySelector('.co-moves').textContent = formatMoves(sanHistory);

      // Description + main line for the current opening.
      if (co) {
        oiDesc.textContent = describeOpening(co);
        oiMl.textContent = numberedLine(START_FEN_FULL, co.san);
        oiMlWrap.hidden = false;
      } else {
        oiDesc.textContent = 'Play a move to see the opening named, a short description, and its main line.';
        oiMlWrap.hidden = true;
      }

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

      runEngine(chess.fen());
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
    try {
      getEngine().stop();
    } catch {
      /* engine may not exist */
    }
  },
};

const START_FEN_FULL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Short, factual blurbs for the most common openings, matched on the opening
// name. Anything not listed gets a sensible generated description.
const DESCRIPTIONS = [
  ['sicilian', "Black meets 1.e4 with 1...c5, fighting for the centre asymmetrically. It's the most popular and most combative answer to e4, giving sharp, unbalanced middlegames."],
  ['french', 'After 1.e4 e6 Black builds a solid pawn chain and strikes with ...d5. Reliable and strategic, though the light-squared bishop can be hard to free.'],
  ['caro-kann', '1.e4 c6 prepares ...d5 with a rock-solid structure — a sound, low-risk defence that keeps the pieces coordinated.'],
  ['ruy lopez', '1.e4 e5 2.Nf3 Nc6 3.Bb5 pressures the knight guarding e5. One of the oldest and deepest openings, full of long-term strategic ideas.'],
  ['spanish', '1.e4 e5 2.Nf3 Nc6 3.Bb5 pressures the knight guarding e5. One of the oldest and deepest openings, full of long-term strategic ideas.'],
  ['italian', '1.e4 e5 2.Nf3 Nc6 3.Bc4 eyes f7 and develops quickly. It ranges from quiet manoeuvring to sharp, direct attacks.'],
  ["queen's gambit", "1.d4 d5 2.c4 offers a pawn to pull Black's centre aside. Classical and strategically rich, whether the gambit is accepted or declined."],
  ['king’s indian', 'Black lets White build a big centre, then counter-attacks with ...e5 and a kingside pawn storm. Dynamic and double-edged.'],
  ["king's indian", 'Black lets White build a big centre, then counter-attacks with ...e5 and a kingside pawn storm. Dynamic and double-edged.'],
  ['nimzo-indian', '1.d4 Nf6 2.c4 e6 3.Nc3 Bb4 pins the knight and fights for the centre with pieces. Sound and flexible at every level.'],
  ['english', '1.c4 controls d5 from the flank and often transposes into rich strategic play. Flexible and less forcing than 1.e4.'],
  ['london', 'White plays an early Bf4 and sets up a solid, easy-to-learn system that works against almost anything Black tries.'],
  ['scandinavian', '1.e4 d5 challenges the centre at once. Straightforward to learn, though Black often spends a tempo or two with the queen.'],
  ['pirc', 'Black fianchettoes and lets White occupy the centre, aiming to undermine it later. Hypermodern and flexible.'],
  ['modern', 'Black fianchettoes and lets White occupy the centre, aiming to undermine it later. Hypermodern and flexible.'],
  ['scotch', '1.e4 e5 2.Nf3 Nc6 3.d4 opens the centre early for fast piece play and clear plans.'],
  ['vienna', '1.e4 e5 2.Nc3 keeps options open, often preparing f4 for a quick kingside push.'],
  ['slav', '1.d4 d5 2.c4 c6 supports the centre without shutting in the light-squared bishop — solid and dependable.'],
  ['grünfeld', 'Black lets White build a broad centre, then blasts it with ...d5 and piece pressure. Sharp and theory-heavy.'],
  ['grunfeld', 'Black lets White build a broad centre, then blasts it with ...d5 and piece pressure. Sharp and theory-heavy.'],
];

function describeOpening(o) {
  const name = (o.name || '').toLowerCase();
  for (const [key, text] of DESCRIPTIONS) {
    if (name.includes(key)) return text;
  }
  return `The ${o.name} (${o.eco}) arises after ${numberedLine(START_FEN_FULL, o.san)}. From here both sides follow well-mapped plans — try the continuations above to see how the main lines branch.`;
}

// Convert a UCI principal variation into SAN, played from `fen`, capped at `max`.
function pvToSan(fen, uciMoves, max) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of (uciMoves || []).slice(0, max)) {
    const res = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
    });
    if (!res) break;
    out.push(res.san);
  }
  return out;
}

function formatMoves(sanArr) {
  let out = '';
  for (let i = 0; i < sanArr.length; i += 2) {
    out += `${i / 2 + 1}. ${sanArr[i]} ${sanArr[i + 1] || ''} `;
  }
  return out.trim();
}
