import { initRouter, registerRoute, refreshIcons } from './router.js';
import { menuScreen } from './screens/menuScreen.js';
import { setupScreen } from './screens/setupScreen.js';
import { queueScreen } from './screens/queueScreen.js';
import { gameScreen } from './screens/gameScreen.js';
import { resultScreen } from './screens/resultScreen.js';
import { analysisScreen } from './screens/analysisScreen.js';
import { scoutScreen } from './screens/scoutScreen.js';
import { openingsScreen } from './screens/openingsScreen.js';
import { loginScreen } from './screens/loginScreen.js';
import { trackersScreen } from './screens/trackersScreen.js';
import { trackerScreen } from './screens/trackerScreen.js';
import { opponentScreen } from './screens/opponentScreen.js';
import { store } from './store.js';
import { refreshUser, logout } from './authClient.js';

registerRoute('menu', menuScreen);
registerRoute('setup', setupScreen);
registerRoute('queue', queueScreen);
registerRoute('game', gameScreen);
registerRoute('result', resultScreen);
registerRoute('analysis', analysisScreen);
registerRoute('scout', scoutScreen);
registerRoute('openings', openingsScreen);
registerRoute('login', loginScreen);
registerRoute('trackers', trackersScreen);
registerRoute('tracker', trackerScreen);
registerRoute('opponent', opponentScreen);

// --- Sidebar navigation (the "Tournament desk" rail) ---
const NAV = [
  { route: 'menu', label: 'Home', icon: 'layout-dashboard' },
  { route: 'analysis', label: 'Review lab', icon: 'search' },
  { route: 'scout', label: 'Scout', icon: 'crosshair' },
  { route: 'openings', label: 'Repertoire', icon: 'network' },
  { route: 'trackers', label: 'Events', icon: 'calendar-days' },
  { route: 'setup', label: 'Practice', icon: 'swords' },
];
// Routes that should light up a given nav item even though they aren't it.
const NAV_ALIASES = {
  trackers: ['tracker', 'opponent'],
  setup: ['game', 'result'],
  menu: [''],
};

const navEl = document.getElementById('sidebar-nav');
const footEl = document.getElementById('sidebar-foot');
const sidebarEl = document.getElementById('sidebar');
const scrimEl = document.getElementById('sidebar-scrim');
const toggleEl = document.getElementById('sidebar-toggle');

function currentRoute() {
  return window.location.hash.replace(/^#\//, '') || 'menu';
}

function buildNav() {
  navEl.innerHTML = '';
  for (const item of NAV) {
    const a = document.createElement('a');
    a.className = 'sb-link';
    a.href = `#/${item.route}`;
    a.dataset.route = item.route;
    a.innerHTML = `<i data-lucide="${item.icon}"></i><span class="sb-link-label">${item.label}</span><span class="sb-dot"></span>`;
    a.addEventListener('click', () => closeSidebar());
    navEl.appendChild(a);
  }
  refreshIcons();
}

function syncActive() {
  const route = currentRoute();
  for (const a of navEl.querySelectorAll('.sb-link')) {
    const r = a.dataset.route;
    const match = r === route || (NAV_ALIASES[r] || []).includes(route);
    a.classList.toggle('active', match);
  }
}

// Account / user card in the sidebar footer.
function renderFoot() {
  if (!footEl) return;
  const user = store.get('user');
  const onlineLink = `
    <a class="sb-link" href="#/queue"><i data-lucide="play"></i><span class="sb-link-label">Online board</span><i data-lucide="arrow-up-right" style="width:13px;height:13px;opacity:.5"></i></a>
  `;
  if (user) {
    const initials = (user.email || '?').slice(0, 2).toUpperCase();
    footEl.innerHTML = `
      ${onlineLink}
      <button class="sb-link" id="sb-signout"><i data-lucide="log-out"></i><span class="sb-link-label">Sign out</span></button>
      <div class="sb-user">
        <span class="sb-avatar">${initials}</span>
        <div class="sb-user-body">
          <div class="sb-user-name" title="${user.email}">${user.email}</div>
          <div class="sb-user-sub">Signed in</div>
        </div>
      </div>
    `;
    footEl.querySelector('#sb-signout').addEventListener('click', async () => {
      await logout();
      renderFoot();
      window.location.hash = '#/menu';
    });
  } else {
    footEl.innerHTML = `
      ${onlineLink}
      <a class="sb-link" href="#/login"><i data-lucide="log-in"></i><span class="sb-link-label">Sign in</span></a>
    `;
  }
  refreshIcons();
}
store.subscribe(renderFoot);

// Mobile off-canvas toggle.
function openSidebar() {
  sidebarEl.dataset.open = 'true';
  if (scrimEl) scrimEl.hidden = false;
}
function closeSidebar() {
  sidebarEl.dataset.open = 'false';
  if (scrimEl) scrimEl.hidden = true;
}
if (toggleEl) toggleEl.addEventListener('click', openSidebar);
if (scrimEl) scrimEl.addEventListener('click', closeSidebar);

buildNav();
renderFoot();
syncActive();
window.addEventListener('hashchange', () => {
  syncActive();
  closeSidebar();
});

initRouter(document.getElementById('app'));

// Load the current user (if the session cookie is valid), then reflect it.
refreshUser().then(renderFoot);
renderFoot();
