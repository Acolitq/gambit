// Small status banner: whose turn, check, or the final result.
export function createStatusBar(mount) {
  const el = document.createElement('div');
  el.className = 'status-bar';
  mount.appendChild(el);

  function set(text, tone = 'neutral') {
    // Cross-fade so state changes read as acknowledged, not abrupt.
    el.classList.remove('tone-neutral', 'tone-danger', 'tone-success');
    el.classList.add(`tone-${tone}`);
    el.classList.remove('enter');
    void el.offsetWidth; // restart the animation
    el.textContent = text;
    el.classList.add('enter');
  }

  return { set, el };
}
