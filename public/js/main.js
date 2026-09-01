import { initRouter, registerRoute } from './router.js';
import { menuScreen } from './screens/menuScreen.js';
import { setupScreen } from './screens/setupScreen.js';
import { queueScreen } from './screens/queueScreen.js';
import { gameScreen } from './screens/gameScreen.js';
import { resultScreen } from './screens/resultScreen.js';
import { analysisScreen } from './screens/analysisScreen.js';

registerRoute('menu', menuScreen);
registerRoute('setup', setupScreen);
registerRoute('queue', queueScreen);
registerRoute('game', gameScreen);
registerRoute('result', resultScreen);
registerRoute('analysis', analysisScreen);

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
if (toggle) {
  toggle.addEventListener('click', () => {
    const root = document.documentElement;
    const isDark =
      root.dataset.theme === 'dark' ||
      (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isDark ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('gambit-theme', next);
    } catch {
      /* ignore */
    }
  });
}

initRouter(document.getElementById('app'));
