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

export async function logout() {
  await api('/auth/logout', { method: 'POST' });
  store.set({ user: null });
}
