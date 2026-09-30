import { Engine } from './stockfish.js';

// One engine instance for the whole app — spinning up the WASM worker is not
// free, so we create it lazily on first use and keep it alive. If the worker
// died (failed to load or crashed), the next caller gets a fresh one.
let engine = null;

export function getEngine() {
  if (engine?.failed) {
    engine.destroy();
    engine = null;
  }
  if (!engine) engine = new Engine();
  return engine;
}
