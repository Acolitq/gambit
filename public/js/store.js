// Tiny central state container with pub/sub. Screens read from it and the
// router uses it to decide what to mount.
const state = {
  mode: null, // 'bot' | 'online'
  playerColor: 'w', // 'w' | 'b'
  level: 3, // 1..5, single-player only
  gameId: null,
  controller: null, // active GameController
  lastResult: null, // { result, reason }
};

const listeners = new Set();

export const store = {
  get(key) {
    return key ? state[key] : state;
  },
  set(patch) {
    Object.assign(state, patch);
    for (const fn of listeners) fn(state);
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
