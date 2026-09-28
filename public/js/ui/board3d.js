// A playable 3D board for the home hero. Three.js scene with lathe-turned
// pieces; drag to orbit, scroll to zoom, click a piece then a square to move.
// You play White against the built-in bot. Returns null if WebGL is unavailable
// so the caller can fall back to the flat board.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Chess } from 'chess.js';
import { chooseMove } from '../engine/bot.js';

const FILES = 'abcdefgh';
const BOT_LEVEL = 2;
const BORDER = 0.45; // frame width around the 8x8 playing area, in square units
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Rank 1 sits nearest the default camera (+z); files run along +x.
function squareToPos(sq) {
  return new THREE.Vector3(FILES.indexOf(sq[0]) - 3.5, 0, 4.5 - Number(sq[1]));
}
function posToSquare(x, z) {
  const f = Math.floor(x + 4);
  const r = Math.floor(4 - z);
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return `${FILES[f]}${r + 1}`;
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// --- Piece geometry ---------------------------------------------------------

// Lathe profiles are [radius, height] pairs traced bottom to top.
const BASE = [[0, 0], [0.36, 0], [0.37, 0.04], [0.35, 0.08], [0.3, 0.1], [0.3, 0.13], [0.25, 0.16]];

function arc(cx, cy, r, a0, a1, steps = 10) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function lathe(profile) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y));
  const geo = new THREE.LatheGeometry(pts, 40);
  geo.computeVertexNormals();
  return geo;
}

const PROFILES = {
  p: [...BASE, [0.16, 0.28], [0.13, 0.38], [0.2, 0.41], [0.2, 0.43], [0.11, 0.46], ...arc(0, 0.58, 0.15, -Math.PI / 2 + 0.75, Math.PI / 2)],
  r: [...BASE, [0.22, 0.3], [0.2, 0.52], [0.27, 0.56], [0.27, 0.62], [0.24, 0.64], [0.24, 0.78], [0.16, 0.78], [0.16, 0.72], [0, 0.72]],
  b: [...BASE, [0.17, 0.3], [0.12, 0.5], [0.22, 0.54], [0.22, 0.56], [0.12, 0.59], [0.16, 0.66], [0.19, 0.74], [0.17, 0.83], [0.11, 0.91], [0.05, 0.96], [0.035, 0.98], ...arc(0, 1.02, 0.05, -Math.PI / 2 + 0.6, Math.PI / 2, 6)],
  q: [...BASE, [0.19, 0.3], [0.13, 0.62], [0.24, 0.66], [0.24, 0.69], [0.14, 0.72], [0.17, 0.82], [0.25, 0.97], [0.21, 1.0], [0.12, 1.02], [0.08, 1.05], ...arc(0, 1.1, 0.06, -Math.PI / 2 + 0.6, Math.PI / 2, 6)],
  k: [...BASE, [0.2, 0.3], [0.14, 0.66], [0.25, 0.7], [0.25, 0.73], [0.15, 0.76], [0.18, 0.88], [0.23, 1.02], [0.2, 1.05], [0, 1.05]],
  n: [...BASE, [0.2, 0.26], [0.26, 0.3], [0.26, 0.33], [0, 0.33]],
};

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function sphere(r, x, y, z) {
  const g = new THREE.SphereGeometry(r, 16, 12);
  g.translate(x, y, z);
  return g;
}

// Horse head, extruded from a side silhouette. Snout points along +x.
function knightHead() {
  const s = new THREE.Shape();
  s.moveTo(-0.2, 0.3);
  s.lineTo(0.17, 0.3);
  s.quadraticCurveTo(0.1, 0.44, 0.2, 0.55);
  s.lineTo(0.33, 0.64);
  s.quadraticCurveTo(0.37, 0.7, 0.31, 0.75);
  s.lineTo(0.12, 0.9);
  s.lineTo(0.07, 1.0);
  s.lineTo(0.0, 0.93);
  s.quadraticCurveTo(-0.16, 0.9, -0.21, 0.72);
  s.quadraticCurveTo(-0.26, 0.5, -0.2, 0.3);
  const depth = 0.18;
  const g = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: 10,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

function buildParts() {
  const parts = {};
  for (const type of Object.keys(PROFILES)) parts[type] = [lathe(PROFILES[type])];
  // Rook battlements.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const g = box(0.09, 0.08, 0.1, 0, 0, 0);
    g.rotateY(a);
    g.translate(Math.cos(a) * 0.2, 0.82, -Math.sin(a) * 0.2);
    parts.r.push(g);
  }
  // Queen coronet.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.q.push(sphere(0.035, Math.cos(a) * 0.23, 1.0, Math.sin(a) * 0.23));
  }
  // King cross.
  parts.k.push(box(0.07, 0.24, 0.07, 0, 1.17, 0), box(0.2, 0.07, 0.07, 0, 1.19, 0));
  parts.n.push(knightHead());
  return parts;
}

