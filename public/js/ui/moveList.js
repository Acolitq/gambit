// Renders the SAN move history as a scrollable two-column (white/black) list.
export function createMoveList(mount) {
  const el = document.createElement('div');
  el.className = 'move-list';
  mount.appendChild(el);

  return {
    // history: array of SAN strings in play order.
    render(history) {
      el.innerHTML = '';
      for (let i = 0; i < history.length; i += 2) {
        const row = document.createElement('div');
        row.className = 'move-row';
        const num = document.createElement('span');
        num.className = 'move-num';
        num.textContent = `${i / 2 + 1}.`;
        const white = document.createElement('span');
        white.className = 'move-san';
        white.textContent = history[i] || '';
        const black = document.createElement('span');
        black.className = 'move-san';
        black.textContent = history[i + 1] || '';
        row.append(num, white, black);
        el.appendChild(row);
      }
      // Keep the latest move in view.
      el.scrollTop = el.scrollHeight;
    },
  };
}
