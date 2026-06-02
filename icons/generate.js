// Pure-Node orb icon rasterizer — no ImageMagick/PIL/canvas needed.
// Renders the Cloak orb (accent circle + ink stroke) and writes PNGs via zlib.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const OUT = '/home/user/cloak/icons';

// brand colors
const ACC = [0xD4, 0x4D, 0x2A];
const INK = [0x0A, 0x0A, 0x0A];
const PAPER = [0xF2, 0xEE, 0xE5];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // raw scanlines with filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// blend src (with alpha 0..1) over dst rgb
function over(dst, src, a) {
  return [
    Math.round(src[0] * a + dst[0] * (1 - a)),
    Math.round(src[1] * a + dst[1] * (1 - a)),
    Math.round(src[2] * a + dst[2] * (1 - a)),
  ];
}

// Render an orb. opts: { size, bg: rgb|null, rx: cornerRadiusFraction, rFrac, strokeFrac }
function renderOrb({ size, bg, rx = 0, rFrac, strokeFrac }) {
  const S = size, SS = 4; // 4x4 supersample
  const rgba = Buffer.alloc(S * S * 4);
  const cx = S / 2, cy = S / 2;
  const r = rFrac * S;
  const sw = strokeFrac * S;
  const rInner = r - sw / 2, rOuter = r + sw / 2;
  const corner = rx * S;

  function insideRoundRect(x, y) {
    // rounded rect covering full canvas with corner radius `corner`
    const dx = Math.min(x, S - x), dy = Math.min(y, S - y);
    if (dx >= corner || dy >= corner) return true;
    const ex = corner - dx, ey = corner - dy;
    return (ex * ex + ey * ey) <= corner * corner;
  }

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      let R = 0, G = 0, B = 0, A = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          // base = bg (paper) or transparent
          let col, alpha;
          if (bg && insideRoundRect(x, y)) { col = bg; alpha = 1; }
          else { col = [0, 0, 0]; alpha = 0; }
          // draw orb on top
          const d = Math.hypot(x - cx, y - cy);
          if (d <= rInner) { col = ACC; alpha = 1; }
          else if (d <= rOuter) { col = INK; alpha = 1; }
          // accumulate
          if (alpha > 0) {
            const base = (A > 0) ? [R / A, G / A, B / A] : [0, 0, 0];
            const blended = over(base, col, 1); // opaque samples
            R += blended[0]; G += blended[1]; B += blended[2]; A += 1;
          }
        }
      }
      const n = SS * SS;
      const a = A / n;
      const idx = (py * S + px) * 4;
      if (A > 0) {
        rgba[idx] = Math.round(R / A);
        rgba[idx + 1] = Math.round(G / A);
        rgba[idx + 2] = Math.round(B / A);
      }
      rgba[idx + 3] = Math.round(a * 255);
    }
  }
  return encodePNG(S, S, rgba);
}

const jobs = [
  // transparent orb icons (manifest 192/512)
  { file: 'icon-192.png', size: 192, bg: null, rFrac: 0.40, strokeFrac: 0.062 },
  { file: 'icon-512.png', size: 512, bg: null, rFrac: 0.40, strokeFrac: 0.062 },
  // apple-touch — iOS ignores transparency; full paper square, generous orb
  { file: 'apple-touch-icon.png', size: 180, bg: PAPER, rx: 0, rFrac: 0.34, strokeFrac: 0.05 },
  // maskable — paper rounded square, orb within safe zone (~0.29 keeps inside 80% safe circle)
  { file: 'icon-maskable-512.png', size: 512, bg: PAPER, rx: 0.1875, rFrac: 0.29, strokeFrac: 0.042 },
  // 32px favicon png fallback (transparent)
  { file: 'favicon-32.png', size: 32, bg: null, rFrac: 0.40, strokeFrac: 0.075 },
];

for (const j of jobs) {
  const png = renderOrb(j);
  fs.writeFileSync(path.join(OUT, j.file), png);
  console.log('wrote', j.file, png.length, 'bytes');
}
