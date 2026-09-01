import { Engine } from './stockfish.js';

// One engine instance for the whole app — spinning up the WASM worker is not
// free, so we create it lazily on first use and keep it alive.
let engine = null;

export function getEngine() {
  if (!engine) engine = new Engine();
  return engine;
}
