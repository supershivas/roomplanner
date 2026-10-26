// Vue 3D (three.js) : mode « Éditeur » rapide et mode « Réaliste » (lumières physiques,
// ombres douces, ciel par les fenêtres, occlusion ambiante, tonemapping cinéma).
// Repère : x = x du plan, y = hauteur, z = y du plan. 1 unité = 1 cm.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from '../vendor/jsm/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from '../vendor/jsm/lights/RectAreaLightUniformsLib.js';
import { RoundedBoxGeometry } from '../vendor/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from '../vendor/jsm/postprocessing/GTAOPass.js';
import { store } from './store.js';
import {
  WALL_THICKNESS, OBJECT_TYPES, isOpening, wallRings, wallMatch, doorSwing, itemHeight, itemElevation,
  snapOpeningToWall, round5, clamp, bounds, isGlazed,
} from './model.js';
import { floorTexture, grainTexture, FLOOR_LOOK } from './textures3d.js';

const CLICK_PX = 4;
const LIGHT_K = 12000; // candela par unité d'intensité (1 unité = 1 cm : la loi en 1/d² l'exige)
const MAX_SHADOW_LIGHTS = 4;
const MAX_WINDOW_LIGHTS = 8;

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const rad = (deg) => (deg * Math.PI) / 180;

function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) m.dispose();
  });
  root.clear();
}

