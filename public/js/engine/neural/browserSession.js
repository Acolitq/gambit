// Lazily loads onnxruntime-web (only when the neural bot is actually used) and
// creates a runNet(planes) -> { policy, value } backed by the ONNX model.
import { createNeuralEngine } from './neuralEngine.js';

const ORT_VERSION = '1.17.3';
const ORT_SCRIPT = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.min.js`;
const MODEL_URL = '/vendor/neural/gambit-net.onnx';

let ortPromise = null;
function loadOrt() {
  if (ortPromise) return ortPromise;
  ortPromise = new Promise((resolve, reject) => {
    if (window.ort) return resolve(window.ort);
    const script = document.createElement('script');
    script.src = ORT_SCRIPT;
    script.onload = () => {
      // Serve the wasm backend files from the same CDN.
      window.ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
      resolve(window.ort);
    };
    script.onerror = () => reject(new Error('Failed to load the neural engine runtime.'));
    document.head.appendChild(script);
  });
  return ortPromise;
}

let enginePromise = null;

// Returns a ready-to-use neural engine, loading the runtime + model on first call.
export function getNeuralEngine(onStatus) {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    if (onStatus) onStatus('Loading neural engine…');
    const ort = await loadOrt();
    if (onStatus) onStatus('Loading model…');
    const session = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm'],
    });
    const runNet = async (planes) => {
      const input = new ort.Tensor('float32', planes, [1, 17, 8, 8]);
      const out = await session.run({ board: input });
      return { policy: out.policy.data, value: out.value.data[0] };
    };
    return createNeuralEngine(runNet);
  })();
  return enginePromise;
}
