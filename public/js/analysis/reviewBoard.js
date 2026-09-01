import { Chess } from 'chess.js';
import { createBoard } from '../ui/board.js';
import { createEvalBar } from './evalBar.js';
import { createEvalGraph } from './evalGraph.js';
import { analyzeGame } from './analyzer.js';
import { getEngine } from './engineSingleton.js';
import { formatEval, numberedLine } from './evalFormat.js';

// A self-contained engine review board: eval bar, board, move navigation, a live
// multi-line engine panel (candidate/best moves), per-move quality with the best
// move you should have played, an eval graph and a clickable move list.
//
// It owns everything from the board down; callers supply their own surrounding
// chrome (PGN source, game list, headers). Reused by the analysis screen's
// study flow and the tournament tracker's "review their games" view.
//
//   const rb = createReviewBoard({ mount });
//   await rb.analyze(pgn, { depth: 12 });

const LIVE_DEPTH = 22;
const LIVE_MULTIPV = 3;

export function createReviewBoard({ mount }) {
  const el = document.createElement('div');
  el.className = 'review';
  el.innerHTML = `
    <div class="review-board">
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
      <div class="analysis-progress" hidden>
        <div class="progress-track"><div class="progress-fill"></div></div>
        <span class="progress-text">Analyzing…</span>
      </div>
    </div>
    <div class="review-panels">
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
    </div>
  `;
  mount.appendChild(el);
  if (window.lucide) window.lucide.createIcons();

  const q = (sel) => el.querySelector(sel);

  let orientation = 'w';
  const board = createBoard({
    mount: q('.board-host'),
    orientation,
    onMove: () => {},
    legalMovesFor: () => [],
  });
  board.setInteractive(false);

  const evalBar = createEvalBar(q('.eval-bar-host'));
  const graph = createEvalGraph(q('.eval-graph-host'), (ply) => goTo(ply));
  const moveListEl = q('.analysis-move-list');
  const progressEl = q('.analysis-progress');
  const progressFill = q('.progress-fill');
  const progressText = q('.progress-text');
  const accBlock = q('.accuracy-block');
  const engineDepthEl = q('.engine-depth');
  const engineLinesEl = q('.engine-lines');
  const assessEl = q('.move-assessment');

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
    const qual = m.quality;
    const showLoss = ['inaccuracy', 'mistake', 'blunder'].includes(qual.key);
    let bestSan = '';
    if (m.bestMove && showLoss) {
      const s = pvToSan(m.fenBefore, [m.bestMove], 1);
      bestSan = s[0] || '';
    }
    assessEl.className = `move-assessment q-${qual.key}`;
    assessEl.innerHTML = `
      <span class="ma-badge">${qual.label || 'Good'}${qual.symbol ? ` ${qual.symbol}` : ''}</span>
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

  // Run a full-game analysis of `pgn` and display it. Resolves with the report.
  async function analyze(pgn, { depth = 12 } = {}) {
    try {
      engine = getEngine();
    } catch {
      progressEl.hidden = false;
      progressText.textContent = 'Engine failed to load.';
      throw new Error('Engine failed to load.');
    }
    report = null;
    cursor = 0;
    progressEl.hidden = false;
    accBlock.hidden = true;
    engineLinesEl.innerHTML = '';
    assessEl.hidden = true;
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
      throw err;
    }

    progressEl.hidden = true;
    graph.setSeries(report.evalSeries);
    renderMoveList();
    accBlock.hidden = false;
    q('.acc-white .acc-value').textContent =
      report.accuracy.w != null ? `${report.accuracy.w}%` : '—';
    q('.acc-black .acc-value').textContent =
      report.accuracy.b != null ? `${report.accuracy.b}%` : '—';
    goTo(0);
    return report;
  }

  function flip() {
    orientation = orientation === 'w' ? 'b' : 'w';
    board.setOrientation(orientation);
    evalBar.setOrientation(orientation);
    goTo(cursor);
  }

  function setOrientation(color) {
    if (color !== 'w' && color !== 'b') return;
    if (orientation === color) return;
    flip();
  }

  // Controls
  q('[data-nav="start"]').addEventListener('click', () => goTo(0));
  q('[data-nav="prev"]').addEventListener('click', () => goTo(cursor - 1));
  q('[data-nav="next"]').addEventListener('click', () => goTo(cursor + 1));
  q('[data-nav="end"]').addEventListener('click', () => goTo(report ? report.moves.length : 0));
  q('[data-nav="flip"]').addEventListener('click', flip);

  const onKey = (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowLeft') goTo(cursor - 1);
    else if (e.key === 'ArrowRight') goTo(cursor + 1);
  };
  window.addEventListener('keydown', onKey);

  return {
    el,
    analyze,
    flip,
    setOrientation,
    goToStart: () => goTo(0),
    destroy() {
      window.removeEventListener('keydown', onKey);
      try {
        getEngine().stop();
      } catch {
        /* engine may not exist */
      }
      board.destroy();
      el.remove();
    },
  };
}

// Convert a UCI principal variation into SAN, played from `fen`, capped at `max`.
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
