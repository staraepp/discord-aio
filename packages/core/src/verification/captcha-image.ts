import { randomInt } from 'node:crypto';
import { deflateSync } from 'node:zlib';

/**
 * Picture CAPTCHA: a short random code drawn as warped strokes with noise lines,
 * rendered straight to PNG (Discord embeds can't show SVG). The code only exists
 * as pixels, never as text. Look-alikes (0/O, 1/I/L) are left out and answers
 * are case-insensitive. No native image libraries are needed.
 */

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const CAPTCHA_WIDTH = 264;
export const CAPTCHA_HEIGHT = 84;

type Rand = (max: number) => number;
const cryptoRand: Rand = (max) => randomInt(max);

// Stroke font on a 10 x 14 grid (y grows downwards). Each glyph is a list of polylines.
type Pt = [number, number];
const GLYPHS: Record<string, Pt[][]> = {
  A: [[[0, 14], [5, 0], [10, 14]], [[2, 9], [8, 9]]],
  B: [[[0, 0], [0, 14]], [[0, 0], [7, 0], [9, 2], [9, 5], [7, 7], [0, 7]], [[7, 7], [10, 9], [10, 12], [8, 14], [0, 14]]],
  C: [[[10, 2], [8, 0], [2, 0], [0, 2], [0, 12], [2, 14], [8, 14], [10, 12]]],
  D: [[[0, 0], [0, 14], [6, 14], [10, 10], [10, 4], [6, 0], [0, 0]]],
  E: [[[10, 0], [0, 0], [0, 14], [10, 14]], [[0, 7], [7, 7]]],
  F: [[[10, 0], [0, 0], [0, 14]], [[0, 7], [7, 7]]],
  G: [[[10, 2], [8, 0], [2, 0], [0, 2], [0, 12], [2, 14], [8, 14], [10, 12], [10, 8], [5, 8]]],
  H: [[[0, 0], [0, 14]], [[10, 0], [10, 14]], [[0, 7], [10, 7]]],
  J: [[[10, 0], [10, 11], [7, 14], [3, 14], [0, 11]]],
  K: [[[0, 0], [0, 14]], [[10, 0], [0, 8]], [[3, 6], [10, 14]]],
  M: [[[0, 14], [0, 0], [5, 8], [10, 0], [10, 14]]],
  N: [[[0, 14], [0, 0], [10, 14], [10, 0]]],
  P: [[[0, 14], [0, 0], [8, 0], [10, 2], [10, 5], [8, 7], [0, 7]]],
  Q: [[[2, 0], [8, 0], [10, 2], [10, 12], [8, 14], [2, 14], [0, 12], [0, 2], [2, 0]], [[6, 10], [10, 15]]],
  R: [[[0, 14], [0, 0], [8, 0], [10, 2], [10, 5], [8, 7], [0, 7]], [[4, 7], [10, 14]]],
  S: [[[10, 2], [8, 0], [2, 0], [0, 2], [0, 5], [2, 7], [8, 7], [10, 9], [10, 12], [8, 14], [2, 14], [0, 12]]],
  T: [[[0, 0], [10, 0]], [[5, 0], [5, 14]]],
  U: [[[0, 0], [0, 12], [2, 14], [8, 14], [10, 12], [10, 0]]],
  V: [[[0, 0], [5, 14], [10, 0]]],
  W: [[[0, 0], [2, 14], [5, 6], [8, 14], [10, 0]]],
  X: [[[0, 0], [10, 14]], [[10, 0], [0, 14]]],
  Y: [[[0, 0], [5, 7], [10, 0]], [[5, 7], [5, 14]]],
  Z: [[[0, 0], [10, 0], [0, 14], [10, 14]]],
  '2': [[[0, 3], [2, 0], [8, 0], [10, 3], [10, 5], [0, 14], [10, 14]]],
  '3': [[[0, 1], [2, 0], [8, 0], [10, 2], [10, 5], [8, 7], [4, 7]], [[8, 7], [10, 9], [10, 12], [8, 14], [2, 14], [0, 13]]],
  '4': [[[8, 14], [8, 0], [0, 10], [10, 10]]],
  '5': [[[10, 0], [0, 0], [0, 6], [7, 6], [10, 8], [10, 12], [8, 14], [2, 14], [0, 12]]],
  '6': [[[9, 1], [7, 0], [3, 0], [0, 4], [0, 12], [2, 14], [8, 14], [10, 12], [10, 9], [8, 7], [2, 7], [0, 9]]],
  '7': [[[0, 0], [10, 0], [4, 14]]],
  '8': [[[5, 7], [2, 7], [0, 5], [0, 2], [2, 0], [8, 0], [10, 2], [10, 5], [8, 7], [2, 7], [0, 9], [0, 12], [2, 14], [8, 14], [10, 12], [10, 9], [8, 7], [5, 7]]],
  '9': [[[10, 5], [8, 7], [2, 7], [0, 5], [0, 2], [2, 0], [8, 0], [10, 2], [10, 10], [7, 14], [3, 14], [1, 13]]],
};

