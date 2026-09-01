// Caches full-game analysis reports in localStorage so reopening a game is
// instant instead of re-running the engine on every position. Keyed by the PGN
// and the analysis depth (depth changes the results). Bounded LRU; every access
// is wrapped in try/catch because storage can be unavailable or full.

const PREFIX = 'gambit-analysis:';
const INDEX_KEY = 'gambit-analysis-index';
const MAX_ENTRIES = 40;

// Stable, cheap string hash (djb2) of the normalized PGN + depth.
function keyFor(pgn, depth) {
  const s = `${depth}|${pgn.trim().replace(/\s+/g, ' ')}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function readIndex() {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
  } catch {
    return [];
  }
}
function writeIndex(list) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

// Return a cached report for this game/depth, or null. Bumps it to most-recent.
export function getCachedAnalysis(pgn, depth) {
  try {
    const key = keyFor(pgn, depth);
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const index = readIndex().filter((k) => k !== key);
    index.push(key);
    writeIndex(index);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Store a report, evicting the oldest entries past the cap (and on quota errors).
export function setCachedAnalysis(pgn, depth, report) {
  try {
    const key = keyFor(pgn, depth);
    const payload = JSON.stringify(report);
    let index = readIndex().filter((k) => k !== key);
    index.push(key);

    const evictOldest = () => {
      const oldest = index.shift();
      if (oldest) {
        try {
          localStorage.removeItem(PREFIX + oldest);
        } catch {
          /* ignore */
        }
      }
    };

    while (index.length > MAX_ENTRIES) evictOldest();

    // Try to write; on a quota error, evict and retry a few times.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        localStorage.setItem(PREFIX + key, payload);
        writeIndex(index);
        return;
      } catch {
        if (!index.length) break;
        evictOldest();
      }
    }
  } catch {
    /* storage unavailable — caching is best-effort */
  }
}
