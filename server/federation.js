// Over-the-board / federation scouting. Combines several public sources into one
// player profile: ratings across federations, rating history, and full
// tournament history where available.
//
//   - CFC (Chess Federation of Canada): server.chess.ca — the richest source.
//     Full record + every rated event (rating history AND tournament list) as
//     clean JSON. This is the flagship.
//   - FIDE snapshot + cross-federation name search: api.chesstools.org.
//
// No source offers OTB game moves by player name, so we surface deep links to
// game databases rather than pretending to have the games. CFC crosstables do
// give every rated game's opponent and result, which cfcGameLog() rebuilds.

const UA = 'Gambit/1.0 (portfolio chess study app; contact via github.com/Acolitq)';
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map();

async function getJson(url, { accept = 'application/json' } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
  if (!res.ok) throw new Error(`Upstream ${res.status} for ${new URL(url).host}`);
  return res.json();
}

function cached(key, fn, ttl = CACHE_TTL_MS) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.data);
  return fn().then((data) => {
    cache.set(key, { at: Date.now(), data });
    return data;
  });
}

// --- Name search: return candidate players from FIDE (ChessTools) and CFC. ---
export async function otbSearch(name) {
  return cached(`search:${name.toLowerCase()}`, async () => {
    const [fide, cfc] = await Promise.allSettled([
      searchFide(name),
      searchCfc(name),
    ]);
    const candidates = [];
    if (cfc.status === 'fulfilled') candidates.push(...cfc.value);
    if (fide.status === 'fulfilled') candidates.push(...fide.value);
    // De-dupe by fide id when we can, preferring the CFC-sourced entry (richer).
    const seen = new Set();
    const merged = [];
    for (const c of candidates) {
      const key = c.fideId ? `f${c.fideId}` : `c${c.cfcId || c.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(c);
    }
    return merged.slice(0, 25);
  });
}

async function searchFide(name) {
  const url = `https://api.chesstools.org/ratinglist/search?query=${encodeURIComponent(name)}`;
  const arr = await getJson(url);
  return (Array.isArray(arr) ? arr : []).map((p) => ({
    source: 'fide',
    name: displayName(p.name),
    fideId: p.fideid ? String(p.fideid) : null,
    cfcId: null,
    title: p.title || null,
    country: p.country || null,
    rating: p.rating || null,
    birthYear: p.birth_year || null,
  }));
}

async function searchCfc(name) {
  // CFC search wants first/last; split on the last space.
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return [];
  const first = parts[0];
  const last = parts.slice(1).join(' ');
  const url = `https://server.chess.ca/api/player/v1/find?first=${encodeURIComponent(first)}&last=${encodeURIComponent(last)}`;
  const data = await getJson(url);
  return (data.players || []).map((p) => ({
    source: 'cfc',
    name: `${p.name_first} ${p.name_last}`,
    fideId: p.fide_id ? String(p.fide_id) : null,
    cfcId: p.cfc_id ? String(p.cfc_id) : null,
    title: null,
    country: p.addr_province ? `CAN/${p.addr_province}` : 'CAN',
    rating: p.regular_rating || null,
    ratingLabel: 'CFC',
    birthYear: null,
  }));
}

// --- Full profile for a chosen player. ---
export async function otbPlayer({ cfc, fide }) {
  return cached(`player:${cfc || ''}:${fide || ''}`, async () => {
    let cfcData = null;
    let fideId = fide || null;

    if (cfc) {
      cfcData = await getCfcPlayer(cfc);
      if (cfcData && cfcData.player.fide_id) fideId = String(cfcData.player.fide_id);
    }

    let fideData = null;
    if (fideId) {
      try {
        fideData = await getFideSnapshot(fideId);
      } catch {
        fideData = null;
      }
    }

    return buildProfile({ cfcData, fideData, fideId, cfcId: cfc || null });
  });
}

async function getCfcPlayer(cfcId) {
  const data = await getJson(`https://server.chess.ca/api/player/v1/${cfcId}`);
  if (!data.player) throw new Error('CFC player not found');
  return data;
}

async function getFideSnapshot(fideId) {
  return getJson(`https://api.chesstools.org/fide/${fideId}`);
}

function buildProfile({ cfcData, fideData, fideId, cfcId }) {
  const player = cfcData?.player;
  const name = player
    ? `${player.name_first} ${player.name_last}`
    : fideData
      ? displayName(fideData.name)
      : 'Unknown player';

  const ratings = [];
  if (fideData) {
    ratings.push({ federation: 'FIDE', label: 'Standard', value: fideData.rating || null, extra: fideData.title || null });
  }
  if (player) {
    ratings.push({ federation: 'CFC', label: 'Regular', value: player.regular_rating || null });
    ratings.push({ federation: 'CFC', label: 'Quick', value: player.quick_rating || null });
  }

  // Tournament history + rating history from CFC events.
  const events = (cfcData?.player.events || [])
    .slice()
    .sort((a, b) => (a.date_end < b.date_end ? 1 : -1)); // newest first
  const tournaments = events.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date_end,
    type: e.rating_type === 'Q' ? 'Quick' : 'Regular',
    games: e.games_played,
    score: e.score,
    pre: e.rating_pre,
    post: e.rating_post,
    perf: e.rating_perf,
    change: e.rating_post != null && e.rating_pre != null ? e.rating_post - e.rating_pre : null,
  }));
  // Rating history oldest→newest for a sparkline (regular events only).
  const ratingHistory = events
    .filter((e) => e.rating_type === 'R' && e.rating_post != null)
    .map((e) => ({ date: e.date_end, rating: e.rating_post }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const links = [];
  if (fideId) links.push({ label: 'FIDE profile', url: `https://ratings.fide.com/profile/${fideId}` });
  links.push({ label: 'Search chessgames.com', url: `https://www.chessgames.com/perl/chess.pl?nodark=1&pid=&nfen=&text=${encodeURIComponent(name)}` });
  links.push({ label: 'Search 365Chess', url: `https://www.365chess.com/players/${encodeURIComponent(name.replace(/\s+/g, '_'))}` });

  return {
    name,
    title: fideData?.title || null,
    country: fideData?.country || (player?.addr_province ? `CAN / ${player.addr_province}` : null),
    birthYear: fideData?.birth_year || null,
    ids: { fide: fideId || null, cfc: cfcId || (player?.cfc_id ? String(player.cfc_id) : null) },
    city: player ? `${player.addr_city || ''}${player.addr_province ? ', ' + player.addr_province : ''}` : null,
    ratings,
    ratingHistory,
    tournaments,
    hasCfc: !!player,
    links,
  };
}

function displayName(fideName) {
  // FIDE lists names "Last, First" — flip to "First Last".
  if (!fideName) return 'Unknown';
  const m = fideName.split(',');
  return m.length === 2 ? `${m[1].trim()} ${m[0].trim()}` : fideName;
}

// --- OTB game log from CFC crosstables ---
// A CFC event's crosstable lists each player's round results. Swiss events use
// "+9|-2|=7" (result, then the opponent's crosstable line; 0 = bye/forfeit);
// round robins use a grid of "X|1|0|=" with one column per player. We rebuild
// one row per game: event, round, opponent (name + pre-event rating), result.
// Moves aren't published, so these are results only.
const EVENT_TTL_MS = 12 * 60 * 60 * 1000; // finished events don't change

export async function cfcGameLog(cfcId, { maxEvents = 30 } = {}) {
  const data = await cached(`cfcplayer:${cfcId}`, () => getCfcPlayer(cfcId));
  const events = (data.player.events || [])
    .slice()
    .sort((a, b) => (a.date_end < b.date_end ? 1 : -1))
    .slice(0, maxEvents);

  const crosstables = await mapLimit(events, 4, (e) =>
    cached(`cfcevent:${e.id}`, () => getJson(`https://server.chess.ca/api/event/v1/${e.id}`), EVENT_TTL_MS)
      .then((d) => d.event?.crosstable || [])
      .catch(() => null),
  );

  const log = [];
  events.forEach((e, i) => {
    const table = crosstables[i];
    const summary = {
      id: e.id,
      name: e.name,
      date: e.date_end,
      type: e.rating_type === 'Q' ? 'Quick' : 'Regular',
      score: e.score,
      games: e.games_played,
      pre: e.rating_pre,
      post: e.rating_post,
      perf: e.rating_perf,
      rounds: [],
      unavailable: !table,
    };
    const me = table && table.find((row) => String(row.cfc_id) === String(cfcId));
    if (me) summary.rounds = parseRounds(me, table);
    log.push(summary);
  });
  return log;
}

function parseRounds(me, table) {
  const cells = String(me.results || '').split('|');
  const roundRobin = cells.some((c) => c === 'X');
  const rounds = [];
  cells.forEach((cell, i) => {
    let result = null;
    let opp = null;
    if (roundRobin) {
      if (cell === 'X') return;
      result = cell === '1' ? 'win' : cell === '0' ? 'loss' : cell === '=' || cell === '½' ? 'draw' : null;
      opp = table[i];
    } else {
      const m = cell.match(/^([+\-=])(\d+)$/);
      if (!m) return;
      result = m[1] === '+' ? 'win' : m[1] === '-' ? 'loss' : 'draw';
      const line = Number(m[2]);
      if (line === 0) {
        rounds.push({ round: i + 1, result, bye: true });
        return;
      }
      opp = table[line - 1];
    }
    if (!result) return;
    rounds.push({
      round: roundRobin ? null : i + 1,
      result,
      opponent: opp ? displayName(opp.name) : 'Unknown',
      opponentCfcId: opp?.cfc_id ? String(opp.cfc_id) : null,
      opponentRating: opp?.rating_pre || null,
    });
  });
  return rounds;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
