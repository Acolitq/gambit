import { navigate } from '../router.js';
import { login, register } from '../authClient.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_PASSWORD = 8;
// How long the "Account created" confirmation stays up before moving on.
const SUCCESS_DELAY_MS = 1400;

// Server error codes that belong to a specific field; anything else is shown
// in the form-level banner under the fields.
const FIELD_FOR_CODE = {
  no_account: 'email',
  email_taken: 'email',
  invalid_email: 'email',
  wrong_password: 'password',
  missing_password: 'password',
  weak_password: 'password',
};

export const loginScreen = {
  mount(root) {
    let mode = 'login'; // 'login' | 'register'
    let pending = false;

    const wrap = document.createElement('div');
    wrap.className = 'screen login-screen';
    wrap.innerHTML = `
      <div class="card login-card">
        <h1 class="login-title">Sign in</h1>
        <p class="login-sub">Save opponent trackers and prep across sessions.</p>
        <form class="login-form" novalidate>
          <div class="login-group">
            <label class="login-field">
              <span>Email</span>
              <input type="email" class="login-email" autocomplete="email" required
                aria-describedby="login-email-error" />
            </label>
            <div class="login-field-error" id="login-email-error" aria-live="polite"></div>
          </div>
          <div class="login-group">
            <label class="login-field">
              <span>Password</span>
              <input type="password" class="login-pw" autocomplete="current-password" required
                aria-describedby="login-pw-hint login-pw-error" />
            </label>
            <div class="login-hint" id="login-pw-hint" hidden>At least ${MIN_PASSWORD} characters.</div>
            <div class="login-field-error" id="login-pw-error" aria-live="polite"></div>
          </div>
          <div class="login-error" aria-live="polite"></div>
          <div class="login-success" role="status"></div>
          <button type="submit" class="btn btn-primary btn-block login-submit">Sign in</button>
        </form>
        <p class="login-toggle">
          <span class="toggle-text">New here?</span>
          <button type="button" class="text-link toggle-btn">Create an account</button>
        </p>
      </div>
    `;
    root.appendChild(wrap);

    const form = wrap.querySelector('.login-form');
    const errorEl = wrap.querySelector('.login-error');
    const successEl = wrap.querySelector('.login-success');
    const submitBtn = wrap.querySelector('.login-submit');
    const title = wrap.querySelector('.login-title');
    const toggleText = wrap.querySelector('.toggle-text');
    const toggleBtn = wrap.querySelector('.toggle-btn');
    const pwHint = wrap.querySelector('.login-hint');
    const fields = {
      email: { input: wrap.querySelector('.login-email'), error: wrap.querySelector('#login-email-error') },
      password: { input: wrap.querySelector('.login-pw'), error: wrap.querySelector('#login-pw-error') },
    };

    // Show `message` in red under a field, optionally followed by a link-style
    // action (e.g. "Create an account instead").
    function setFieldError(name, message, action) {
      const { input, error } = fields[name];
      error.textContent = message;
      if (action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'login-inline-link';
        btn.textContent = action.label;
        btn.addEventListener('click', action.onClick);
        error.append(' ', btn);
      }
      input.setAttribute('aria-invalid', 'true');
    }
    function clearFieldError(name) {
      const { input, error } = fields[name];
      error.textContent = '';
      input.removeAttribute('aria-invalid');
    }
    function clearErrors() {
      clearFieldError('email');
      clearFieldError('password');
      errorEl.textContent = '';
    }

    function submitLabel() {
      if (pending) return mode === 'login' ? 'Signing in…' : 'Creating account…';
      return mode === 'login' ? 'Sign in' : 'Create account';
    }
    function setPending(next) {
      pending = next;
      submitBtn.disabled = next;
      submitBtn.textContent = submitLabel();
      form.setAttribute('aria-busy', String(next));
    }

    // Switching modes keeps whatever is typed in the fields.
    function setMode(next) {
      mode = next;
      const isLogin = mode === 'login';
      title.textContent = isLogin ? 'Sign in' : 'Create account';
      submitBtn.textContent = submitLabel();
      toggleText.textContent = isLogin ? 'New here?' : 'Already have an account?';
      toggleBtn.textContent = isLogin ? 'Create an account' : 'Sign in';
      fields.password.input.setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');
      pwHint.hidden = isLogin;
      clearErrors();
    }
    function switchMode(next) {
      setMode(next);
      fields.password.input.focus();
    }
    toggleBtn.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));

    for (const name of Object.keys(fields)) {
      fields[name].input.addEventListener('input', () => clearFieldError(name));
    }

    // Client-side checks; returns true when the form can be sent.
    function validate(email, password) {
      let ok = true;
      if (!email) {
        setFieldError('email', 'Enter your email.');
        ok = false;
      } else if (!EMAIL_RE.test(email)) {
        setFieldError('email', 'Enter a valid email address.');
        ok = false;
      }
      if (!password) {
        setFieldError('password', 'Enter your password.');
        ok = false;
      } else if (mode === 'register' && password.length < MIN_PASSWORD) {
        setFieldError('password', `Password must be at least ${MIN_PASSWORD} characters.`);
        ok = false;
      }
      return ok;
    }

    function showServerError(err) {
      const field = FIELD_FOR_CODE[err.code];
      if (!field) {
        errorEl.textContent = err.message || 'Something went wrong.';
        return;
      }
      let action;
      if (err.code === 'no_account') {
        action = { label: 'Create an account instead', onClick: () => switchMode('register') };
      } else if (err.code === 'email_taken') {
        action = { label: 'Sign in instead', onClick: () => switchMode('login') };
      }
      setFieldError(field, err.message, action);
    }

    function focusFirstInvalid() {
      const bad = Object.values(fields).find((f) => f.input.getAttribute('aria-invalid') === 'true');
      if (bad) bad.input.focus();
    }

    let successTimer = null;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (pending) return;
      clearErrors();
      const email = fields.email.input.value.trim();
      const password = fields.password.input.value;
      if (!validate(email, password)) return focusFirstInvalid();

      setPending(true);
      try {
        if (mode === 'login') {
          await login(email, password);
          navigate('trackers');
          return;
        }
        const user = await register(email, password);
        // Leave the button disabled and show the confirmation before moving on.
        submitBtn.textContent = 'Account created';
        successEl.textContent = `Account created — you're signed in as ${user.email}.`;
        successTimer = setTimeout(() => navigate('trackers'), SUCCESS_DELAY_MS);
      } catch (err) {
        setPending(false);
        showServerError(err);
        focusFirstInvalid();
      }
    });

    this._cleanup = () => clearTimeout(successTimer);
  },

  unmount() {
    if (this._cleanup) this._cleanup();
    this._cleanup = null;
  },
};