type Rgb = [number, number, number];
const BACKGROUND: Rgb = [0x1c, 0x20, 0x2b];
const INK: Rgb[] = [
  [0xe8, 0xeb, 0xf5],
  [0xc9, 0xd0, 0xff],
  [0xff, 0xd6, 0xa8],
  [0xb8, 0xf0, 0xd4],
  [0xf5, 0xc2, 0xe7],
];

interface Line {
  points: Pt[];
  width: number;
  color: Rgb;
  alpha: number;
}
interface Dot {
  at: Pt;
  r: number;
  color: Rgb;
  alpha: number;
}

export function generateCode(rand: Rand = cryptoRand, length = CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[rand(CODE_ALPHABET.length)];
  return code;
}

/** Normalised form of a typed code: case-insensitive, spaces and punctuation ignored. */
export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Uniform float in [min, max) from the integer source. */
const between = (rand: Rand, min: number, max: number) => min + (rand(10_000) / 10_000) * (max - min);

function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, steps = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0], u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]]);
  }
  return out;
}

/** Subdivide long segments so the wave warp bends them instead of only moving their ends. */
function densify(points: Pt[], maxLen = 3): Pt[] {
  const out: Pt[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / maxLen));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/** Builds the picture as simple shapes in a 264 x 84 space. */
