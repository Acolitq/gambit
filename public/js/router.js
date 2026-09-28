// Minimal hash router. Each screen module exports `mount(root, params)` and an
// optional `unmount()`. Navigating swaps the mounted screen inside #app.
//
// The hash is `#/name` or `#/name/id` or `#/name/id/sub`, so ids survive a
// refresh and can be bookmarked; `id` and `sub` arrive in params. A screen that
// implements `update(params)` is updated in place when only its id/sub change,
// instead of being torn down and remounted.
const routes = new Map();
let current = null;
let rootEl = null;

export function registerRoute(name, screenModule) {
  routes.set(name, screenModule);
}

export function initRouter(root) {
  rootEl = root;
  window.addEventListener('hashchange', () => render());
  render();
}

// Non-URL params (e.g. a PGN handed to the analysis screen) ride along in
// module scope for the next render.
let pendingParams = {};
export function navigate(name, params = {}) {
  pendingParams = params;
  const hash = buildHash(name, params);
  if (window.location.hash === hash) {
    render(true); // same URL, force re-render with new params
  } else {
    window.location.hash = hash;
  }
}

// Rewrite the URL for the current screen without re-rendering (e.g. to record
// which game is open so a refresh comes back to it).
export function replaceHash(name, params = {}) {
  history.replaceState(null, '', buildHash(name, params));
}

function buildHash(name, { id, sub } = {}) {
  const parts = [name];
  if (id != null && id !== '') {
    parts.push(encodeURIComponent(id));
    if (sub != null && sub !== '') parts.push(encodeURIComponent(sub));
  }
  return `#/${parts.join('/')}`;
}

export function parseHash() {
  const [name, id, sub] = window.location.hash.replace(/^#\/?/, '').split('/');
  return {
    name: name || 'menu',
    id: id ? decodeURIComponent(id) : undefined,
    sub: sub ? decodeURIComponent(sub) : undefined,
  };
}

function render(force = false) {
  const { name, id, sub } = parseHash();
  const screen = routes.get(name) || routes.get('menu');
  const params = { ...pendingParams };
  if (id !== undefined) params.id = id;
  if (sub !== undefined) params.sub = sub;
  pendingParams = {};

  if (!force && screen === current && current.update) {
    current.update(params);
    refreshIcons();
    return;
  }

  if (current && current.unmount) current.unmount();
  rootEl.innerHTML = '';
  current = screen;
  screen.mount(rootEl, params);
  refreshIcons();
}

// Replace any <i data-lucide> placeholders with SVGs. Safe to call repeatedly;
// screens that render icons dynamically can call this too.
export function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}
