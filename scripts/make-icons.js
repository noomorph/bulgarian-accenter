'use strict';
/**
 * Generates icons/icon{16,32,48,128}.png — no image dependencies, just zlib.
 *
 * The mark: a white acute accent over a white bar, on Bulgarian-flag green.
 * Shapes are signed-distance capsules sampled 4x4 per pixel, which is what keeps the
 * 16px icon from turning to mush.
 *
 *   node scripts/make-icons.js
 */
const { deflateSync } = require('node:zlib');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const GREEN = [0x00, 0x96, 0x6e];
const WHITE = [0xff, 0xff, 0xff];
const SS = 4; // supersampling factor per axis

/** Distance from p to the segment ab, in the same units as the inputs. */
function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : (apx * abx + apy * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Inside-ness of a rounded rectangle covering the whole canvas. */
function inRoundedRect(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function renderIcon(size) {
  const px = Buffer.alloc(size * size * 4);

  // Geometry in fractions of `size`, so every icon is the same drawing.
  const radius = 0.22 * size;
  const accent = { ax: 0.4 * size, ay: 0.44 * size, bx: 0.62 * size, by: 0.24 * size, w: 0.055 * size };
  const bar = { ax: 0.3 * size, ay: 0.7 * size, bx: 0.7 * size, by: 0.7 * size, w: 0.06 * size };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgCov = 0;
      let fgCov = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px_ = x + (sx + 0.5) / SS;
          const py_ = y + (sy + 0.5) / SS;
          if (!inRoundedRect(px_, py_, size, radius)) continue;
          bgCov++;
          const dAccent = distToSegment(px_, py_, accent.ax, accent.ay, accent.bx, accent.by);
          const dBar = distToSegment(px_, py_, bar.ax, bar.ay, bar.bx, bar.by);
          if (dAccent <= accent.w || dBar <= bar.w) fgCov++;
        }
      }

      const total = SS * SS;
      const alpha = bgCov / total;
      const fg = bgCov === 0 ? 0 : fgCov / bgCov;

      const r = GREEN[0] + (WHITE[0] - GREEN[0]) * fg;
      const g = GREEN[1] + (WHITE[1] - GREEN[1]) * fg;
      const b = GREEN[2] + (WHITE[2] - GREEN[2]) * fg;

      const o = (y * size + x) * 4;
      px[o] = Math.round(r);
      px[o + 1] = Math.round(g);
      px[o + 2] = Math.round(b);
      px[o + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

// --- minimal PNG encoder ----------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12: compression, filter, interlace — all 0

  // Raw scanlines, each prefixed with filter type 0 (None).
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const src = y * size * 4;
    const dst = y * (size * 4 + 1);
    raw[dst] = 0;
    pixels.copy(raw, dst + 1, src, src + size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = join(__dirname, '..', 'icons');
mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = join(outDir, `icon${size}.png`);
  writeFileSync(file, encodePng(renderIcon(size), size));
  process.stderr.write(`make-icons: wrote ${file}\n`);
}
