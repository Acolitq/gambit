// Shared helpers for the tournament prep screens (events list, event workspace,
// opponent dossier).

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase() || '?';
}

const DAY = 24 * 60 * 60 * 1000;

// "Mar 4, 2026" — dates from Postgres DATE columns arrive as ISO strings.
export function fmtDate(value) {
  if (!value) return '';
  const d = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// "in 5 days" / "today" / "3 weeks ago" for an event date.
export function relDay(value) {
  if (!value) return '';
  const target = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((target - today) / DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  const abs = Math.abs(days);
  const [n, unit] = abs < 14 ? [abs, 'day'] : abs < 60 ? [Math.round(abs / 7), 'week'] : [Math.round(abs / 30), 'month'];
  const label = `${n} ${unit}${n === 1 ? '' : 's'}`;
  return days > 0 ? `in ${label}` : `${label} ago`;
}

// "2h ago" for timestamps (notes, last sync).
export function timeAgo(value) {
  if (!value) return '';
  const ms = Date.now() - new Date(value).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDate(value);
}

export function resultView(r) {
  if (r === 'win') return { label: 'Won', short: 'W', cls: 'win' };
  if (r === 'loss') return { label: 'Lost', short: 'L', cls: 'loss' };
  if (r === 'draw') return { label: 'Draw', short: 'D', cls: 'draw' };
  return { label: '—', short: '–', cls: 'unknown' };
}

// Remembered UI state, so returning to prep lands where you left off.
const PREFS_KEY = 'gambit:prep';

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

export const prefs = {
  get(key) {
    return readPrefs()[key];
  },
  set(patch) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
    } catch {
      /* storage full or disabled — remembering is best-effort */
    }
  },
  // Last opponent opened within each event.
  lastOpponent(trackerId) {
    return readPrefs().lastOpponent?.[trackerId];
  },
  setLastOpponent(trackerId, opponentId) {
    const map = { ...(readPrefs().lastOpponent || {}) };
    if (opponentId == null) delete map[trackerId];
    else map[trackerId] = String(opponentId);
    prefs.set({ lastOpponent: map });
  },
};
