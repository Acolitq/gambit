// Minimal hash router. Each screen module exports `mount(root, params)` and an
// optional `unmount()`. Navigating swaps the mounted screen inside #app.
const routes = new Map();
let current = null;
let rootEl = null;

export function registerRoute(name, screenModule) {
  routes.set(name, screenModule);
}

export function initRouter(root) {
  rootEl = root;
  window.addEventListener('hashchange', render);
  render();
}

// Programmatic navigation. Params are held in module scope, not the URL, to
// keep things simple (the hash is only the screen name).
let pendingParams = {};
export function navigate(name, params = {}) {
  pendingParams = params;
  if (currentName() === name) {
    render(); // same route, force re-render with new params
  } else {
    window.location.hash = `#/${name}`;
  }
}

function currentName() {
  const hash = window.location.hash.replace(/^#\//, '');
  return hash || 'menu';
}

function render() {
  const name = currentName();
  const screen = routes.get(name) || routes.get('menu');

  if (current && current.unmount) current.unmount();
  rootEl.innerHTML = '';
  current = screen;
  screen.mount(rootEl, pendingParams);
  pendingParams = {};
}
