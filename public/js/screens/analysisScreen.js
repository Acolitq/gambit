import { Chess } from 'chess.js';
import { navigate } from '../router.js';
import { store } from '../store.js';
import { createBoard } from '../ui/board.js';
import { createEvalGraph } from '../analysis/evalGraph.js';
import { createEvalBar } from '../analysis/evalBar.js';
import { analyzeGame } from '../analysis/analyzer.js';
import { getCachedAnalysis, setCachedAnalysis } from '../analysis/analysisCache.js';
import { getEngine } from '../analysis/engineSingleton.js';
import { formatEval, numberedLine } from '../analysis/evalFormat.js';

// Live engine settings for the interactive panel.
const LIVE_DEPTH = 22;
const LIVE_MULTIPV = 3;

// A sample game so the page is never empty (Morphy's "Opera Game", 1858).
const SAMPLE_PGN = `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8
13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

export const analysisScreen = {
  mount(root) {
    const presetPgn = store.get('lastPgn');

    const wrap = document.createElement('div');
    wrap.className = 'screen analysis-screen';
    wrap.innerHTML = `
      <div class="analysis-main">
        <div class="board-row">
          <div class="eval-bar-host"></div>
          <div class="board-host"></div>
        </div>
        <div class="review-controls">
          <button class="btn btn-ghost nav-btn" data-nav="start" title="Start" aria-label="First move"><i data-lucide="chevrons-left"></i></button>
          <button class="btn btn-ghost nav-btn" data-nav="prev" title="Previous (←)" aria-label="Previous move"><i data-lucide="chevron-left"></i></button>
          <button class="btn btn-ghost nav-btn" data-nav="next" title="Next (→)" aria-label="Next move"><i data-lucide="chevron-right"></i></button>
          <button class="btn btn-ghost nav-btn" data-nav="end" title="End" aria-label="Last move"><i data-lucide="chevrons-right"></i></button>
          <button class="btn btn-ghost nav-btn" data-nav="flip" title="Flip board" aria-label="Flip board"><i data-lucide="arrow-up-down"></i></button>
        </div>
      </div>
      <aside class="analysis-side">
        <div class="analysis-header">
          <h2>Analysis</h2>
          <button class="text-link back-link"><i data-lucide="arrow-left"></i> Menu</button>
        </div>

        <div class="import-block">
          <textarea class="pgn-input" placeholder="Paste PGN here…" rows="3"></textarea>
          <div class="import-row">
            <label class="depth-label">Full-game depth
              <select class="depth-select">
                <option value="10">10 (fast)</option>
                <option value="12" selected>12</option>
                <option value="14">14</option>
                <option value="16">16 (deep)</option>
              </select>
            </label>
            <button class="btn btn-primary analyze-btn">Analyze</button>
          </div>
          <div class="sample-row"><button class="text-link sample-btn">Load sample game</button></div>
        </div>

        <div class="analysis-progress" hidden>
          <div class="progress-track"><div class="progress-fill"></div></div>
          <span class="progress-text">Analyzing…</span>
        </div>

        <div class="accuracy-block" hidden>
          <div class="acc-side acc-white"><span class="acc-label">White</span><span class="acc-value">—</span></div>
          <div class="acc-side acc-black"><span class="acc-label">Black</span><span class="acc-value">—</span></div>
        </div>

        <div class="engine-panel">
          <div class="engine-head">
            <span class="engine-title">Engine</span>
            <span class="engine-depth"></span>
          </div>
          <div class="move-assessment" hidden></div>
          <div class="engine-lines"></div>
        </div>

        <div class="eval-graph-host"></div>
        <div class="analysis-move-list"></div>
      </aside>
    `;
    root.appendChild(wrap);

    let orientation = 'w';
    const board = createBoard({
      mount: wrap.querySelector('.board-host'),
      orientation,
      onMove: () => {},
      legalMovesFor: () => [],
    });
    board.setInteractive(false);

    const evalBar = createEvalBar(wrap.querySelector('.eval-bar-host'));
    const graph = createEvalGraph(wrap.querySelector('.eval-graph-host'), (ply) => goTo(ply));
    const moveListEl = wrap.querySelector('.analysis-move-list');
    const progressEl = wrap.querySelector('.analysis-progress');
    const progressFill = wrap.querySelector('.progress-fill');
    const progressText = wrap.querySelector('.progress-text');
    const accBlock = wrap.querySelector('.accuracy-block');
    const pgnInput = wrap.querySelector('.pgn-input');
    const engineDepthEl = wrap.querySelector('.engine-depth');
    const engineLinesEl = wrap.querySelector('.engine-lines');
    const assessEl = wrap.querySelector('.move-assessment');

    let report = null;
    let cursor = 0;
    let engine = null;

    function currentFen() {
      if (!report) return new Chess().fen();
      return cursor === 0 ? report.moves[0]?.fenBefore : report.moves[cursor - 1].fenAfter;
    }

    function goTo(ply) {
      if (!report) return;
      cursor = Math.max(0, Math.min(report.moves.length, ply));
      const fen = currentFen();
      if (fen) board.setPosition(fen);
      if (cursor > 0) {
        const m = report.moves[cursor - 1];
        board.highlightLastMove(m.uci.slice(0, 2), m.uci.slice(2, 4));
        evalBar.setEval({ scoreCp: m.evalCp, mate: m.mate });
      } else {
        board.highlightLastMove(null, null);
        evalBar.setEval(report.evalSeries[0]);
      }
      graph.setActive(cursor);
      highlightActiveRow();
      updateAssessment();
      runLiveEngine(fen);
    }

    // Live multi-line engine analysis of the current position.
    function runLiveEngine(fen) {
      if (!fen || !engine) return;
      engineLinesEl.classList.add('thinking');
      engine
        .analyze(fen, {
          depth: LIVE_DEPTH,
          multiPv: LIVE_MULTIPV,
          onUpdate: (lines) => renderEngineLines(lines, fen),
        })
        .then((lines) => {
          engineLinesEl.classList.remove('thinking');
          renderEngineLines(lines, fen);
        });
    }

    function renderEngineLines(lines, fen) {
      if (!lines.length) return;
      engineDepthEl.textContent = `depth ${lines[0].depth}`;
      // Top line drives the eval bar (already White-perspective).
      evalBar.setEval({ scoreCp: lines[0].scoreCp, mate: lines[0].mate });

      engineLinesEl.innerHTML = '';
      for (const line of lines) {
        const sans = pvToSan(fen, line.pv, 6);
        const row = document.createElement('div');
        row.className = 'engine-line';
        const evalStr = formatEval({ scoreCp: line.scoreCp, mate: line.mate });
        const positive = (line.mate ?? line.scoreCp ?? 0) >= 0;
        row.innerHTML = `
          <span class="el-eval ${positive ? 'pos' : 'neg'}">${evalStr}</span>
          <span class="el-moves">${numberedLine(fen, sans)}</span>
        `;
        engineLinesEl.appendChild(row);
      }
    }

    function updateAssessment() {
      if (cursor === 0 || !report) {
        assessEl.hidden = true;
        return;
      }
      const m = report.moves[cursor - 1];
      assessEl.hidden = false;
      const q = m.quality;
      const showLoss = ['inaccuracy', 'mistake', 'blunder'].includes(q.key);
      let bestSan = '';
      if (m.bestMove && showLoss) {
        const s = pvToSan(m.fenBefore, [m.bestMove], 1);
        bestSan = s[0] || '';
      }
      assessEl.className = `move-assessment q-${q.key}`;
      assessEl.innerHTML = `
        <span class="ma-badge">${q.label || 'Good'}${q.symbol ? ` ${q.symbol}` : ''}</span>
        <span class="ma-detail">
          ${m.color === 'w' ? 'White' : 'Black'} played <b>${m.san}</b>
          ${showLoss ? `— lost ${(m.cpLoss / 100).toFixed(1)}${bestSan ? `, best was <b>${bestSan}</b>` : ''}` : ''}
        </span>
      `;
    }

    function highlightActiveRow() {
      for (const row of moveListEl.querySelectorAll('.amove')) {
        row.classList.toggle('active', Number(row.dataset.ply) === cursor);
      }
      const active = moveListEl.querySelector('.amove.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function renderMoveList() {
      moveListEl.innerHTML = '';
      for (let i = 0; i < report.moves.length; i += 2) {
        const row = document.createElement('div');
        row.className = 'amove-row';
        const num = document.createElement('span');
        num.className = 'amove-num';
        num.textContent = `${i / 2 + 1}.`;
        row.appendChild(num);
        for (const j of [i, i + 1]) {
          const m = report.moves[j];
          const cell = document.createElement('button');
          cell.className = 'amove';
          if (m) {
            cell.dataset.ply = String(j + 1);
            cell.classList.add(`q-${m.quality.key}`);
            cell.innerHTML = `<span class="amove-san">${m.san}</span><span class="amove-sym">${m.quality.symbol}</span>`;
            cell.addEventListener('click', () => goTo(j + 1));
          } else {
            cell.classList.add('amove-empty');
            cell.disabled = true;
          }
          row.appendChild(cell);
        }
        moveListEl.appendChild(row);
      }
    }

    function showReport() {
      progressEl.hidden = true;
      graph.setSeries(report.evalSeries);
      renderMoveList();
      accBlock.hidden = false;
      wrap.querySelector('.acc-white .acc-value').textContent =
        report.accuracy.w != null ? `${report.accuracy.w}%` : '—';
      wrap.querySelector('.acc-black .acc-value').textContent =
        report.accuracy.b != null ? `${report.accuracy.b}%` : '—';
      goTo(0);
    }

    async function runAnalysis(pgn) {
      const depth = Number(wrap.querySelector('.depth-select').value);

      // Instant path: reuse a cached report for this exact game + depth.
      const cached = getCachedAnalysis(pgn, depth);
      if (cached) {
        report = cached;
        showReport();
        return;
      }

      try {
        engine = getEngine();
      } catch {
        progressText.textContent = 'Engine failed to load.';
        return;
      }
      progressEl.hidden = false;
      accBlock.hidden = true;
      progressFill.style.width = '0%';
      progressText.textContent = 'Starting engine…';

      try {
        report = await analyzeGame(pgn, engine, {
          depth,
          onProgress: (done, total) => {
            const pct = Math.round((done / total) * 100);
            progressFill.style.width = `${pct}%`;
            progressText.textContent = `Analyzing… ${done}/${total} positions`;
          },
        });
      } catch (err) {
        progressText.textContent = `Could not analyze: ${err.message}`;
        return;
      }

      setCachedAnalysis(pgn, depth, report); // remember for next time
      showReport();
    }

    // Controls
    wrap.querySelector('[data-nav="start"]').addEventListener('click', () => goTo(0));
    wrap.querySelector('[data-nav="prev"]').addEventListener('click', () => goTo(cursor - 1));
    wrap.querySelector('[data-nav="next"]').addEventListener('click', () => goTo(cursor + 1));
    wrap.querySelector('[data-nav="end"]').addEventListener('click', () =>
      goTo(report ? report.moves.length : 0),
    );
    wrap.querySelector('[data-nav="flip"]').addEventListener('click', () => {
      orientation = orientation === 'w' ? 'b' : 'w';
      board.setOrientation(orientation);
      evalBar.setOrientation(orientation);
      goTo(cursor);
    });
    wrap.querySelector('.analyze-btn').addEventListener('click', () => {
      const pgn = pgnInput.value.trim();
      if (pgn) runAnalysis(pgn);
    });
    wrap.querySelector('.sample-btn').addEventListener('click', () => {
      pgnInput.value = SAMPLE_PGN;
      runAnalysis(SAMPLE_PGN);
    });
    wrap.querySelector('.back-link').addEventListener('click', () => navigate('menu'));

    this._onKey = (e) => {
      if (e.key === 'ArrowLeft') goTo(cursor - 1);
      else if (e.key === 'ArrowRight') goTo(cursor + 1);
    };
    window.addEventListener('keydown', this._onKey);

    if (presetPgn) {
      pgnInput.value = presetPgn;
      runAnalysis(presetPgn);
    } else {
      // Default state: a full board in the starting position with the engine
      // already thinking, so the lab is never empty.
      try {
        engine = getEngine();
        const startFen = new Chess().fen();
        board.setPosition(startFen);
        board.highlightLastMove(null, null);
        evalBar.setEval({ scoreCp: 0 });
        runLiveEngine(startFen);
      } catch {
        /* engine unavailable */
      }
    }
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

// Convert a UCI principal variation into SAN, played from `fen`, capped at
// `max` plies.
function pvToSan(fen, uciMoves, max) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of uciMoves.slice(0, max)) {
    const move = {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
    };
    const res = chess.move(move);
    if (!res) break;
    out.push(res.san);
  }
  return out;
}
