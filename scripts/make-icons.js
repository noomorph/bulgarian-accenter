'use strict';
/**
 * Generates icons/icon{16,32,48,128}.png from assets/icon.png — no image dependencies, just zlib.
 *
 * The mark is the Bulgarian ъ under an acute accent, on the flag's three bands. assets/icon.png is
 * the master and the only thing to edit by hand; these four PNGs are derived.
 *
 * Resampling happens in *premultiplied* alpha. Averaging straight RGBA would let the transparent
 * pixels outside the rounded corners drag their (arbitrary) colour into the edge pixels, which is
 * where the grey fringe around a downscaled icon comes from.
 *
 *   node scripts/make-icons.js
 */
const { inflateSync, deflateSync } = require('node:zlib');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const SIZES = [16, 32, 48, 128];

// --- PNG decode -------------------------------------------------------------
/** Decodes an 8-bit, non-interlaced PNG to flat RGBA. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const depth = buf[24];
  const colorType = buf[25];
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];

  if (depth !== 8) throw new Error(`unsupported bit depth: ${depth}`);
  if (buf[28] !== 0) throw new Error('interlaced PNGs are not supported');
  if (!channels) throw new Error(`unsupported colour type: ${colorType}`);

  const idat = [];
  for (let off = 8; off < buf.length;) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('ascii');
    if (type === 'IDAT') idat.push(buf.slice(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));

    // Undo the per-scanline filter (PNG spec, 9.2).
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }

    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      const grey = channels < 3;
      out[d] = line[s];
      out[d + 1] = grey ? line[s] : line[s + 1];
      out[d + 2] = grey ? line[s] : line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : channels === 2 ? line[s + 1] : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

// --- geometry ---------------------------------------------------------------
/**
 * Crops away fully transparent margins and centres what is left on a square canvas, so the mark
 * fills the frame however the master happened to be exported.
 */
function trimToSquare(img) {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('assets/icon.png is fully transparent');

  const side = Math.max(maxX - minX + 1, maxY - minY + 1);
  const offX = minX - Math.floor((side - (maxX - minX + 1)) / 2);
  const offY = minY - Math.floor((side - (maxY - minY + 1)) / 2);
  const data = Buffer.alloc(side * side * 4);

  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const sx = offX + x;
      const sy = offY + y;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const src = (sy * img.width + sx) * 4;
      img.data.copy(data, (y * side + x) * 4, src, src + 4);
    }
  }
  return { width: side, height: side, data };
}

/** Area-average resample: each source pixel is weighted by how much of it the target pixel covers. */
function resample(img, size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = img.width / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = x * scale;
      const x1 = (x + 1) * scale;
      const y0 = y * scale;
      const y1 = (y + 1) * scale;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weight = 0;

      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          const w = wx * wy;
          const o = (sy * img.width + sx) * 4;
          const alpha = img.data[o + 3] / 255;

          // Premultiplied: a pixel's colour counts only in proportion to its opacity.
          r += img.data[o] * alpha * w;
          g += img.data[o + 1] * alpha * w;
          b += img.data[o + 2] * alpha * w;
          a += alpha * w;
          weight += w;
        }
      }

      const alpha = a / weight;
      const o = (y * size + x) * 4;
      // Undo the premultiply. Where alpha is 0 the colour is meaningless, so leave it black.
      out[o] = alpha > 0 ? Math.round(r / weight / alpha) : 0;
      out[o + 1] = alpha > 0 ? Math.round(g / weight / alpha) : 0;
      out[o + 2] = alpha > 0 ? Math.round(b / weight / alpha) : 0;
      out[o + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

// --- PNG encode -------------------------------------------------------------
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

const master = trimToSquare(decodePng(readFileSync(join(__dirname, '..', 'assets', 'icon.png'))));
const outDir = join(__dirname, '..', 'icons');
mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const file = join(outDir, `icon${size}.png`);
  writeFileSync(file, encodePng(resample(master, size), size));
  process.stderr.write(`make-icons: wrote ${file}\n`);
}