export function createView3d(container, { onUnavailable } = {}) {
  let renderer; let scene; let camera; let controls; let composer; let gtao; let envTexture;
  let content; let rig; let selectionHelper; let ceiling = null;
  let active = false;
  let stale = true; // le contenu doit être reconstruit à la prochaine activation
  let dirty = false;
  let shadowsDirty = true;
  let framed = false;
  let rigSignature = '';
  let contentPicks = []; // objets sélectionnables de la scène
  let rigPicks = []; // luminaires sélectionnables
  const allPicks = () => [...contentPicks, ...rigPicks];
  let cutaway = []; // murs masqués quand la caméra est de leur côté extérieur
  let groups = new Map(); // id → groupe 3D (objets et colonnes)
  let drag = null;
  let emptyDown = null;
  let tinyTarget;
  let fitDistance = 600;

  // ── Initialisation paresseuse (le contexte WebGL n'est créé qu'à la première ouverture) ──
  function init() {
    if (renderer) return true;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      onUnavailable?.();
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; // recalculées seulement quand la scène change
    container.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, 1, 5, 20000);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.addEventListener('change', () => { dirty = true; });
    content = new THREE.Group();
    rig = new THREE.Group();
    scene.add(content, rig);
    tinyTarget = new THREE.WebGLRenderTarget(4, 4);
    RectAreaLightUniformsLib.init();
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    attachPointer();
    new ResizeObserver(resize).observe(container);
    requestAnimationFrame(loop);
    return true;
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!active || !renderer) return;
    controls.update();
    if (dirty) { dirty = false; renderFrame(); }
  }

  function resize() {
    if (!renderer) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  // ── Rendu d'une image ──
  function renderFrame() {
    if (shadowsDirty) updateShadows();
    applyCutaway();
    const realistic = store.render.mode === 'realistic';
    if (realistic) {
      ensureComposer();
      gtao.enabled = store.render.ao;
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  }

  // Les ombres sont calculées avec tous les murs, y compris ceux masqués à l'écran :
  // la lumière du soleil ne traverse pas un mur simplement parce qu'il est retiré de la vue.
  function updateShadows() {
    for (const c of cutaway) c.group.visible = true;
    if (ceiling) ceiling.visible = true; // invisible à l'écran, mais il arrête la lumière
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(tinyTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    shadowsDirty = false;
  }

  function applyCutaway() {
    if (ceiling) ceiling.visible = false;
    for (const c of cutaway) {
      const facing = (camera.position.x - c.cx) * c.ox + (camera.position.z - c.cz) * c.oz > 0;
      c.group.visible = !facing;
    }
  }

  function ensureComposer() {
    if (composer) return;
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    composer.addPass(new RenderPass(scene, camera));
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.updateGtaoMaterial({ radius: 28, distanceExponent: 1.4, thickness: 6, scale: 1.1, samples: 16, distanceFallOff: 1 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    gtao.blendIntensity = 0.95;
    composer.addPass(gtao);
    composer.addPass(new OutputPass());
  }

  // ── Matériaux ──
  function std(realistic, color, opts = {}) {
    const { clearcoat, ...rest } = opts; // clearcoat n'existe que sur les matériaux physiques
    const base = { color, roughness: 0.8, metalness: 0, ...rest };
    return realistic ? new THREE.MeshPhysicalMaterial({ ...base, clearcoat: clearcoat || 0 }) : new THREE.MeshStandardMaterial(base);
  }

  function itemMaterial(it, realistic) {
    const color = it.color || OBJECT_TYPES[it.type].color;
    switch (it.type) {
      case 'appliance': return std(realistic, color, { roughness: 0.35, metalness: realistic ? 0.55 : 0 });
      case 'radiator': return std(realistic, color, { roughness: 0.38, metalness: realistic ? 0.25 : 0 });
      case 'ironing': return std(realistic, color, { roughness: 0.9 });
      case 'table': case 'chair': case 'shelf': case 'dresser':
        return std(realistic, color, { roughness: 0.55, map: realistic ? grainTexture() : null, clearcoat: realistic ? 0.2 : 0 });
      case 'column': return std(realistic, color, { roughness: 0.92 });
      default: return std(realistic, color, { roughness: 0.62 });
    }
  }

  // ── Construction de la scène ──
  function addEdges(mesh, color) {
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), new THREE.LineBasicMaterial({ color })));
  }

  function build() {
    const { state, render } = store;
    const realistic = render.mode === 'realistic';
    const edgeColor = 0x4b524c;
    disposeTree(content);
    contentPicks = [];
    cutaway = [];
    groups = new Map();
    selectionHelper = null;
    ceiling = null;
    const H = state.wallHeight;

    const flat = (x) => !realistic && x; // arêtes dessinées en mode Éditeur seulement
    const shadowed = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

    if (state.room.length >= 3) {
      // Sol
      const look = FLOOR_LOOK[state.floor] || FLOOR_LOOK.parquet;
      const shape = new THREE.Shape(state.room.map((p) => new THREE.Vector2(p.x, -p.y)));
      const floorMat = realistic
        ? new THREE.MeshPhysicalMaterial({ map: floorTexture(state.floor), roughness: look.roughness, clearcoat: look.clearcoat, clearcoatRoughness: 0.35 })
        : new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.9 });
      const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      content.add(floor);

      buildWalls(H, realistic, edgeColor, shadowed, flat);

      // Plafond : retiré de la vue en coupe, mais présent pour les ombres. Sans lui, le soleil et
      // le ciel éclaireraient la pièce par le haut au lieu d'entrer par les ouvertures.
      if (realistic) {
        ceiling = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0xf6f4ef, roughness: 1, side: THREE.DoubleSide }));
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.y = H;
        ceiling.castShadow = true;
        content.add(ceiling);
      }
    }

    // Colonnes (contours libres)
    for (const col of state.columns) {
      if (!Array.isArray(col.points) || col.points.length < 3) continue;
      const h = Math.max(1, Number(col.height) || H);
      const geo = new THREE.ExtrudeGeometry(new THREE.Shape(col.points.map((p) => new THREE.Vector2(p.x, -p.y))), { depth: h, bevelEnabled: false });
      const mesh = shadowed(new THREE.Mesh(geo, std(realistic, col.color || state.wallColor, { roughness: 0.92 })));
      mesh.rotation.x = -Math.PI / 2;
      const group = new THREE.Group();
      group.position.y = Math.max(0, Number(col.elevation) || 0);
      group.add(mesh);
      if (flat(true)) addEdges(mesh, edgeColor);
      group.userData.pickId = col.id;
      content.add(group);
      contentPicks.push(group);
      groups.set(col.id, group);
    }

    // Objets
    for (const it of state.items) {
      if (isOpening(it)) continue;
      const group = buildItem(it, realistic, edgeColor, flat);
      content.add(group);
      contentPicks.push(group);
      groups.set(it.id, group);
    }
    // Portes et fenêtres sans mur correspondant (posées dans le vide)
    for (const it of state.items) {
      if (!isOpening(it)) continue;
      if (state.room.length >= 3 && wallMatch(it, state.room)) continue;
      const g = it.type === 'door' ? buildDoor(it, realistic) : buildWindow(it, realistic);
      g.userData.pickId = it.id;
      content.add(g);
      contentPicks.push(g);
      groups.set(it.id, g);
    }
    updateSelection();
    shadowsDirty = true;
    dirty = true;
  }

  function buildWalls(H, realistic, edgeColor, shadowed, flat) {
    const { state } = store;
    const { room } = state;
    const rings = wallRings(room, WALL_THICKNESS);
    const wallMat = std(realistic, state.wallColor, { roughness: 0.95 });
    const baseMat = std(realistic, 0xf2eee5, { roughness: 0.5 });

    // Ouvertures regroupées par mur
    const byWall = room.map(() => []);
    for (const it of state.items) {
      if (!isOpening(it)) continue;
      const m = wallMatch(it, room);
      if (!m) continue;
      const half = Math.max(1, it.w) / 2;
      const start = Math.max(0, m.s - half);
      const end = Math.min(m.len, m.s + half);
      if (end - start < 2) continue;
      byWall[m.i].push({ it, start, end, bottom: itemElevation(it), height: itemHeight(it) });
    }

    room.forEach((a, i) => {
      const j = (i + 1) % room.length;
      const b = room[j];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1) return;
      const n = rings.normals[i];
      const wallGroup = new THREE.Group();
      content.add(wallGroup);
      cutaway.push({ group: wallGroup, cx: (a.x + b.x) / 2, cz: (a.y + b.y) / 2, ox: -n.x, oz: -n.y });

      const lerp = (ring, t) => ({ x: ring[i].x + (ring[j].x - ring[i].x) * t, y: ring[i].y + (ring[j].y - ring[i].y) * t });
      const piece = (s0, s1, y0, y1, withBase) => {
        if (s1 - s0 < 1 || y1 - y0 < 1) return;
        const t0 = s0 / len;
        const t1 = s1 / len;
        const q = [lerp(rings.inner, t0), lerp(rings.inner, t1), lerp(rings.outer, t1), lerp(rings.outer, t0)];
        const geo = new THREE.ExtrudeGeometry(new THREE.Shape(q.map((p) => new THREE.Vector2(p.x, -p.y))), { depth: y1 - y0, bevelEnabled: false });
        const mesh = shadowed(new THREE.Mesh(geo, wallMat));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = y0;
        wallGroup.add(mesh);
        if (flat(true)) addEdges(mesh, edgeColor);
        if (realistic && withBase) {
          const bi = [q[0], q[1], { x: q[1].x + n.x * 1.4, y: q[1].y + n.y * 1.4 }, { x: q[0].x + n.x * 1.4, y: q[0].y + n.y * 1.4 }];
          const bg = new THREE.ExtrudeGeometry(new THREE.Shape(bi.map((p) => new THREE.Vector2(p.x, -p.y))), { depth: 8, bevelEnabled: false });
          const base = shadowed(new THREE.Mesh(bg, baseMat));
          base.rotation.x = -Math.PI / 2;
          wallGroup.add(base);
        }
      };

      // Découpe des ouvertures : on fusionne celles qui se chevauchent
      const ops = byWall[i].sort((u, v) => u.start - v.start);
      const spans = [];
      for (const op of ops) {
        const last = spans[spans.length - 1];
        if (last && op.start < last.end) {
          last.end = Math.max(last.end, op.end);
          last.bottom = Math.min(last.bottom, op.bottom);
          last.top = Math.max(last.top, op.bottom + op.height);
          last.items.push(op.it);
        } else spans.push({ start: op.start, end: op.end, bottom: op.bottom, top: op.bottom + op.height, items: [op.it] });
      }
      let cursor = 0;
      for (const sp of spans) {
        piece(cursor, sp.start, 0, H, true);
        const bottom = clamp(sp.bottom, 0, H - 1);
        const top = clamp(sp.top, bottom + 1, H);
        piece(sp.start, sp.end, 0, bottom, false);
        piece(sp.start, sp.end, top, H, false);
        cursor = Math.max(cursor, sp.end);
        for (const it of sp.items) {
          const g = it.type === 'door' ? buildDoor(it, realistic) : buildWindow(it, realistic);
          g.userData.pickId = it.id;
          wallGroup.add(g);
          contentPicks.push(g);
          groups.set(it.id, g);
        }
      }
      piece(cursor, len, 0, H, true);
    });
  }

  function itemFrame(it) {
    const g = new THREE.Group();
    g.position.set(it.x + it.w / 2, 0, it.y + it.d / 2);
    g.rotation.y = -rad(it.rot || 0);
    return g;
  }

  function box(w, h, d, x, y, z, mat, radius = 0) {
    const geo = radius > 0.2 && Math.min(w, h, d) > radius * 2.2
      ? new RoundedBoxGeometry(Math.max(0.5, w), Math.max(0.5, h), Math.max(0.5, d), 3, radius)
      : new THREE.BoxGeometry(Math.max(0.5, w), Math.max(0.5, h), Math.max(0.5, d));
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  function buildWindow(it, realistic) {
    const g = itemFrame(it);
    const sill = itemElevation(it);
    const h = itemHeight(it);
    const w = it.w;
    const frameMat = std(realistic, 0xf4f3ef, { roughness: 0.45 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: it.color || 0xb7d8e9, roughness: 0.04, metalness: 0, transparent: true, opacity: realistic ? 0.2 : 0.45,
      side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4,
    });
    const T = 4; // épaisseur du cadre
    const D = WALL_THICKNESS - 2;
    g.add(box(w, T, D, 0, sill + T / 2, 0, frameMat), box(w, T, D, 0, sill + h - T / 2, 0, frameMat));
    g.add(box(T, h, D, -w / 2 + T / 2, sill + h / 2, 0, frameMat), box(T, h, D, w / 2 - T / 2, sill + h / 2, 0, frameMat));
    if (w > 140) g.add(box(3, h, D * 0.7, 0, sill + h / 2, 0, frameMat));
    const glass = new THREE.Mesh(new THREE.BoxGeometry(w - 2 * T, h - 2 * T, 0.8), glassMat);
    glass.position.set(0, sill + h / 2, 0);
    glass.renderOrder = 2;
    g.add(glass);
    g.add(box(w + 8, 2.5, WALL_THICKNESS + 5, 0, sill - 1.2, 1.2, frameMat, 0.8));
    return g;
  }

  function buildDoor(it, realistic) {
    const g = itemFrame(it);
    const { state } = store;
    const bottom = itemElevation(it);
    const h = Math.min(itemHeight(it), state.wallHeight - bottom);
    const w = it.w;
    const frameMat = std(realistic, 0xf4f3ef, { roughness: 0.45 });
    const leafMat = std(realistic, it.color || 0xdce8f5, { roughness: 0.5, clearcoat: realistic ? 0.15 : 0 });
    const T = 4;
    const D = WALL_THICKNESS - 1;
    g.add(box(T, h, D, -w / 2 + T / 2, bottom + h / 2, 0, frameMat), box(T, h, D, w / 2 - T / 2, bottom + h / 2, 0, frameMat));
    g.add(box(w, T, D, 0, bottom + h - T / 2, 0, frameMat));

    const { angle, hingeB } = doorSwing(it, state.room);
    const dir = hingeB ? -1 : 1;
    const leafW = w - 2 * T - 0.6;
    const pivot = new THREE.Group();
    pivot.position.set(dir * -(w / 2 - T), bottom, 0);
    pivot.rotation.y = -rad(angle);
    pivot.add(box(leafW, h - T - 0.5, 3.6, dir * leafW / 2, (h - T) / 2, 0, leafMat, 0.6));
    const handleMat = std(realistic, 0xb9bcc0, { roughness: 0.25, metalness: realistic ? 0.9 : 0 });
    const hx = dir * (leafW - 7);
    pivot.add(box(11, 2, 1.5, hx, 100, 2.6, handleMat, 0.5), box(11, 2, 1.5, hx, 100, -2.6, handleMat, 0.5));
    g.add(pivot);
    return g;
  }

  function buildItem(it, realistic, edgeColor, flat) {
    const g = itemFrame(it);
    g.position.y = itemElevation(it);
    g.userData.pickId = it.id;
    const h = it.type === 'note' ? Math.max(1, Number(it.height) || 2) : itemHeight(it);
    const mat = itemMaterial(it, realistic);
    const r = realistic ? 1.2 : 0;
    const add = (m) => { g.add(m); return m; };
    switch (it.type) {
      case 'table': {
        const legs = std(realistic, 0x806343, { roughness: 0.6, map: realistic ? grainTexture() : null });
        const leg = clamp(Math.min(it.w, it.d) * 0.075, 4, 8);
        const topT = clamp(h * 0.06, 3, 5);
        const inX = Math.max(0, it.w / 2 - leg / 2 - Math.max(4, it.w * 0.1));
        const inZ = Math.max(0, it.d / 2 - leg / 2 - Math.max(4, it.d * 0.1));
        add(box(it.w, topT, it.d, 0, h - topT / 2, 0, mat, r));
        [[-inX, -inZ], [inX, -inZ], [-inX, inZ], [inX, inZ]].forEach(([x, z]) => add(box(leg, h - topT, leg, x, (h - topT) / 2, z, legs, 0.5)));
        break;
      }
      case 'chair': {
        const dark = std(realistic, 0x806b54, { roughness: 0.6 });
        const seatTop = Math.min(h - 8, Math.max(40, Math.min(46, h * 0.54)));
        const leg = clamp(Math.min(it.w, it.d) * 0.12, 3, 6);
        const inX = Math.max(0, it.w / 2 - leg / 2 - Math.max(3, it.w * 0.12));
        const inZ = Math.max(0, it.d / 2 - leg / 2 - Math.max(3, it.d * 0.12));
        add(box(it.w - 5, 4, it.d - 5, 0, seatTop, 0, mat, r));
        [[-inX, -inZ], [inX, -inZ], [-inX, inZ], [inX, inZ]].forEach(([x, z]) => add(box(leg, seatTop - 4, leg, x, (seatTop - 4) / 2, z, dark, 0.5)));
        const backH = Math.max(4, h - seatTop - 2);
        add(box(it.w - 7, backH, 4, 0, seatTop + backH / 2, -Math.max(0, it.d / 2 - 2), mat, r));
        break;
      }
      case 'shelf': {
        const sideT = clamp(it.w * 0.04, 2, 4);
        const boardT = clamp(h * 0.018, 2, 4);
        const backT = clamp(it.d * 0.08, 1.5, 3);
        add(box(sideT, h, it.d, -it.w / 2 + sideT / 2, h / 2, 0, mat, r));
        add(box(sideT, h, it.d, it.w / 2 - sideT / 2, h / 2, 0, mat, r));
        add(box(it.w - 2 * sideT, h, backT, 0, h / 2, -it.d / 2 + backT / 2, mat));
        const levels = clamp(Math.floor(h / 32) + 1, 2, 12);
        for (let i = 0; i < levels; i += 1) {
          const y = boardT / 2 + Math.max(0, h - boardT) * (i / (levels - 1));
          add(box(it.w - 2 * sideT, boardT, it.d - backT, 0, Math.min(h - boardT / 2, y), backT / 2, mat));
        }
        break;
      }
      case 'column': {
        const geo = (it.shape || 'round') === 'round'
          ? new THREE.CylinderGeometry(Math.min(it.w, it.d) * 0.48, Math.min(it.w, it.d) * 0.48, h, 32)
          : new THREE.BoxGeometry(it.w, h, it.d);
        const m = new THREE.Mesh(geo, mat);
        m.position.y = h / 2;
        m.castShadow = true;
        m.receiveShadow = true;
        add(m);
        break;
      }
      case 'ironing': {
        const frame = std(realistic, 0x8a8f96, { roughness: 0.4, metalness: realistic ? 0.7 : 0 });
        add(box(it.w, 3, it.d, 0, h - 1.5, 0, mat, Math.min(1.4, it.d / 4)));
        for (const x of [-it.w * 0.26, it.w * 0.26]) {
          for (const tilt of [0.32, -0.32]) {
            const bar = box(1.8, (h - 3) / Math.cos(0.32), 1.8, x, (h - 3) / 2, 0, frame, 0.4);
            bar.rotation.z = tilt;
            add(bar);
          }
        }
        add(box(it.w * 0.52, 1.5, 1.5, 0, 3, 0, frame, 0.4));
        break;
      }
      case 'dresser': {
        const metal = std(realistic, 0xb9bcc0, { roughness: 0.25, metalness: realistic ? 0.9 : 0 });
        add(box(it.w, h, it.d, 0, h / 2, 0, mat, r));
        const rows = 3;
        const gap = 1.2;
        const dh = (h - 8 - gap * (rows + 1)) / rows;
        for (let i = 0; i < rows; i += 1) {
          const y = 5 + gap + i * (dh + gap) + dh / 2;
          add(box(it.w - 4, dh, 1.2, 0, y, it.d / 2 + 0.3, mat, 0.5));
          add(box(Math.min(16, it.w * 0.2), 1.6, 1.8, 0, y, it.d / 2 + 1.6, metal, 0.5));
        }
        for (const x of [-it.w / 2 + 6, it.w / 2 - 6]) add(box(4, 5, 4, x, 2.5, it.d / 2 - 5, mat));
        break;
      }
      case 'radiator': {
        const fins = Math.max(3, Math.floor(it.w / 6));
        const pitch = (it.w - 4) / fins;
        for (let i = 0; i < fins; i += 1) add(box(Math.max(2, pitch - 1.4), h - 6, it.d, -it.w / 2 + 2 + pitch * (i + 0.5), h / 2, 0, mat, 1));
        add(box(it.w, 3, it.d + 1, 0, h - 1.5, 0, mat, 1));
        add(box(it.w, 3, it.d + 1, 0, 1.5, 0, mat, 1));
        add(box(5, 5, 5, it.w / 2 - 4, 6, it.d / 2 + 1, std(realistic, 0xb9bcc0, { roughness: 0.3, metalness: realistic ? 0.8 : 0 })));
        break;
      }
      case 'desklamp': {
        const dark = std(realistic, it.color, { roughness: 0.4, metalness: realistic ? 0.5 : 0 });
        const glow = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: realistic ? 5 : 1.2 });
        const baseR = Math.min(it.w, it.d) * 0.42;
        const baseM = new THREE.Mesh(new THREE.CylinderGeometry(baseR, baseR, 2, 28), dark);
        baseM.position.y = 1;
        baseM.castShadow = true;
        add(baseM);
        const arm = box(1.3, h * 0.62, 1.3, 0, h * 0.34, 0, dark, 0.4);
        arm.rotation.z = 0.18;
        add(arm);
        const head = new THREE.Mesh(new THREE.ConeGeometry(7, 9, 24, 1, true), new THREE.MeshStandardMaterial({ color: it.color, roughness: 0.5, side: THREE.DoubleSide }));
        head.position.set(-h * 0.1, h - 8, 0);
        head.castShadow = true;
        add(head);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(2.6, 14, 10), glow);
        bulb.position.set(-h * 0.1, h - 11, 0);
        add(bulb);
        break;
      }
      case 'appliance': {
        add(box(it.w, h, it.d, 0, h / 2, 0, mat, r * 1.5));
        if (realistic && it.w > 30 && it.d > 30) {
          const dark = std(realistic, 0x2a2d31, { roughness: 0.2, metalness: 0.2 });
          add(box(it.w * 0.8, h * 0.45, 0.8, 0, h * 0.5, it.d / 2 + 0.2, dark, 0.3));
        }
        break;
      }
      default:
        add(box(it.w, h, it.d, 0, h / 2, 0, mat, r * 1.5));
    }
    g.traverse((o) => { if (o.isMesh && flat(true)) o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 30), new THREE.LineBasicMaterial({ color: edgeColor }))); });
    return g;
  }

  // ── Lumières ──
  function sunVector(hour) {
    const t = clamp((hour - 6) / 15, 0, 1);
    const elevation = Math.max(2, 68 * Math.sin(Math.PI * t));
    const azimuth = 90 + t * 180; // est → sud → ouest ; le haut du plan est le nord
    const e = rad(elevation);
    const a = rad(azimuth);
    return { dir: new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)), elevation };
  }

  function roomBounds() {
    const { state } = store;
    const pts = state.room.length >= 3 ? state.room : [{ x: 0, y: 0 }, { x: 500, y: 400 }];
    const b = bounds(pts);
    const c = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minY + b.maxY) / 2);
    const radius = Math.max(150, Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2);
    return { b, c, radius };
  }

  function buildRig() {
    const { state, render } = store;
    const realistic = render.mode === 'realistic';
    disposeTree(rig);
    rigPicks = [];
    const { c, radius } = roomBounds();
    const H = state.wallHeight;
    const day = render.daylight;
    const bg = new THREE.Color();

    renderer.toneMapping = realistic ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
    renderer.toneMappingExposure = realistic ? render.exposure : 1;

    if (realistic) {
      const { dir, elevation } = sunVector(render.hour);
      const low = clamp(elevation / 35, 0, 1);
      const sunColor = new THREE.Color('#ff9a4d').lerp(new THREE.Color('#fff3e2'), low);
      const sunPower = 2.5 * day * clamp(elevation / 14, 0, 1);
      // fond du ciel : jour clair → crépuscule → nuit
      bg.set('#10141b').lerp(new THREE.Color(elevation < 12 && day > 0 ? '#8c8590' : '#dfe6ec'), clamp(day * 1.6, 0, 1));
      scene.background = bg;
      scene.environment = envTexture;
      scene.environmentIntensity = 0.02 + 0.05 * day;
      scene.backgroundIntensity = 1;

      if (sunPower > 0.02) {
        const sun = new THREE.DirectionalLight(sunColor, sunPower);
        sun.position.copy(c).addScaledVector(dir, radius * 3 + H);
        sun.target.position.copy(c);
        sun.castShadow = true;
        const map = render.softShadows ? 4096 : 2048;
        sun.shadow.mapSize.set(Math.min(map, renderer.capabilities.maxTextureSize), Math.min(map, renderer.capabilities.maxTextureSize));
        const cam = sun.shadow.camera;
        const r = radius * 1.35;
        cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
        cam.near = 1; cam.far = radius * 7 + H * 2;
        sun.shadow.bias = -0.0004;
        sun.shadow.normalBias = 1.5;
        rig.add(sun, sun.target);
      }
      const sky = new THREE.HemisphereLight('#bcd4ee', '#8d7d6c', 0.03 * day * Math.PI);
      rig.add(sky);
      // Éclairage du ciel : chaque fenêtre est une source rectangulaire tournée vers l'intérieur
      if (day > 0.02) {
        let count = 0;
        for (const it of state.items) {
          if (!isGlazed(it) || count >= MAX_WINDOW_LIGHTS) continue;
          const m = wallMatch(it, state.room);
          if (!m) continue;
          // Une ouverture tournée vers le soleil laisse entrer davantage de lumière.
          const toSun = Math.max(0, -(m.inward.x * dir.x + m.inward.y * dir.z) / (Math.hypot(dir.x, dir.z) || 1));
          const power = 5 * day * (0.5 + 0.5 * toSun) * clamp(0.35 + elevation / 40, 0.35, 1);
          const light = new THREE.RectAreaLight(new THREE.Color('#cfe3ff').lerp(sunColor, 0.25 + 0.4 * toSun), power, Math.max(10, it.w - 8), Math.max(10, itemHeight(it) - 8));
          const cx = it.x + it.w / 2;
          const cy = it.y + it.d / 2;
          light.position.set(cx + m.inward.x * 1.5, itemElevation(it) + itemHeight(it) / 2, cy + m.inward.y * 1.5);
          light.lookAt(light.position.x + m.inward.x * 100, light.position.y - 5, light.position.z + m.inward.y * 100);
          rig.add(light);
          count += 1;
        }
      }
      rig.add(new THREE.AmbientLight('#aab6cc', 0.03 + 0.03 * day));
    } else {
      bg.set(cssVar('--stage-bg', '#f1f3f1'));
      scene.background = bg;
      scene.environment = null;
      rig.add(new THREE.HemisphereLight(0xffffff, 0x9aa5b1, 2.3));
      rig.add(new THREE.AmbientLight(0xffffff, 0.5));
      const sun = new THREE.DirectionalLight(0xfff3df, 2.4);
      sun.position.set(c.x + radius * 0.8, H + radius * 1.2, c.z + radius * 0.7);
      sun.target.position.copy(c);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const r = radius * 1.3;
      sun.shadow.camera.left = -r; sun.shadow.camera.right = r; sun.shadow.camera.top = r; sun.shadow.camera.bottom = -r;
      sun.shadow.camera.far = radius * 6 + H * 2;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 1;
      rig.add(sun, sun.target);
    }

    // Sources du plan
    let shadowCount = 0;
    for (const src of state.lights) {
      if (src.enabled === false) continue;
      const color = new THREE.Color(src.color);
      const power = Math.max(0, Number(src.intensity) || 0);
      if (src.type === 'ambient') { rig.add(new THREE.AmbientLight(color, power * Math.PI * 0.6)); continue; }
      const ceilingMax = realistic && state.room.length >= 3 ? H - 3 : Infinity;
      const pos = new THREE.Vector3(Number(src.x) || c.x, Math.min(ceilingMax, Math.max(0, Number(src.height) || H * 0.8)), Number(src.planY) || c.z);
      const distance = Math.max(1, Number(src.distance) || 700);
      const castShadow = shadowCount < MAX_SHADOW_LIGHTS;
      if (castShadow) shadowCount += 1;
      let light;
      if (src.type === 'spot') {
        const target = new THREE.Vector3(Number(src.targetX ?? pos.x), 0, Number(src.targetY ?? pos.z));
        light = new THREE.SpotLight(color, power * LIGHT_K, distance, rad(clamp(Number(src.angle) || 50, 10, 120)) / 2, 0.5, 2);
        light.target.position.copy(target);
        rig.add(light.target);
      } else {
        light = new THREE.PointLight(color, power * LIGHT_K, distance, 2);
      }
      light.position.copy(pos);
      light.castShadow = castShadow;
      light.shadow.mapSize.set(realistic && render.softShadows ? 1024 : 512, realistic && render.softShadows ? 1024 : 512);
      light.shadow.bias = -0.0006;
      light.shadow.normalBias = 1;
      light.shadow.camera.near = 4;
      rig.add(light);
      rig.add(buildFixture(src, pos, color, H, realistic));
    }
    // Lampes de bureau posées dans le plan : elles éclairent comme une lampe ponctuelle.
    for (const it of state.items) {
      if (it.type !== 'desklamp') continue;
      const lamp = new THREE.PointLight('#ffd9a0', 1.6 * LIGHT_K, 450, 2);
      lamp.position.set(it.x + it.w / 2, itemElevation(it) + itemHeight(it) - 6, it.y + it.d / 2);
      lamp.castShadow = shadowCount < MAX_SHADOW_LIGHTS;
      if (lamp.castShadow) shadowCount += 1;
      lamp.shadow.mapSize.set(512, 512);
      lamp.shadow.bias = -0.0006;
      lamp.shadow.normalBias = 1;
      lamp.shadow.camera.near = 3;
      rig.add(lamp);
    }
    rigSignature = signature();
    shadowsDirty = true;
    dirty = true;
  }

  // Luminaire visible dans la scène (et cible de sélection en 3D)
  function buildFixture(src, pos, color, H, realistic) {
    const g = new THREE.Group();
    g.position.copy(pos);
    g.userData.pickLight = src.id;
    const glow = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: realistic ? 6 : 1.4, roughness: 0.4 });
    const metal = std(realistic, 0xe9e7e2, { roughness: 0.4, metalness: realistic ? 0.5 : 0 });
    if (src.type === 'spot') {
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 7, 24), metal);
      housing.rotation.x = Math.PI / 2;
      const face = new THREE.Mesh(new THREE.CircleGeometry(4.2, 24), glow);
      face.position.z = 3.6;
      g.add(housing, face);
      const t = new THREE.Vector3(Number(src.targetX ?? pos.x), 0, Number(src.targetY ?? pos.z));
      g.lookAt(t);
    } else {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 14), glow);
      g.add(bulb);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(14, 12, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0xf2eee5, roughness: 0.8, side: THREE.DoubleSide }));
      shade.position.y = 8;
      g.add(shade);
      const cordLen = Math.max(0, H - pos.y - 14);
      if (cordLen > 1) {
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, cordLen, 6), new THREE.MeshBasicMaterial({ color: 0x333333 }));
        cord.position.y = 14 + cordLen / 2;
        g.add(cord);
      }
    }
    const hit = new THREE.Mesh(new THREE.SphereGeometry(16, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    g.add(hit);
    contentPicks.push(g);
    return g;
  }

  // ── Sélection ──
  function updateSelection() {
    if (selectionHelper) { scene.remove(selectionHelper); selectionHelper.geometry.dispose(); selectionHelper.material.dispose(); selectionHelper = null; }
    const { ui } = store;
    const target = groups.get(ui.selected) || (ui.light ? rig.children.find((o) => o.userData.pickLight === ui.light) : null);
    if (target) {
      selectionHelper = new THREE.BoxHelper(target, new THREE.Color(cssVar('--accent', '#C0392B')));
      selectionHelper.material.depthTest = false;
      selectionHelper.renderOrder = 30;
      scene.add(selectionHelper);
    }
    dirty = true;
  }

  // ── Cadrage de la caméra ──
  function frame() {
    const { state } = store;
    const box = new THREE.Box3();
    for (const p of state.room) { box.expandByPoint(new THREE.Vector3(p.x, 0, p.y)); box.expandByPoint(new THREE.Vector3(p.x, state.wallHeight, p.y)); }
    for (const it of state.items) {
      const r = Math.hypot(it.w, it.d) / 2;
      box.expandByPoint(new THREE.Vector3(it.x + it.w / 2 - r, 0, it.y + it.d / 2 - r));
      box.expandByPoint(new THREE.Vector3(it.x + it.w / 2 + r, itemElevation(it) + itemHeight(it), it.y + it.d / 2 + r));
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(500, state.wallHeight, 400));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const fov = rad(camera.fov);
    const limiting = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * camera.aspect));
    fitDistance = Math.max(200, (sphere.radius / Math.sin(limiting / 2)) * 0.95);
    camera.far = Math.max(20000, fitDistance * 12);
    camera.updateProjectionMatrix();
    controls.minDistance = 60;
    controls.maxDistance = fitDistance * 4;
    controls.target.set(sphere.center.x, Math.min(state.wallHeight, sphere.center.y) * 0.8, sphere.center.z);
    const dir = new THREE.Vector3(Math.sin(0.6) * Math.cos(0.75), Math.sin(0.75), Math.cos(0.6) * Math.cos(0.75));
    camera.position.copy(controls.target).addScaledVector(dir, fitDistance);
    controls.update();
    framed = state.room.length >= 3;
    dirty = true;
  }

  // ── Interaction : sélection et déplacement à la souris ──
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function setRay(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  const visibleChain = (o) => { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; };

  function pickAt(e) {
    setRay(e);
    const hits = raycaster.intersectObjects(allPicks(), true);
    for (const h of hits) {
      if (!visibleChain(h.object)) continue;
      for (let n = h.object; n; n = n.parent) {
        if (n.userData.pickId) return { id: n.userData.pickId, point: h.point };
        if (n.userData.pickLight) return { light: n.userData.pickLight, point: h.point };
      }
    }
    return null;
  }

  function attachPointer() {
    const canvas = renderer.domElement;
    // Phase de capture : sans cela OrbitControls démarrerait une rotation avant nous.
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const hit = pickAt(e);
      if (!hit) { emptyDown = { x: e.clientX, y: e.clientY }; return; }
      e.stopImmediatePropagation();
      const { state } = store;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y);
      const start = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, start);
      if (hit.light) {
        const l = state.lights.find((x) => x.id === hit.light);
        store.setTool('select');
        store.select({ light: hit.light });
        if (!l) return;
        if (store.isLocked(hit.light)) return;
        drag = { kind: 'light', id: hit.light, plane, start, ox: l.x, oy: l.planY, px: e.clientX, py: e.clientY, moved: false };
        return;
      }
      store.setTool('select');
      store.select({ id: hit.id });
      const it = state.items.find((x) => x.id === hit.id);
      const col = state.columns.find((x) => x.id === hit.id);
      if (store.isLocked(hit.id)) return;
      drag = {
        kind: it ? 'item' : 'column', id: hit.id, plane, start, ox: it?.x, oy: it?.y,
        original: col?.points.map((p) => ({ ...p })), px: e.clientX, py: e.clientY, moved: false,
      };
    }, { capture: true });

    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.px, e.clientY - drag.py) < CLICK_PX) return;
      if (!drag.moved) { store.checkpoint(); drag.moved = true; controls.enabled = false; }
      setRay(e);
      const p = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(drag.plane, p)) return;
      const dx = p.x - drag.start.x;
      const dz = p.z - drag.start.z;
      const { state } = store;
      if (drag.kind === 'item') {
        const it = state.items.find((x) => x.id === drag.id);
        if (!it) return;
        it.x = round5(drag.ox + dx);
        it.y = round5(drag.oy + dz);
        if (isOpening(it)) snapOpeningToWall(it, state.room);
        else { const g = groups.get(it.id); if (g) { g.position.x = it.x + it.w / 2; g.position.z = it.y + it.d / 2; } }
      } else if (drag.kind === 'column') {
        const col = state.columns.find((x) => x.id === drag.id);
        if (!col) return;
        col.points = drag.original.map((q) => ({ x: q.x + round5(dx), y: q.y + round5(dz) }));
      } else {
        const l = state.lights.find((x) => x.id === drag.id);
        if (!l) return;
        l.x = round5(drag.ox + dx);
        l.planY = round5(drag.oy + dz);
      }
      store.changed();
    });

    window.addEventListener('pointerup', (e) => {
      if (drag) { controls.enabled = true; drag = null; }
      if (emptyDown && Math.hypot(e.clientX - emptyDown.x, e.clientY - emptyDown.y) < CLICK_PX) store.clearSelection();
      emptyDown = null;
    });
  }

  // ── Synchronisation avec le plan ──
  function signature() {
    const { state, render } = store;
    const wins = state.items.filter((i) => isGlazed(i) || i.type === 'desklamp').map((i) => [i.x, i.y, i.w, i.rot, i.height, i.elevation]);
    return JSON.stringify([state.lights, state.room, state.wallHeight, render.mode, render.hour, render.daylight, render.exposure, render.softShadows, wins]);
  }

  function refresh() {
    if (!init()) return;
    resize();
    if (store.render.mode !== 'realistic' && composer) { /* le compositeur reste en mémoire pour un retour rapide */ }
    build();
    buildRig();
    if (!framed) frame();
    stale = false;
  }

  // Un objet ordinaire déplacé en 3D : seul le groupe bouge, rien n'est reconstruit.
  function isFastMove() {
    return drag?.moved && drag.kind === 'item' && !isOpening(store.state.items.find((i) => i.id === drag.id) || {});
  }

  store.subscribe((kind) => {
    if (!active) { stale = true; return; }
    if (kind === 'plan') {
      if (isFastMove()) { shadowsDirty = true; dirty = true; updateSelection(); return; }
      const sigChanged = signature() !== rigSignature;
      build();
      if (sigChanged) buildRig();
      if (!framed) frame();
    } else if (kind === 'select') updateSelection();
    else if (kind === 'render') { build(); buildRig(); }
  });

  return {
    setActive(on) {
      active = on;
      if (!on) return;
      if (!renderer && !init()) return;
      if (stale || !renderer) refresh();
      resize();
      dirty = true;
    },
    resetView() { if (renderer) frame(); },
    // Image PNG du rendu courant, en résolution doublée (4096 px maximum).
    snapshot() {
      if (!renderer) return null;
      const ratio = renderer.getPixelRatio();
      const w = container.clientWidth;
      const h = container.clientHeight;
      const scale = Math.min(2, 4096 / Math.max(w, h) / Math.max(1, ratio));
      renderer.setPixelRatio(ratio * Math.max(1, scale));
      composer?.setPixelRatio(ratio * Math.max(1, scale));
      renderer.setSize(w, h);
      composer?.setSize(w, h);
      renderFrame();
      const url = renderer.domElement.toDataURL('image/png');
      renderer.setPixelRatio(ratio);
      composer?.setPixelRatio(ratio);
      renderer.setSize(w, h);
      composer?.setSize(w, h);
      dirty = true;
      return url;
    },
  };
}