function buildScene(code: string, rand: Rand): { lines: Line[]; dots: Dot[] } {
  const W = CAPTCHA_WIDTH;
  const H = CAPTCHA_HEIGHT;
  const ink = () => INK[rand(INK.length)]!;
  const lines: Line[] = [];
  const dots: Dot[] = [];

  // Faint curves behind the text.
  for (let i = 0; i < 4; i++) {
    lines.push({
      points: bezier([between(rand, -10, 20), between(rand, 10, 74)], [between(rand, 40, 110), between(rand, -20, 104)], [between(rand, 150, 230), between(rand, -20, 104)], [between(rand, 240, 275), between(rand, 10, 74)]),
      width: between(rand, 1, 2),
      color: ink(),
      alpha: 0.35,
    });
  }

  // Glyphs, each with its own scale, rotation, skew, offset and point jitter.
  const step = (W - 36) / code.length;
  [...code].forEach((ch, i) => {
    const strokes = GLYPHS[ch];
    if (!strokes) return;
    const sx = between(rand, 2.1, 2.7);
    const sy = between(rand, 3.3, 3.9);
    const cx = 18 + step * i + step / 2 + between(rand, -3, 3);
    const cy = H / 2 + between(rand, -6, 6);
    const rot = (between(rand, -18, 18) * Math.PI) / 180;
    const skew = Math.tan((between(rand, -10, 10) * Math.PI) / 180);
    const color = ink();
    const width = between(rand, 2.6, 3.6);
    for (const stroke of strokes) {
      const pts = stroke.map(([gx, gy]): Pt => {
        let x = (gx - 5 + between(rand, -0.7, 0.7)) * sx;
        const y = (gy - 7 + between(rand, -0.7, 0.7)) * sy;
        x += y * skew;
        return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)];
      });
      lines.push({ points: densify(pts), width, color, alpha: 1 });
    }
  });

  // Lines that cross the characters, plus speckles.
  for (let i = 0; i < 3; i++) {
    const y0 = between(rand, 20, 64);
    const y1 = between(rand, 20, 64);
    lines.push({ points: bezier([0, y0], [between(rand, 50, 120), between(rand, 0, 84)], [between(rand, 140, 220), between(rand, 0, 84)], [W, y1]), width: between(rand, 1.2, 2.2), color: ink(), alpha: 0.8 });
  }
  for (let i = 0; i < 40; i++) dots.push({ at: [between(rand, 0, W), between(rand, 0, H)], r: between(rand, 0.6, 1.6), color: ink(), alpha: 0.7 });

  // Gentle wave warp applied to every shape.
  const ax = between(rand, 2, 4);
  const ay = between(rand, 2, 4);
  const fx = between(rand, 0.05, 0.09);
  const fy = between(rand, 0.03, 0.06);
  const px = between(rand, 0, Math.PI * 2);
  const py = between(rand, 0, Math.PI * 2);
  const warp = ([x, y]: Pt): Pt => [x + ax * Math.sin(y * fx + px), y + ay * Math.sin(x * fy + py)];
  for (const l of lines) l.points = l.points.map(warp);
  for (const d of dots) d.at = warp(d.at);
  return { lines, dots };
}

// ── Rasteriser: anti-aliased thick lines and dots into an RGB buffer ──

function blend(buf: Float32Array, w: number, x: number, y: number, c: Rgb, a: number) {
  const i = (y * w + x) * 3;
  buf[i] = buf[i]! + (c[0] - buf[i]!) * a;
  buf[i + 1] = buf[i + 1]! + (c[1] - buf[i + 1]!) * a;
  buf[i + 2] = buf[i + 2]! + (c[2] - buf[i + 2]!) * a;
}

function drawSegment(buf: Float32Array, w: number, h: number, a: Pt, b: Pt, half: number, c: Rgb, alpha: number) {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0]) - half - 1));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0]) + half + 1));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1]) - half - 1));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1]) + half + 1));
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
      const d = Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
      const cover = Math.max(0, Math.min(1, half - d + 0.5));
      if (cover > 0) blend(buf, w, x, y, c, cover * alpha);
    }
  }
}

function rasterise(scene: { lines: Line[]; dots: Dot[] }, scale: number): { width: number; height: number; rgb: Uint8Array } {
  const w = CAPTCHA_WIDTH * scale;
  const h = CAPTCHA_HEIGHT * scale;
  const buf = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) buf.set(BACKGROUND, i * 3);
  const s = (p: Pt): Pt => [p[0] * scale, p[1] * scale];
  for (const l of scene.lines) {
    // Opaque strokes are drawn as segments; overlap at joints is invisible at alpha 1.
    for (let i = 1; i < l.points.length; i++) drawSegment(buf, w, h, s(l.points[i - 1]!), s(l.points[i]!), (l.width * scale) / 2, l.color, l.alpha);
  }
  for (const d of scene.dots) drawSegment(buf, w, h, s(d.at), s(d.at), d.r * scale, d.color, d.alpha);
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(buf[i]!);
  return { width: w, height: h, rgb };
}

// ── Minimal PNG encoder (RGB, 8-bit, no filtering) ──

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
}

/** PNG of the code. Scale 2 (528 x 168) stays crisp in Discord and on high-density screens. */
export function renderCaptchaPng(code: string, rand: Rand = cryptoRand, scale = 2): Buffer {
  const { width, height, rgb } = rasterise(buildScene(code, rand), scale);
  return encodePng(width, height, rgb);
}

export function pngDataUri(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}
