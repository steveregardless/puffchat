'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── PNG encoder ───────────────────────────────────────────────────────────────

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
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = ihdr[11] = ihdr[12] = 0;

  const rows = Buffer.allocUnsafe(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const base = y * (1 + w * 4);
    rows[base] = 0;
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

// ── SDF helpers ───────────────────────────────────────────────────────────────

// Signed distance to circle (positive = inside)
function sdCircle(px, py, cx, cy, r) {
  return r - Math.hypot(px - cx, py - cy);
}

// Signed distance to triangle (positive = inside)
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
  const c1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const c2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const c3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const inside = !((c1 < 0 || c2 < 0 || c3 < 0) && (c1 > 0 || c2 > 0 || c3 > 0));
  const d = Math.min(
    distSeg(px, py, ax, ay, bx, by),
    distSeg(px, py, bx, by, cx, cy),
    distSeg(px, py, cx, cy, ax, ay),
  );
  return inside ? d : -d;
}

// Anti-alias coverage from signed distance
function aa(dist) { return Math.max(0, Math.min(1, dist + 0.5)); }

// ── Icon pixel — circle ring + three dots + tail ──────────────────────────────
//
// Matches the reference design: thick blue circle outline (speech bubble),
// three blue dots centered inside, triangular tail at bottom-left (~8 o'clock).

function makeIconPixel(px, py, size) {
  const cx = size / 2, cy = size / 2;

  // ── Circle ring ──────────────────────────────────────────────────────────
  const outerR  = size * 0.365;
  const innerR  = size * 0.300; // outerR - strokeW; strokeW = size * 0.065
  const aOuter  = aa(sdCircle(px, py, cx, cy, outerR));
  const aInner  = aa(sdCircle(px, py, cx, cy, innerR));
  const aRing   = aOuter * (1 - aInner);

  // ── Tail triangle (bottom-left, ~8 o'clock) ──────────────────────────────
  // Angles in standard maths convention (CCW from right); y is screen-flipped.
  //   screen x = cx + R * cos(θ)
  //   screen y = cy - R * sin(θ)
  const DEG = Math.PI / 180;
  const a0 = 200 * DEG, a1 = 225 * DEG, aMid = 212.5 * DEG;

  const t0x = cx + outerR * Math.cos(a0), t0y = cy - outerR * Math.sin(a0);
  const t1x = cx + outerR * Math.cos(a1), t1y = cy - outerR * Math.sin(a1);
  const tipR = outerR * 1.30;
  const t2x = cx + tipR * Math.cos(aMid), t2y = cy - tipR * Math.sin(aMid);

  const aTail = aa(sdTriangle(px, py, t0x, t0y, t1x, t1y, t2x, t2y));

  // ── Three dots (equally spaced, vertically centered) ─────────────────────
  const dotR      = size * 0.046;
  const dotSpacing = size * 0.135;
  const dotY      = cy;
  const aDot1 = aa(sdCircle(px, py, cx - dotSpacing, dotY, dotR));
  const aDot2 = aa(sdCircle(px, py, cx,              dotY, dotR));
  const aDot3 = aa(sdCircle(px, py, cx + dotSpacing, dotY, dotR));

  // ── Union of all blue shapes ──────────────────────────────────────────────
  const aBlue = Math.max(aRing, aTail, aDot1, aDot2, aDot3);

  // Blue: #1D4ED8
  return [Math.round(29 * aBlue), Math.round(78 * aBlue), Math.round(216 * aBlue)];
}

// ── Generate ──────────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, '..', 'public');
fs.mkdirSync(outDir, { recursive: true });

// Remove old icons/ subdirectory if it exists
const oldIconsDir = path.join(outDir, 'icons');
if (fs.existsSync(oldIconsDir)) {
  fs.rmSync(oldIconsDir, { recursive: true, force: true });
  console.log('  ✓ removed old public/icons/');
}

const icons = [
  { size: 512, name: 'icon-512.png' },
  { size: 192, name: 'icon-192.png' },
  { size: 180, name: 'apple-touch-icon.png' },
];

for (const { size, name } of icons) {
  const png = makePNG(size, size, (x, y) => makeIconPixel(x, y, size));
  fs.writeFileSync(path.join(outDir, name), png);
  console.log(`  ✓ ${name} (${size}×${size})`);
}
