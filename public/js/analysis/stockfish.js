// Browser wrapper around the Stockfish 16 WASM engine, running in a Web Worker
// (the vendored `-single` build needs no COOP/COEP headers, so it works on any
// host). We speak UCI to it and expose two modes:
//
//   evaluate(fen, depth)            — one-shot, single line, used for the batch
//                                     full-game pass.
//   analyze(fen, { multiPv, ... })  — live, multi-line, streaming updates as the
//                                     search deepens; used for the interactive
//                                     engine panel. Starting a new analyze stops
//                                     any search already running (latest wins).
//
// All scores are normalized to White's perspective (positive = White better).

const ENGINE_URL = '/vendor/stockfish/stockfish-nnue-16-single.js';

export class Engine {
  constructor() {
    this.worker = new Worker(ENGINE_URL);
    this.ready = false;
    this._readyWaiters = [];
    this._job = null; // { fen, sideToMove, multiPv, depth, lines, onUpdate, resolve, mode }
    this._pendingJob = null; // queued job waiting for current search to stop
    this._multiPv = 1;
    this.worker.onmessage = (e) =>
      this._onLine(typeof e.data === 'string' ? e.data : e.data?.data);
    this._send('uci');
    this._send('isready');
  }

  _send(cmd) {
    this.worker.postMessage(cmd);
  }

  _onLine(line) {
    if (!line) return;

    if (line.startsWith('uciok') || line === 'readyok') {
      if (!this.ready) {
        this.ready = true;
        this._readyWaiters.forEach((fn) => fn());
        this._readyWaiters = [];
      }
      return;
    }

    if (!this._job) return;
    const job = this._job;

    if (line.startsWith('info') && line.includes(' pv ')) {
      const info = parseInfo(line);
      if (info && info.pv.length) {
        job.depth = info.depth;
        job.lines.set(info.multipv, normalizeLine(info, job.sideToMove));
        if (job.onUpdate) job.onUpdate(this._sortedLines(job));
      }
    } else if (line.startsWith('bestmove')) {
      const finished = this._job;
      this._job = null;
      if (finished.resolve) finished.resolve(this._sortedLines(finished));
      // If a newer request came in while this one was stopping, start it now.
      if (this._pendingJob) {
        const next = this._pendingJob;
        this._pendingJob = null;
        this._startJob(next);
      }
    }
  }

  _sortedLines(job) {
    return [...job.lines.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v);
  }

  whenReady() {
    if (this.ready) return Promise.resolve();
    return new Promise((r) => this._readyWaiters.push(r));
  }

  _setMultiPv(n) {
    if (n !== this._multiPv) {
      this._multiPv = n;
      this._send(`setoption name MultiPV value ${n}`);
    }
  }

  _startJob(job) {
    this._job = job;
    this._setMultiPv(job.multiPv);
    this._send(`position fen ${job.fen}`);
    this._send(`go depth ${job.depth || 18}`);
  }

  // One-shot single-line evaluation (batch game pass). Resolves with
  // { scoreCp, mate, bestMove, pv, depth } from White's perspective.
  async evaluate(fen, depth = 12) {
    const lines = await this._run(fen, { depth, multiPv: 1, mode: 'batch' });
    const top = lines[0] || { scoreCp: 0, mate: null, pv: [], depth };
    return {
      depth: top.depth,
      scoreCp: top.scoreCp,
      mate: top.mate,
      bestMove: top.pv[0] || null,
      pv: top.pv,
    };
  }

  // Live multi-line analysis. `onUpdate(lines)` fires as the search deepens.
  // Resolves with the final lines when the target depth is reached (or the
  // search is superseded/stopped). Each line: { multipv, scoreCp, mate, pv, depth }.
  analyze(fen, { depth = 20, multiPv = 3, onUpdate } = {}) {
    return this._run(fen, { depth, multiPv, onUpdate, mode: 'live' });
  }

  _run(fen, opts) {
    return this.whenReady().then(
      () =>
        new Promise((resolve) => {
          const job = {
            fen,
            sideToMove: fen.split(' ')[1] || 'w',
            multiPv: opts.multiPv,
            depth: opts.depth,
            lines: new Map(),
            onUpdate: opts.onUpdate,
            mode: opts.mode,
            resolve,
          };
          if (this._job) {
            // Supersede whatever is running: remember this as pending and stop
            // the current search. The 'bestmove' handler will start it.
            if (this._pendingJob && this._pendingJob.resolve) {
              this._pendingJob.resolve([]); // drop an older queued job
            }
            this._pendingJob = job;
            this._send('stop');
          } else {
            this._startJob(job);
          }
        }),
    );
  }

  // Stop any running search without starting a new one.
  stop() {
    if (this._job) this._send('stop');
  }

  destroy() {
    try {
      this._send('quit');
      this.worker.terminate();
    } catch {
      /* already gone */
    }
  }
}

function parseInfo(line) {
  const depth = line.match(/\bdepth (\d+)/);
  const multipv = line.match(/\bmultipv (\d+)/);
  const cp = line.match(/\bscore cp (-?\d+)/);
  const mate = line.match(/\bscore mate (-?\d+)/);
  const pv = line.match(/\bpv (.+)$/);
  if (!depth || !pv) return null;
  return {
    depth: Number(depth[1]),
    multipv: multipv ? Number(multipv[1]) : 1,
    scoreCp: cp ? Number(cp[1]) : null,
    mate: mate ? Number(mate[1]) : null,
    pv: pv[1].trim().split(/\s+/),
  };
}

// Flip a side-to-move score into White's perspective.
function normalizeLine(info, sideToMove) {
  let scoreCp = info.scoreCp;
  let mate = info.mate;
  if (sideToMove === 'b') {
    if (scoreCp != null) scoreCp = -scoreCp;
    if (mate != null) mate = -mate;
  }
  return { multipv: info.multipv, depth: info.depth, scoreCp, mate, pv: info.pv };
}