// --- Scene ------------------------------------------------------------------

function boardTexture(light, dark, frame, label) {
  const px = 128;
  const border = Math.round(BORDER * px);
  const size = px * 8 + border * 2;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = frame;
  g.fillRect(0, 0, size, size);
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      g.fillStyle = (f + r) % 2 === 0 ? light : dark;
      g.fillRect(border + f * px, border + r * px, px, px);
    }
  }
  g.fillStyle = label;
  g.font = `600 ${Math.round(border * 0.5)}px ui-sans-serif, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 8; i++) {
    const mid = border + i * px + px / 2;
    g.fillText(FILES[i], mid, size - border / 2);
    g.fillText(String(8 - i), border / 2, mid);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function ring(inner, outer, color, opacity) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

function squarePlane(color, opacity) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.visible = false;
  return m;
}

export function createBoard3D(mount, { onStatus } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'board3d-canvas';
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 11.2, 12.9);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, -0.2);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 8;
  controls.maxDistance = 22;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.32;
  controls.rotateSpeed = 0.7;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2622, 0.5));
  const sun = new THREE.DirectionalLight(0xfff6ea, 1.5);
  sun.position.set(-5, 11, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -6;
  sun.shadow.camera.right = sun.shadow.camera.top = 6;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  // Board: a thick frame with the checkered top as one canvas texture.
  const span = 8 + BORDER * 2;
  const frameColor = cssVar('--board-frame', '#3a3835');
  const top = new THREE.MeshStandardMaterial({
    map: boardTexture(cssVar('--board-light', '#eeeed2'), cssVar('--board-dark', '#769656'), frameColor, cssVar('--text-tertiary', '#bdbbb7')),
    roughness: 0.55,
  });
  const side = new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.6 });
  const boardMesh = new THREE.Mesh(new THREE.BoxGeometry(span, 0.35, span), [side, side, top, side, side, side]);
  boardMesh.position.y = -0.175;
  boardMesh.receiveShadow = true;
  scene.add(boardMesh);

  // Soft contact shadow under the whole board.
  const floorShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({ opacity: 0.25 }),
  );
  floorShadow.rotation.x = -Math.PI / 2;
  floorShadow.position.y = -0.36;
  floorShadow.receiveShadow = true;
  scene.add(floorShadow);

  // Overlays: last move, check, selection, legal targets.
  const accent = cssVar('--accent', '#81b64c');
  const lastFrom = squarePlane(0xfff169, 0.45);
  const lastTo = squarePlane(0xfff169, 0.45);
  const checkGlow = squarePlane(cssVar('--signal', '#fa412d'), 0.55);
  const selectRing = ring(0.36, 0.46, accent, 0.95);
  selectRing.visible = false;
  for (const m of [lastFrom, lastTo, checkGlow, selectRing]) {
    m.position.y = 0.004;
    scene.add(m);
  }
  const targetGroup = new THREE.Group();
  scene.add(targetGroup);
  const dotGeo = new THREE.CircleGeometry(0.14, 24);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
  const captureGeo = new THREE.RingGeometry(0.38, 0.47, 40);

  // Pieces.
  const parts = buildParts();
  const mats = {
    w: new THREE.MeshPhysicalMaterial({ color: 0xe4d6bd, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
    b: new THREE.MeshPhysicalMaterial({ color: 0x2a2521, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
  };
  const pieceGroup = new THREE.Group();
  scene.add(pieceGroup);
  const meshes = new Map(); // square -> Group

  function makePiece(color, type, sq) {
    const g = new THREE.Group();
    for (const geo of parts[type]) {
      const m = new THREE.Mesh(geo, mats[color]);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    // Turn knights mostly sideways so their profile reads from the default camera.
    if (type === 'n') g.rotation.y = color === 'w' ? Math.PI * 0.8 : -Math.PI * 0.2;
    g.userData = { color, type, square: sq };
    g.position.copy(squareToPos(sq));
    pieceGroup.add(g);
    return g;
  }

  function removePiece(g) {
    pieceGroup.remove(g);
  }

  // --- Game state -----------------------------------------------------------

  const chess = new Chess();
  let selected = null;
  let legalTargets = [];
  let busy = false; // animating or bot thinking
  let botTimer = null;

  function syncAll() {
    for (const g of meshes.values()) removePiece(g);
    meshes.clear();
    for (const row of chess.board()) {
      for (const cell of row) if (cell) meshes.set(cell.square, makePiece(cell.color, cell.type, cell.square));
    }
    const last = chess.history({ verbose: true }).at(-1);
    showLastMove(last);
    showCheck();
  }

  function showLastMove(move) {
    lastFrom.visible = lastTo.visible = Boolean(move);
    if (!move) return;
    lastFrom.position.copy(squareToPos(move.from)).setY(0.003);
    lastTo.position.copy(squareToPos(move.to)).setY(0.003);
  }

  function showCheck() {
    checkGlow.visible = false;
    if (!chess.inCheck()) return;
    const turn = chess.turn();
    for (const row of chess.board()) {
      for (const cell of row) {
        if (cell && cell.type === 'k' && cell.color === turn) {
          checkGlow.position.copy(squareToPos(cell.square)).setY(0.005);
          checkGlow.visible = true;
        }
      }
    }
  }

  function status() {
    let text;
    let over = false;
    if (chess.isCheckmate()) {
      text = chess.turn() === 'w' ? 'Checkmate. The bot wins.' : 'Checkmate. You win!';
      over = true;
    } else if (chess.isDraw()) {
      text = chess.isStalemate() ? 'Stalemate. Draw.' : 'Draw.';
      over = true;
    } else if (chess.turn() === 'b') {
      text = 'Bot is thinking…';
    } else {
      text = chess.inCheck() ? 'Check! Your move.' : chess.history().length ? 'Your move.' : 'You play White. Your move.';
    }
    onStatus?.({ text, over, canUndo: chess.history().length >= 2 && !busy });
  }

  function select(sq) {
    clearSelection();
    const g = meshes.get(sq);
    if (!g) return;
    selected = sq;
    legalTargets = chess.moves({ square: sq, verbose: true });
    selectRing.position.copy(squareToPos(sq)).setY(0.006);
    selectRing.visible = true;
    lift(g, 0.28);
    for (const m of legalTargets) {
      const capture = m.flags.includes('c') || m.flags.includes('e');
      const marker = new THREE.Mesh(capture ? captureGeo : dotGeo, dotMat);
      marker.rotation.x = -Math.PI / 2;
      marker.position.copy(squareToPos(m.to)).setY(0.007);
      targetGroup.add(marker);
    }
  }

  function clearSelection() {
    if (selected && meshes.get(selected)) lift(meshes.get(selected), 0);
    selected = null;
    legalTargets = [];
    selectRing.visible = false;
    targetGroup.clear();
  }

  // --- Animation ------------------------------------------------------------

  const tweens = [];

  // A new tween on the same owner finishes the previous one first, so a lift
  // and a slide never fight over one piece.
  function tween(duration, step, owner = null) {
    if (owner) {
      for (let i = tweens.length - 1; i >= 0; i--) {
        if (tweens[i].owner !== owner) continue;
        tweens[i].resolve();
        tweens.splice(i, 1);
      }
    }
    return new Promise((resolve) => {
      if (reducedMotion) {
        step(1);
        resolve();
        return;
      }
      tweens.push({ start: performance.now(), duration, step, resolve, owner });
    });
  }

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  function lift(g, height) {
    const y0 = g.position.y;
    tween(140, (t) => {
      g.position.y = y0 + (height - y0) * ease(t);
    }, g);
  }

  function slide(g, to, hop) {
    const from = g.position.clone();
    const dest = squareToPos(to);
    const dist = from.distanceTo(dest);
    return tween(220 + dist * 45, (t) => {
      const e = ease(t);
      g.position.lerpVectors(from, dest, e);
      g.position.y = from.y * (1 - e) + Math.sin(Math.PI * e) * hop;
    }, g);
  }

  function vanish(g) {
    return tween(240, (t) => {
      g.scale.setScalar(1 - t * 0.9);
      g.position.y = -0.4 * t;
    }, g).then(() => removePiece(g));
  }

  async function playMove(move) {
    busy = true;
    selected = null; // the slide lands the lifted piece; don't lower it first
    clearSelection();
    const result = chess.move(move);
    const g = meshes.get(result.from);
    meshes.delete(result.from);

    const jobs = [];
    const capturedSq = result.flags.includes('e') ? `${result.to[0]}${result.from[1]}` : result.to;
    const victim = meshes.get(capturedSq);
    if (victim && capturedSq !== result.from) {
      meshes.delete(capturedSq);
      jobs.push(vanish(victim));
    }
    jobs.push(slide(g, result.to, result.piece === 'n' ? 0.9 : 0.35));
    if (result.flags.includes('k') || result.flags.includes('q')) {
      const rank = result.from[1];
      const [rFrom, rTo] = result.flags.includes('k') ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`];
      const rook = meshes.get(rFrom);
      meshes.delete(rFrom);
      meshes.set(rTo, rook);
      rook.userData.square = rTo;
      jobs.push(slide(rook, rTo, 0.6));
    }
    await Promise.all(jobs);

    if (result.promotion) {
      removePiece(g);
      meshes.set(result.to, makePiece(result.color, result.promotion, result.to));
    } else {
      g.userData.square = result.to;
      meshes.set(result.to, g);
    }
    showLastMove(result);
    showCheck();
    busy = false;

    if (chess.turn() === 'b' && !chess.isGameOver()) {
      busy = true;
      botTimer = setTimeout(() => {
        botTimer = null;
        const reply = chooseMove(chess.fen(), BOT_LEVEL);
        busy = false;
        if (reply) playMove(reply);
      }, 350);
    }
    status();
  }

  // --- Input ----------------------------------------------------------------

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let downAt = null;

  // The square under the pointer. A highlighted target wins over a piece
  // standing in front of it, so tall pieces never block a legal move.
  function squareAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const p = new THREE.Vector3();
    const floorSq = raycaster.ray.intersectPlane(boardPlane, p) ? posToSquare(p.x, p.z) : null;
    if (floorSq && legalTargets.some((m) => m.to === floorSq)) return floorSq;
    const hit = raycaster.intersectObjects(pieceGroup.children, true)[0];
    if (hit) {
      let o = hit.object;
      while (o.parent && o.parent !== pieceGroup) o = o.parent;
      return o.userData.square;
    }
    return floorSq;
  }

  function isOwnPiece(sq) {
    const piece = sq && chess.get(sq);
    return piece && piece.color === 'w';
  }

  function onPointerDown(e) {
    downAt = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e) {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 6 || busy || chess.turn() !== 'w' || chess.isGameOver()) return;
    const sq = squareAt(e);
    if (!sq) return clearSelection();
    const move = legalTargets.find((m) => m.to === sq);
    if (move) {
      playMove({ from: move.from, to: move.to, promotion: 'q' });
    } else if (isOwnPiece(sq) && sq !== selected) {
      select(sq);
    } else {
      clearSelection();
    }
  }

  function onPointerMove(e) {
    if (e.buttons || busy) return;
    const sq = squareAt(e);
    const clickable = isOwnPiece(sq) || legalTargets.some((m) => m.to === sq);
    renderer.domElement.style.cursor = clickable ? 'pointer' : 'grab';
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointermove', onPointerMove);

  // --- Loop -----------------------------------------------------------------

  function resize() {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(mount);
  resize();

  let visible = true;
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  });
  io.observe(mount);

  let raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      const t = Math.min(1, (now - tw.start) / tw.duration);
      tw.step(t);
      if (t === 1) {
        tweens.splice(i, 1);
        tw.resolve();
      }
    }
    if (!visible) return;
    controls.update();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  syncAll();
  status();

  function stopBot() {
    if (botTimer) clearTimeout(botTimer);
    botTimer = null;
  }

  return {
    reset() {
      if (busy && !botTimer) return;
      stopBot();
      busy = false;
      clearSelection();
      chess.reset();
      syncAll();
      status();
    },
    undo() {
      if (busy || chess.history().length < 2) return;
      clearSelection();
      chess.undo();
      chess.undo();
      syncAll();
      status();
    },
    destroy() {
      stopBot();
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      for (const list of Object.values(parts)) for (const geo of list) geo.dispose();
      for (const m of [...Object.values(mats), dotMat]) m.dispose();
      dotGeo.dispose();
      captureGeo.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of list) {
          m.map?.dispose();
          m.dispose();
        }
      });
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
