// Browser wrapper around the Stockfish 16 WASM engine. The engine runs in a Web
// Worker (the vendored `-single` build needs no COOP/COEP headers, so it works
// on any host), keeping the search off the main thread. We speak UCI to it and
// surface a small promise-based API.
//
// Scores from UCI are always from the side-to-move's perspective; callers
// usually want White's perspective, so `evaluate()` normalizes to that.

const ENGINE_URL = '/vendor/stockfish/stockfish-nnue-16-single.js';

export class Engine {
  constructor() {
    this.worker = new Worker(ENGINE_URL);
    this.ready = false;
    this._readyWaiters = [];
    this._current = null; // in-flight evaluation
    this.worker.onmessage = (e) => this._onLine(typeof e.data === 'string' ? e.data : e.data?.data);
    this._send('uci');
    this._send('isready');
  }

  _send(cmd) {
    this.worker.postMessage(cmd);
  }

  _onLine(line) {
    if (!line) return;

    if (line === 'readyok' || line.startsWith('uciok')) {
      if (!this.ready) {
        this.ready = true;
        this._readyWaiters.forEach((fn) => fn());
        this._readyWaiters = [];
      }
      return;
    }

    if (!this._current) return;

    if (line.startsWith('info') && line.includes(' pv ')) {
      const parsed = parseInfo(line);
      if (parsed) {
        this._current.depth = parsed.depth;
        this._current.scoreCp = parsed.scoreCp;
        this._current.mate = parsed.mate;
        this._current.pv = parsed.pv;
      }
    } else if (line.startsWith('bestmove')) {
      const best = line.split(' ')[1];
      const res = this._current;
      res.bestMove = best === '(none)' ? null : best;
      // Normalize the score to White's perspective.
      if (res.sideToMove === 'b') {
        if (res.scoreCp != null) res.scoreCp = -res.scoreCp;
        if (res.mate != null) res.mate = -res.mate;
      }
      this._resolveCurrent();
    }
  }

  _resolveCurrent() {
    const res = this._current;
    this._current = null;
    res.resolve({
      depth: res.depth,
      scoreCp: res.scoreCp,
      mate: res.mate,
      bestMove: res.bestMove,
      pv: res.pv || [],
    });
  }

  whenReady() {
    if (this.ready) return Promise.resolve();
    return new Promise((r) => this._readyWaiters.push(r));
  }

  // Evaluate a position (FEN) to a fixed depth. Resolves with a score from
  // White's perspective: { scoreCp, mate, bestMove, pv, depth }.
  async evaluate(fen, depth = 14) {
    await this.whenReady();
    const sideToMove = fen.split(' ')[1] || 'w';
    return new Promise((resolve) => {
      this._current = { sideToMove, scoreCp: 0, mate: null, pv: [], resolve };
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth}`);
    });
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

// Pull depth / score / principal variation out of a UCI `info` line.
function parseInfo(line) {
  const depthMatch = line.match(/\bdepth (\d+)/);
  const cpMatch = line.match(/\bscore cp (-?\d+)/);
  const mateMatch = line.match(/\bscore mate (-?\d+)/);
  const pvMatch = line.match(/\bpv (.+)$/);
  if (!depthMatch) return null;
  return {
    depth: Number(depthMatch[1]),
    scoreCp: cpMatch ? Number(cpMatch[1]) : null,
    mate: mateMatch ? Number(mateMatch[1]) : null,
    pv: pvMatch ? pvMatch[1].trim().split(/\s+/) : [],
  };
}
