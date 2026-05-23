'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── PNG encoder (pure Node.js, no deps) ─────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t   = Buffer.from(type, 'ascii');
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.allocUnsafe(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function makePNG(w, h, pixelFn) {
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = ihdr[11] = ihdr[12] = 0; // RGBA, no interlace

  const rows = Buffer.allocUnsafe(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const base = y * (1 + w * 4);
    rows[base] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixelFn(x, y);
      const o = base + 1 + x * 4;
      rows[o] = r; rows[o+1] = g; rows[o+2] = b; rows[o+3] = 255;
    }
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── SDF helpers ──────────────────────────────────────────────────────────────

// Signed distance to axis-aligned rounded rectangle. Positive = inside.
function sdRR(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return r
    - Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2)
    - Math.max(Math.min(qx, 0), Math.min(qy, 0));
}

// Signed distance to circle. Positive = inside.
function sdCircle(px, py, cx, cy, r) {
  return r - Math.hypot(px - cx, py - cy);
}

// Signed distance to triangle (v0, v1, v2). Positive = inside.
function sdTriangle(px, py, ax, ay, bx, by, cx, cy) {
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function dot(ux, uy, vx, vy) { return ux * vx + uy * vy; }
  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
    const t = clamp01(dot(px - ax, py - ay, dx, dy) / len2);
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }

  const c1 = (bx-ax)*(py-ay) - (by-ay)*(px-ax);
  const c2 = (cx-bx)*(py-by) - (cy-by)*(px-bx);
  const c3 = (ax-cx)*(py-cy) - (ay-cy)*(px-cx);
  const inside = !((c1<0||c2<0||c3<0) && (c1>0||c2>0||c3>0));

  const d = Math.min(
    distSeg(px, py, ax, ay, bx, by),
    distSeg(px, py, bx, by, cx, cy),
    distSeg(px, py, cx, cy, ax, ay),
  );
  return inside ? d : -d;
}

// Anti-alias coverage from signed distance (positive = inside).
function aa(dist) { return Math.max(0, Math.min(1, dist + 0.5)); }

// ── Icon pixel function ──────────────────────────────────────────────────────

function makeIconPixel(px, py, size) {
  const cx = size / 2;
  const cy = size / 2;

  // ── Bubble body (rounded rect) ────────────────────────────────────────────
  const bW  = size * 0.60;
  const bH  = size * 0.46;
  const bCx = cx;
  const bCy = cy - size * 0.05; // shifted slightly above center
  const bR  = size * 0.078;
  const bHW = bW / 2;
  const bHH = bH / 2;
  const bL  = bCx - bHW; // bubble left
  const bB  = bCy + bHH; // bubble bottom

  // ── Tail triangle ─────────────────────────────────────────────────────────
  // Base sits 2px inside the bubble bottom so the two shapes merge seamlessly.
  const t0x = bL + bR + size * 0.015, t0y = bB - 2;   // top-left of base
  const t1x = bL + bR + size * 0.095, t1y = bB - 2;   // top-right of base
  const t2x = bL + size * 0.06,       t2y = bB + size * 0.12; // tip

  // ── Blue dot (centered in bubble) ────────────────────────────────────────
  const dR = size * 0.075;

  // ── Composite ─────────────────────────────────────────────────────────────
  const aBubble = aa(sdRR(px, py, bCx, bCy, bHW, bHH, bR));
  const aTail   = aa(sdTriangle(px, py, t0x, t0y, t1x, t1y, t2x, t2y));
  const aShape  = Math.max(aBubble, aTail); // union of white shapes

  const aDot = aa(sdCircle(px, py, bCx, bCy, dR));

  // Composite black → white (bubble) → blue (dot)
  let r = 0, g = 0, b = 0;
  r = r + (245 - r) * aShape; g = g + (245 - g) * aShape; b = b + (245 - b) * aShape;
  r = r + ( 29 - r) * aDot;  g = g + ( 78 - g) * aDot;  b = b + (216 - b) * aDot;

  return [Math.round(r), Math.round(g), Math.round(b)];
}

// ── Generate ─────────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const icons = [
  { size: 192, name: 'icon-192x192.png' },
  { size: 512, name: 'icon-512x512.png' },
  { size: 180, name: 'apple-touch-icon.png' },
];

for (const { size, name } of icons) {
  const png = makePNG(size, size, (x, y) => makeIconPixel(x, y, size));
  fs.writeFileSync(path.join(outDir, name), png);
  console.log(`  ✓ ${name} (${size}×${size})`);
}
