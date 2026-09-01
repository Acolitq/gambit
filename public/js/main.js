import { initRouter, registerRoute, refreshIcons } from './router.js';
import { menuScreen } from './screens/menuScreen.js';
import { setupScreen } from './screens/setupScreen.js';
import { queueScreen } from './screens/queueScreen.js';
import { gameScreen } from './screens/gameScreen.js';
import { resultScreen } from './screens/resultScreen.js';
import { analysisScreen } from './screens/analysisScreen.js';
import { scoutScreen } from './screens/scoutScreen.js';
import { openingsScreen } from './screens/openingsScreen.js';

registerRoute('menu', menuScreen);
registerRoute('setup', setupScreen);
registerRoute('queue', queueScreen);
registerRoute('game', gameScreen);
registerRoute('result', resultScreen);
registerRoute('analysis', analysisScreen);
registerRoute('scout', scoutScreen);
registerRoute('openings', openingsScreen);

// Theme: respect a saved preference, else follow the system setting.
(function initTheme() {
  try {
    const saved = localStorage.getItem('gambit-theme');
    if (saved) document.documentElement.dataset.theme = saved;
  } catch {
    /* storage may be unavailable; fall back to system theme */
  }
})();

const toggle = document.getElementById('theme-toggle');
function currentIsDark() {
  const root = document.documentElement;
  return (
    root.dataset.theme === 'dark' ||
    (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
  );
}
function syncToggleIcon() {
  if (!toggle) return;
  // Show the icon of the mode you'd switch TO.
  toggle.innerHTML = `<i data-lucide="${currentIsDark() ? 'sun' : 'moon'}"></i>`;
  refreshIcons();
}
if (toggle) {
  toggle.addEventListener('click', () => {
    const next = currentIsDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('gambit-theme', next);
    } catch {
      /* ignore */
    }
    syncToggleIcon();
  });
  syncToggleIcon();
}

initRouter(document.getElementById('app'));
