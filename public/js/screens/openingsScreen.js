import { Chess } from 'chess.js';
import { navigate, refreshIcons } from '../router.js';
import { createBoard } from '../ui/board.js';
import { getEngine } from '../analysis/engineSingleton.js';
import { formatEval, numberedLine } from '../analysis/evalFormat.js';

// Openings: a horizontally scrolling strip of well-known openings across the
// top. Picking one loads its main line and resets the board to the starting
// position; → / ← (or the buttons) then step through that line only. Moves
// played by hand on the board branch off into free exploration — the position
// is still named live from the lichess dataset, with popular continuations and
// a live engine.
export const openingsScreen = {
  async mount(root) {
    const wrap = document.createElement('div');
    wrap.className = 'screen openings-screen';
    wrap.innerHTML = `
      <div class="scout-head openings-head">
        <div>
          <h1>Openings</h1>
          <p class="scout-tagline">Pick an opening, then step through its main line with the arrow buttons or ← →.</p>
        </div>
        <button class="text-link back-link"><i data-lucide="arrow-left"></i> Menu</button>
      </div>

      <section class="ol-strip-wrap" aria-label="Openings">
        <div class="ol-strip-head">
          <span class="section-label">Main lines</span>
          <div class="ol-strip-arrows">
            <button class="ol-strip-arrow" data-scroll="-1" aria-label="Scroll openings left"><i data-lucide="chevron-left"></i></button>
            <button class="ol-strip-arrow" data-scroll="1" aria-label="Scroll openings right"><i data-lucide="chevron-right"></i></button>
          </div>
        </div>
        <div class="ol-strip"></div>
      </section>

      <div class="openings-body">
        <div class="openings-main">
          <div class="board-host"></div>
          <div class="review-controls">
            <button class="btn btn-ghost nav-btn" data-nav="start" title="Start (Home)" aria-label="Go to start"><i data-lucide="chevrons-left"></i></button>
            <button class="btn btn-ghost nav-btn" data-nav="prev" title="Previous move (←)" aria-label="Previous move"><i data-lucide="chevron-left"></i></button>
            <button class="btn btn-ghost nav-btn" data-nav="next" title="Next move (→)" aria-label="Next move"><i data-lucide="chevron-right"></i></button>
            <button class="btn btn-ghost nav-btn" data-nav="end" title="End of line (End)" aria-label="Go to end of line"><i data-lucide="chevrons-right"></i></button>
            <button class="btn btn-ghost nav-btn" data-nav="flip" title="Flip" aria-label="Flip board"><i data-lucide="arrow-up-down"></i></button>
          </div>
        </div>

        <aside class="ol-side">
          <div class="ol-card">
            <div class="ol-card-eco">—</div>
            <div class="ol-card-name">Choose an opening</div>
            <div class="ol-card-var"></div>
            <p class="ol-card-desc">Pick one from the strip above to step through its main line. You can also play moves on the board to explore freely.</p>
            <div class="ol-live" hidden><span class="ol-live-label">Position</span> <span class="ol-live-name"></span></div>
          </div>

          <div class="ol-moves-panel">
            <div class="ol-moves-head">
              <span class="engine-title">Moves</span>
              <span class="ol-counter mono"></span>
            </div>
            <div class="ol-moves"></div>
            <div class="ol-offline" hidden>
              <span class="ol-offline-text"></span>
              <button class="text-link ol-offline-back">Back to line</button>
            </div>
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
        </aside>
      </div>
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
      wrap.querySelector('.ol-card-desc').textContent = 'Could not load opening data.';
    }
    // The user may have navigated away while the data was loading.
    if (!wrap.isConnected) return;

    // Index by exact SAN sequence for O(1) name lookup.
    const byLine = new Map();
    for (const o of openings) byLine.set(o.san.join(' '), o);

    // State: the selected opening's main line, how far along it the board is
    // (`cursor`, in plies), and any moves played by hand from that point.
    let selected = -1;
    let line = [];
    let cursor = 0;
    let extra = [];
    let orientation = 'w';
    const chess = new Chess();

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
        })
        .catch(() => {
          engineLinesEl.classList.remove('thinking');
          engineDepthEl.textContent = '';
          engineLinesEl.textContent = 'Engine unavailable.';
        });
    }
    function renderEngineLines(lines, fen) {
      // Ignore late results for a position we've already stepped away from.
      if (!lines.length || fen !== chess.fen()) return;
      engineDepthEl.textContent = `depth ${lines[0].depth}`;
      engineLinesEl.innerHTML = '';
      for (const l of lines) {
        const sans = pvToSan(fen, l.pv, 6);
        const row = document.createElement('div');
        row.className = 'engine-line';
        const positive = (l.mate ?? l.scoreCp ?? 0) >= 0;
        row.innerHTML = `
          <span class="el-eval ${positive ? 'pos' : 'neg'}">${formatEval({ scoreCp: l.scoreCp, mate: l.mate })}</span>
          <span class="el-moves">${numberedLine(fen, sans)}</span>
        `;
        engineLinesEl.appendChild(row);
      }
    }

    // --- Opening strip ---
    const strip = wrap.querySelector('.ol-strip');
    basics.forEach((o, i) => {
      const chip = document.createElement('button');
      chip.className = 'ol-chip';
      chip.setAttribute('aria-pressed', 'false');
      chip.innerHTML = `
        <span class="ol-chip-eco">${o.eco}</span>
        <span class="ol-chip-name">${o.name}</span>
        <span class="ol-chip-var">${o.variation || ''}</span>
        <span class="ol-chip-moves">${numberedLine(START_FEN_FULL, o.san.slice(0, 6))}</span>
      `;
      chip.addEventListener('click', () => select(i));
      strip.appendChild(chip);
    });

    // Scroll only the strip (not the page) so the chip sits in the middle.
    function scrollChipIntoView(chip) {
      const left = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
      strip.scrollTo({ left: Math.max(0, left), behavior: reducedMotion() ? 'auto' : 'smooth' });
    }

    const arrowBtns = wrap.querySelectorAll('.ol-strip-arrow');
    function syncArrows() {
      const max = strip.scrollWidth - strip.clientWidth - 1;
      const atStart = strip.scrollLeft <= 0;
      const atEnd = strip.scrollLeft >= max;
      arrowBtns[0].disabled = atStart;
      arrowBtns[1].disabled = atEnd;
      strip.classList.toggle('fade-left', !atStart);
      strip.classList.toggle('fade-right', !atEnd);
    }
    for (const btn of arrowBtns) {
      btn.addEventListener('click', () => {
        const dir = Number(btn.dataset.scroll);
        strip.scrollBy({ left: dir * strip.clientWidth * 0.8, behavior: reducedMotion() ? 'auto' : 'smooth' });
      });
    }
    strip.addEventListener('scroll', syncArrows, { passive: true });
    this._onResize = syncArrows;
    window.addEventListener('resize', this._onResize);

    function select(i) {
      selected = i;
      line = basics[i].san;
      extra = [];
      [...strip.children].forEach((chip, j) => {
        chip.classList.toggle('active', j === i);
        chip.setAttribute('aria-pressed', String(j === i));
      });
      scrollChipIntoView(strip.children[i]);
      goTo(0);
    }

    // --- Position ---
    // Rebuild the board from the line prefix plus any hand-played moves.
    function render() {
      chess.reset();
      for (const san of [...line.slice(0, cursor), ...extra]) chess.move(san);
      board.setPosition(chess.fen());
      const last = chess.history({ verbose: true }).slice(-1)[0];
      // No move yet: passing nulls clears the last-move highlight.
      if (last) board.highlightLastMove(last.from, last.to);
      else board.highlightLastMove(null, null);
      board.clearCheck();
      if (chess.inCheck()) board.flashCheck(kingSquare(chess, chess.turn()));
      update();
    }

    // Jump to a ply of the selected line (clamped to the line), dropping any
    // exploration.
    function goTo(ply) {
      cursor = Math.max(0, Math.min(line.length, ply));
      extra = [];
      render();
    }

    function prev() {
      if (extra.length) {
        extra.pop();
        render();
      } else if (cursor > 0) {
        goTo(cursor - 1);
      }
    }

    // A move made on the board (or from the continuations list). Playing the
    // line's next move just advances along it; anything else is exploration.
    function play(move) {
      let res;
      try {
        res = chess.move(move);
      } catch {
        return;
      }
      if (!res) return;
      if (!extra.length && cursor < line.length && res.san === line[cursor]) cursor += 1;
      else extra.push(res.san);
      render();
    }

    // Deepest named line that is a prefix of the current moves.
    function currentOpening(history) {
      for (let n = history.length; n >= 1; n--) {
        const hit = byLine.get(history.slice(0, n).join(' '));
        if (hit) return hit;
      }
      return null;
    }

    // Named continuations: openings that extend the current line by at least one
    // move, grouped by the next move played.
    function continuations(history) {
      const prefix = history.join(' ');
      const depth = history.length;
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

    const cardEco = wrap.querySelector('.ol-card-eco');
    const cardName = wrap.querySelector('.ol-card-name');
    const cardVar = wrap.querySelector('.ol-card-var');
    const cardDesc = wrap.querySelector('.ol-card-desc');
    const liveEl = wrap.querySelector('.ol-live');
    const liveName = wrap.querySelector('.ol-live-name');
    const movesEl = wrap.querySelector('.ol-moves');
    const counterEl = wrap.querySelector('.ol-counter');
    const offlineEl = wrap.querySelector('.ol-offline');
    const offlineText = wrap.querySelector('.ol-offline-text');
    const navBtn = (name) => wrap.querySelector(`[data-nav="${name}"]`);

    function update() {
      const history = [...line.slice(0, cursor), ...extra];
      const co = currentOpening(history);

      // Opening card: the selected line, or whatever the explored position is.
      if (selected >= 0) {
        const o = basics[selected];
        cardEco.textContent = o.eco;
        cardName.textContent = o.name;
        cardVar.textContent = o.variation || '';
        cardDesc.textContent = o.desc || describeOpening(o);
      } else {
        cardEco.textContent = co ? co.eco : '—';
        cardName.textContent = co ? co.name : 'Choose an opening';
        cardVar.textContent = '';
        cardDesc.textContent = co
          ? describeOpening(co)
          : 'Pick one from the strip above to step through its main line. You can also play moves on the board to explore freely.';
      }
      liveEl.hidden = !(selected >= 0 && co);
      if (co) liveName.textContent = `${co.name} (${co.eco})`;

      renderMoves();

      // Nav state: stepping stays inside the selected line.
      navBtn('start').disabled = cursor === 0 && !extra.length;
      navBtn('prev').disabled = cursor === 0 && !extra.length;
      navBtn('next').disabled = cursor >= line.length;
      navBtn('end').disabled = cursor >= line.length && !extra.length;

      const contEl = wrap.querySelector('.cont-list');
      contEl.innerHTML = '';
      const conts = continuations(history);
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

    // The selected line as clickable moves: the current ply is highlighted,
    // moves still to come are dimmed.
    function renderMoves() {
      movesEl.innerHTML = '';
      counterEl.textContent = line.length ? `${cursor} / ${line.length}` : '';
      if (!line.length) {
        movesEl.innerHTML = '<div class="op-empty">Choose an opening to see its main line.</div>';
      }
      for (let i = 0; i < line.length; i += 2) {
        const row = document.createElement('div');
        row.className = 'ol-move-row';
        const num = document.createElement('span');
        num.className = 'ol-move-num';
        num.textContent = `${i / 2 + 1}.`;
        row.appendChild(num);
        for (const ply of [i, i + 1]) {
          if (ply >= line.length) break;
          const btn = document.createElement('button');
          btn.className = 'ol-move';
          if (ply + 1 === cursor) btn.classList.add(extra.length ? 'branch' : 'active');
          if (ply + 1 > cursor) btn.classList.add('upcoming');
          btn.textContent = line[ply];
          btn.addEventListener('click', () => goTo(ply + 1));
          row.appendChild(btn);
        }
        movesEl.appendChild(row);
      }
      const active = movesEl.querySelector('.active, .branch');
      if (active) {
        // Keep the current move visible without scrolling the page (the list
        // is the offsetParent, so offsetTop is relative to it).
        const top = active.offsetTop;
        if (top < movesEl.scrollTop || top + active.offsetHeight > movesEl.scrollTop + movesEl.clientHeight) {
          movesEl.scrollTop = top - movesEl.clientHeight / 2;
        }
      } else {
        movesEl.scrollTop = 0;
      }

      offlineEl.hidden = !extra.length;
      if (extra.length) {
        const base = new Chess();
        for (const san of line.slice(0, cursor)) base.move(san);
        offlineText.textContent = `${line.length ? 'Off the line' : 'Exploring'}: ${numberedLine(base.fen(), extra)}`;
      }
      wrap.querySelector('.ol-offline-back').hidden = !line.length;
    }

    // Convert a SAN string into a move object chess.js can apply from here.
    function sanToMove(san) {
      const legal = chess.moves({ verbose: true });
      const hit = legal.find((m) => m.san === san || m.san.replace(/[+#]/, '') === san.replace(/[+#]/, ''));
      return hit ? { from: hit.from, to: hit.to, promotion: hit.promotion } : san;
    }

    // Controls
    navBtn('start').addEventListener('click', () => goTo(0));
    navBtn('prev').addEventListener('click', prev);
    navBtn('next').addEventListener('click', () => goTo(cursor + 1));
    navBtn('end').addEventListener('click', () => goTo(line.length));
    navBtn('flip').addEventListener('click', () => {
      orientation = orientation === 'w' ? 'b' : 'w';
      // Rebuilding the board keeps the pieces and last-move highlight.
      board.setOrientation(orientation);
      if (chess.inCheck()) board.flashCheck(kingSquare(chess, chess.turn()));
    });
    wrap.querySelector('.ol-offline-back').addEventListener('click', () => goTo(cursor));
    wrap.querySelector('.back-link').addEventListener('click', () => navigate('menu'));

    this._onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const actions = {
        ArrowLeft: prev,
        ArrowRight: () => goTo(cursor + 1),
        Home: () => goTo(0),
        End: () => goTo(line.length),
      };
      const action = actions[e.key];
      // Nothing loaded: leave the keys to the browser (e.g. Home/End scroll).
      if (!action || (!line.length && !extra.length)) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', this._onKey);

    refreshIcons();
    render();
    syncArrows();
  },

  unmount() {
    if (this._onKey) window.removeEventListener('keydown', this._onKey);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    this._onKey = null;
    this._onResize = null;
    try {
      getEngine().stop();
    } catch {
      /* engine may not exist */
    }
  },
};

const START_FEN_FULL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function kingSquare(chess, color) {
  for (const row of chess.board()) {
    for (const p of row) {
      if (p && p.type === 'k' && p.color === color) return p.square;
    }
  }
  return null;
}

// Short, factual blurbs for the most common openings, matched on the opening
// name. Used while exploring freely; the curated lines carry their own text.
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
  return `The ${o.name} (${o.eco}) arises after ${numberedLine(START_FEN_FULL, o.san)}. From here both sides follow well-mapped plans — try the continuations below to see how the main lines branch.`;
}

// Convert a UCI principal variation into SAN, played from `fen`, capped at `max`.
function pvToSan(fen, uciMoves, max) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of (uciMoves || []).slice(0, max)) {
    let res;
    try {
      res = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
      });
    } catch {
      break;
    }
    if (!res) break;
    out.push(res.san);
  }
  return out;
}
