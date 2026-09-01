import { navigate } from '../router.js';
import { login, register } from '../authClient.js';

export const loginScreen = {
  mount(root) {
    let mode = 'login'; // 'login' | 'register'

    const wrap = document.createElement('div');
    wrap.className = 'screen login-screen';
    wrap.innerHTML = `
      <div class="card login-card">
        <h1 class="login-title">Sign in</h1>
        <p class="login-sub">Save opponent trackers and prep across sessions.</p>
        <form class="login-form">
          <label class="login-field">
            <span>Email</span>
            <input type="email" class="login-email" autocomplete="email" required />
          </label>
          <label class="login-field">
            <span>Password</span>
            <input type="password" class="login-pw" autocomplete="current-password" minlength="8" required />
          </label>
          <div class="login-error" hidden></div>
          <button type="submit" class="btn btn-primary btn-block login-submit">Sign in</button>
        </form>
        <p class="login-toggle">
          <span class="toggle-text">New here?</span>
          <button class="text-link toggle-btn">Create an account</button>
        </p>
      </div>
    `;
    root.appendChild(wrap);

    const form = wrap.querySelector('.login-form');
    const errorEl = wrap.querySelector('.login-error');
    const submitBtn = wrap.querySelector('.login-submit');
    const title = wrap.querySelector('.login-title');
    const toggleText = wrap.querySelector('.toggle-text');
    const toggleBtn = wrap.querySelector('.toggle-btn');
    const pw = wrap.querySelector('.login-pw');

    function setMode(next) {
      mode = next;
      const isLogin = mode === 'login';
      title.textContent = isLogin ? 'Sign in' : 'Create account';
      submitBtn.textContent = isLogin ? 'Sign in' : 'Create account';
      toggleText.textContent = isLogin ? 'New here?' : 'Already have an account?';
      toggleBtn.textContent = isLogin ? 'Create an account' : 'Sign in';
      pw.setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');
      errorEl.hidden = true;
    }
    toggleBtn.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      const email = wrap.querySelector('.login-email').value.trim();
      const password = pw.value;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Please wait…';
      try {
        if (mode === 'login') await login(email, password);
        else await register(email, password);
        navigate('trackers');
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
        submitBtn.disabled = false;
        setMode(mode);
      }
    });
  },
};
