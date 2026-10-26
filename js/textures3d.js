// Textures procédurales du rendu réaliste (aucun fichier image à charger).
import * as THREE from 'three';

const cache = new Map();

// Générateur pseudo-aléatoire déterministe : le même sol donne toujours la même texture.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size, draw, repeatCm) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (repeatCm) tex.repeat.set(1 / repeatCm, 1 / repeatCm); // la géométrie du sol est en centimètres
  return tex;
}

function parquet(ctx, size) {
  const rand = rng(11);
  const rows = 10;
  const rowH = size / rows;
  const tones = [[176, 138, 98], [166, 128, 90], [186, 150, 110], [158, 120, 84], [192, 158, 120]];
  for (let r = 0; r < rows; r += 1) {
    let x = -rand() * size * 0.5;
    while (x < size) {
      const len = size * (0.38 + rand() * 0.3);
      const [R, G, B] = tones[Math.floor(rand() * tones.length)];
      const k = 0.92 + rand() * 0.16;
      ctx.fillStyle = `rgb(${R * k | 0},${G * k | 0},${B * k | 0})`;
      ctx.fillRect(x, r * rowH, len, rowH);
      // veinage
      for (let g = 0; g < 14; g += 1) {
        ctx.strokeStyle = `rgba(${60 + rand() * 30 | 0},${35 + rand() * 20 | 0},15,${0.05 + rand() * 0.1})`;
        ctx.lineWidth = 0.6 + rand() * 1.2;
        const y = r * rowH + rand() * rowH;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + len * 0.3, y + (rand() - 0.5) * 5, x + len * 0.7, y + (rand() - 0.5) * 5, x + len, y + (rand() - 0.5) * 3);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,22,8,0.55)';
      ctx.fillRect(x, r * rowH, 1.5, rowH); // joint de bout
      x += len;
    }
    ctx.fillStyle = 'rgba(40,22,8,0.6)';
    ctx.fillRect(0, r * rowH, size, 1.5); // joint de rive
  }
}

function tile(ctx, size) {
  const rand = rng(5);
  const n = 2;
  const cell = size / n;
  ctx.fillStyle = '#9a9d98';
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
    const v = 214 + rand() * 14;
    ctx.fillStyle = `rgb(${v | 0},${(v - 1) | 0},${(v - 4) | 0})`;
    ctx.fillRect(x * cell + 3, y * cell + 3, cell - 6, cell - 6);
    for (let i = 0; i < 60; i += 1) {
      ctx.fillStyle = `rgba(120,120,115,${rand() * 0.06})`;
      ctx.fillRect(x * cell + rand() * cell, y * cell + rand() * cell, 2 + rand() * 18, 1 + rand() * 3);
    }
  }
}

function concrete(ctx, size) {
  const rand = rng(23);
  ctx.fillStyle = '#a7a8a5';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i += 1) {
    const v = 130 + rand() * 80;
    ctx.fillStyle = `rgba(${v | 0},${v | 0},${(v - 3) | 0},${0.05 + rand() * 0.12})`;
    const r = 2 + rand() * 26;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function grain(ctx, size) {
  const rand = rng(41);
  ctx.fillStyle = '#e9e9e9';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i += 1) {
    ctx.strokeStyle = `rgba(0,0,0,${0.03 + rand() * 0.07})`;
    ctx.lineWidth = 0.5 + rand() * 1.6;
    const y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.3, y + (rand() - 0.5) * 12, size * 0.7, y + (rand() - 0.5) * 12, size, y + (rand() - 0.5) * 6);
    ctx.stroke();
  }
}

export const FLOOR_LOOK = {
  parquet: { repeat: 120, roughness: 0.55, clearcoat: 0.25 },
  tile: { repeat: 120, roughness: 0.3, clearcoat: 0.4 },
  concrete: { repeat: 240, roughness: 0.82, clearcoat: 0 },
};

export function floorTexture(kind) {
  const key = `floor:${kind}`;
  if (!cache.has(key)) {
    const draw = { parquet, tile, concrete }[kind] || parquet;
    cache.set(key, canvasTexture(1024, draw, FLOOR_LOOK[kind]?.repeat ?? 120));
  }
  return cache.get(key);
}

// Veinage en niveaux de gris : multiplie la couleur choisie pour le bois.
export function grainTexture() {
  if (!cache.has('grain')) {
    const tex = canvasTexture(256, grain, 0);
    tex.repeat.set(1, 1);
    cache.set('grain', tex);
  }
  return cache.get('grain');
}
