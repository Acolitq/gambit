import { api } from './net/api.js';
import { store } from './store.js';

// Client-side auth state, mirrored into the store as `user`.
let firstCheck = null;

export function refreshUser() {
  const check = api('/auth/me')
    .then(({ user }) => user)
    .catch(() => null)
    .then((user) => {
      store.set({ user });
      return user;
    });
  firstCheck ??= check;
  return check;
}

// Resolves once the session cookie has been checked at least once, so screens
// opened directly by URL (e.g. after a refresh) don't mistake "not loaded yet"
// for "signed out".
export function userReady() {
  return firstCheck || refreshUser();
}

export async function login(email, password) {
  const { user } = await api('/auth/login', { method: 'POST', body: { email, password } });
  store.set({ user });
  return user;
}

export async function register(email, password) {
  const { user } = await api('/auth/register', { method: 'POST', body: { email, password } });
  store.set({ user });
  return user;
}

// Always resets the local state, even if the request fails. Resolves true when
// the server confirmed (session deleted, cookie cleared), false otherwise.
export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
    return true;
  } catch {
    return false;
  } finally {
    store.set({ user: null });
  }
}
