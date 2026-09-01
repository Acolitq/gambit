// A lightweight, non-interactive board used for decoration (e.g. the home hero).
// Renders any FEN with the cburnett piece set. No move input, no rules.
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PIECE_DIR = '/assets/pieces/cburnett';

export function createStaticBoard(mount, { fen, orientation = 'w' } = {}) {
  const el = document.createElement('div');
  el.className = 'static-board';
  mount.appendChild(el);

  function render(fenStr) {
    el.innerHTML = '';
    const map = fenStr ? fenToMap(fenStr) : {};
    const ranks = orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
    const files = orientation === 'w' ? FILES : [...FILES].reverse();
    for (const rank of ranks) {
      for (const file of files) {
        const sq = `${file}${rank}`;
        const fileIdx = FILES.indexOf(file);
        const isLight = (fileIdx + (rank - 1)) % 2 === 1;
        const cell = document.createElement('div');
        cell.className = `sb-square ${isLight ? 'light' : 'dark'}`;
        const piece = map[sq];
        if (piece) {
          const p = document.createElement('span');
          p.className = 'sb-piece';
          p.style.backgroundImage = `url('${PIECE_DIR}/${piece.color}${piece.type.toUpperCase()}.svg')`;
          cell.appendChild(p);
        }
        el.appendChild(cell);
      }
    }
  }

  render(fen);
  return {
    setFen: (f) => render(f),
    el,
  };
}

function fenToMap(fen) {
  const map = {};
  const rows = fen.split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    let fileIdx = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        fileIdx += Number(ch);
      } else {
        map[`${FILES[fileIdx]}${8 - r}`] = {
          type: ch.toLowerCase(),
          color: ch === ch.toUpperCase() ? 'w' : 'b',
        };
        fileIdx += 1;
      }
    }
  }
  return map;
}
