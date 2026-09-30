import { api } from './net/api.js';
import { store } from './store.js';

// Client-side auth state, mirrored into the store as `user`.
export async function refreshUser() {
  try {
    const { user } = await api('/auth/me');
    store.set({ user });
    return user;
  } catch {
    store.set({ user: null });
    return null;
  }
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
