import { navigate } from '../router.js';
import { store } from '../store.js';
import { createBoard } from '../ui/board.js';
import { createEvalGraph } from '../analysis/evalGraph.js';
import { analyzeGame } from '../analysis/analyzer.js';
import { getEngine } from '../analysis/engineSingleton.js';

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
    const preset = store.get('lastResult');
    const presetPgn = store.get('lastPgn');

    const wrap = document.createElement('div');
    wrap.className = 'screen analysis-screen';
    wrap.innerHTML = `
      <div class="analysis-main">
        <div class="board-host"></div>
        <div class="review-controls">
          <button class="btn btn-ghost nav-btn" data-nav="start" title="Start">⏮</button>
          <button class="btn btn-ghost nav-btn" data-nav="prev" title="Previous (←)">◀</button>
          <button class="btn btn-ghost nav-btn" data-nav="next" title="Next (→)">▶</button>
          <button class="btn btn-ghost nav-btn" data-nav="end" title="End">⏭</button>
          <button class="btn btn-ghost nav-btn" data-nav="flip" title="Flip board">⇅</button>
        </div>
      </div>
      <aside class="analysis-side">
        <div class="analysis-header">
          <h2>Game Analysis</h2>
          <button class="text-link back-link">← Menu</button>
        </div>

        <div class="import-block">
          <textarea class="pgn-input" placeholder="Paste PGN here…" rows="4"></textarea>
          <div class="import-row">
            <label class="depth-label">Depth
              <select class="depth-select">
                <option value="10">10 (fast)</option>
                <option value="12" selected>12</option>
                <option value="14">14</option>
                <option value="16">16 (deep)</option>
              </select>
            </label>
            <button class="btn btn-primary analyze-btn">Analyze</button>
          </div>
          <div class="sample-row">
            <button class="text-link sample-btn">Load sample game</button>
          </div>
        </div>

        <div class="analysis-progress" hidden>
          <div class="progress-track"><div class="progress-fill"></div></div>
          <span class="progress-text">Analyzing…</span>
        </div>

        <div class="accuracy-block" hidden>
          <div class="acc-side acc-white"><span class="acc-label">White</span><span class="acc-value">—</span></div>
          <div class="acc-side acc-black"><span class="acc-label">Black</span><span class="acc-value">—</span></div>
        </div>

        <div class="eval-graph-host"></div>
        <div class="analysis-move-list"></div>
      </aside>
    `;
    root.appendChild(wrap);

    const boardHost = wrap.querySelector('.board-host');
    let orientation = 'w';
    const board = createBoard({
      mount: boardHost,
      orientation,
      onMove: () => {}, // review only
      legalMovesFor: () => [],
    });
    board.setInteractive(false);

    const graph = createEvalGraph(wrap.querySelector('.eval-graph-host'), (ply) => goTo(ply));
    const moveListEl = wrap.querySelector('.analysis-move-list');
    const progressEl = wrap.querySelector('.analysis-progress');
    const progressFill = wrap.querySelector('.progress-fill');
    const progressText = wrap.querySelector('.progress-text');
    const accBlock = wrap.querySelector('.accuracy-block');
    const pgnInput = wrap.querySelector('.pgn-input');

    let report = null;
    let cursor = 0; // 0 = start position, i = after move i

    function goTo(ply) {
      if (!report) return;
      cursor = Math.max(0, Math.min(report.moves.length, ply));
      const fen = cursor === 0 ? report.moves[0]?.fenBefore : report.moves[cursor - 1].fenAfter;
      if (fen) board.setPosition(fen);
      if (cursor > 0) {
        const m = report.moves[cursor - 1];
        board.highlightLastMove(m.uci.slice(0, 2), m.uci.slice(2, 4));
      }
      graph.setActive(cursor);
      highlightActiveRow();
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
            cell.innerHTML = `${m.san}<span class="amove-sym">${m.quality.symbol}</span>`;
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

    async function runAnalysis(pgn) {
      let engine;
      try {
        engine = getEngine();
      } catch (err) {
        progressText.textContent = 'Engine failed to load.';
        return;
      }
      progressEl.hidden = false;
      accBlock.hidden = true;
      progressFill.style.width = '0%';
      progressText.textContent = 'Starting engine…';

      const depth = Number(wrap.querySelector('.depth-select').value);
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

    // Keyboard navigation
    this._onKey = (e) => {
      if (e.key === 'ArrowLeft') goTo(cursor - 1);
      else if (e.key === 'ArrowRight') goTo(cursor + 1);
    };
    window.addEventListener('keydown', this._onKey);

    // If we arrived here from a finished game, pre-load its PGN.
    if (presetPgn) {
      pgnInput.value = presetPgn;
      runAnalysis(presetPgn);
    }
  },

  unmount() {
    if (this._onKey) window.removeEventListener('keydown', this._onKey);
  },
};
