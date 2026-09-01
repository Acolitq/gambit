// Renders the chessboard and handles user move input (click-to-select, then
// click a highlighted target). It owns no chess rules: it asks the controller
// for legal targets and reports completed moves back through callbacks.

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

// cburnett SVG piece set (the lichess default). File names are colour + type,
// e.g. wK.svg, bQ.svg.
const PIECE_DIR = '/assets/pieces/cburnett';
function pieceUrl(color, type) {
  return `${PIECE_DIR}/${color}${type.toUpperCase()}.svg`;
}

export function createBoard({ mount, orientation = 'w', onMove, legalMovesFor }) {
  let squares = new Map(); // 'e4' -> square element
  let orient = orientation;
  let selected = null;
  let interactive = true;
  let lastMove = null; // { from, to }
  let position = {}; // 'e4' -> { type, color }

  const boardEl = document.createElement('div');
  boardEl.className = 'board';
  mount.appendChild(boardEl);

  function orderedSquares() {
    const ranks = orient === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
    const files = orient === 'w' ? FILES : [...FILES].reverse();
    const list = [];
    for (const rank of ranks) {
      for (const file of files) list.push(`${file}${rank}`);
    }
    return list;
  }

  function build() {
    boardEl.innerHTML = '';
    squares = new Map();
    const list = orderedSquares();
    list.forEach((sq, i) => {
      const fileIdx = FILES.indexOf(sq[0]);
      const rankIdx = Number(sq[1]) - 1;
      const isLight = (fileIdx + rankIdx) % 2 === 1;
      const el = document.createElement('div');
      el.className = `square ${isLight ? 'light' : 'dark'}`;
      el.dataset.square = sq;

      // Coordinate labels on the outer edges only.
      const col = i % 8;
      const row = Math.floor(i / 8);
      if (row === 7) {
        const f = document.createElement('span');
        f.className = 'coord coord-file';
        f.textContent = sq[0];
        el.appendChild(f);
      }
      if (col === 0) {
        const r = document.createElement('span');
        r.className = 'coord coord-rank';
        r.textContent = sq[1];
        el.appendChild(r);
      }

      el.addEventListener('click', () => onSquareClick(sq));
      squares.set(sq, el);
      boardEl.appendChild(el);
    });
    renderPieces();
    if (lastMove) highlightLastMove(lastMove.from, lastMove.to);
  }

  function renderPieces() {
    for (const [sq, el] of squares) {
      const existing = el.querySelector('.piece');
      if (existing) existing.remove();
      const piece = position[sq];
      if (piece) {
        const span = document.createElement('span');
        span.className = `piece piece-${piece.color}`;
        span.style.backgroundImage = `url('${pieceUrl(piece.color, piece.type)}')`;
        el.appendChild(span);
      }
    }
  }

  function clearMarks() {
    for (const el of squares.values()) {
      el.classList.remove('selected', 'legal', 'capture', 'check');
    }
  }

  function onSquareClick(sq) {
    if (!interactive) return;

    // Completing a move onto a highlighted target.
    if (selected) {
      const targets = legalMovesFor(selected) || [];
      if (targets.includes(sq)) {
        const from = selected;
        const piece = position[from];
        const isPromotion =
          piece && piece.type === 'p' && (sq[1] === '8' || sq[1] === '1');
        selected = null;
        clearMarks();
        if (isPromotion) {
          askPromotion(piece.color, (choice) => onMove(from, sq, choice));
        } else {
          onMove(from, sq);
        }
        return;
      }
    }

    // Selecting one of your own pieces.
    const piece = position[sq];
    clearMarks();
    if (piece) {
      const targets = legalMovesFor(sq);
      if (targets && targets.length) {
        selected = sq;
        squares.get(sq).classList.add('selected');
        for (const t of targets) {
          const el = squares.get(t);
          if (!el) continue;
          el.classList.add(position[t] ? 'capture' : 'legal');
        }
        return;
      }
    }
    selected = null;
  }

  function askPromotion(color, done) {
    const overlay = document.createElement('div');
    overlay.className = 'promotion-overlay';
    const menu = document.createElement('div');
    menu.className = 'promotion-menu';
    for (const type of ['q', 'r', 'b', 'n']) {
      const btn = document.createElement('button');
      btn.className = `promotion-choice piece-${color}`;
      btn.style.backgroundImage = `url('${pieceUrl(color, type)}')`;
      btn.addEventListener('click', () => {
        overlay.remove();
        done(type);
      });
      menu.appendChild(btn);
    }
    overlay.appendChild(menu);
    boardEl.appendChild(overlay);
  }

  // --- Public API ---
  const api = {
    setPosition(fen) {
      position = fenToMap(fen);
      renderPieces();
    },
    setOrientation(color) {
      orient = color;
      build();
    },
    highlightLastMove(from, to) {
      lastMove = { from, to };
      for (const el of squares.values()) el.classList.remove('last-move');
      squares.get(from)?.classList.add('last-move');
      squares.get(to)?.classList.add('last-move');
    },
    setInteractive(v) {
      interactive = v;
      boardEl.classList.toggle('locked', !v);
    },
    flashCheck(kingSquare) {
      const el = squares.get(kingSquare);
      if (el) el.classList.add('check');
    },
    clearCheck() {
      for (const el of squares.values()) el.classList.remove('check');
    },
    destroy() {
      boardEl.remove();
    },
  };

  build();
  return api;
}

// Expand the piece-placement field of a FEN into a { square: {type,color} } map.
function fenToMap(fen) {
  const map = {};
  const placement = fen.split(' ')[0];
  const rows = placement.split('/');
  for (let r = 0; r < 8; r++) {
    let fileIdx = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        fileIdx += Number(ch);
      } else {
        const square = `${FILES[fileIdx]}${8 - r}`;
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        map[square] = { type: ch.toLowerCase(), color };
        fileIdx += 1;
      }
    }
  }
  return map;
}
