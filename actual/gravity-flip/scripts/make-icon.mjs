/**
 * 生成应用图标源图（1024×1024）。
 *
 * 产出的 icon-source.png 交给 `npx tauri icon` 去切全套尺寸，
 * 那个命令会生成 .ico / .icns / 各种 Square*Logo.png。
 *
 * 为什么不用 sharp 之类的库：这个脚本只干两件事——从 Kenney 的角色表里
 * 抠出一个 24×24 的小人，把它放大贴到一张底色图上。为此装一个几十 MB
 * 的原生二进制依赖不值得，手写 PNG 编解码就够了。
 *
 * 用法：node scripts/make-icon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- PNG 解码

/**
 * 只支持调色板型（色彩类型 3）+ 8 位 + 无交错。
 *
 * Kenney 的图集正好就是这个规格。真正通用的解码器要处理灰度、真彩、
 * 16 位、隔行扫描等一堆分支，这里用不上，不写。
 */
function decodeIndexedPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG 文件');

  let width = 0, height = 0, palette = null, trns = null;
  const idat = [];
  let p = 8;

  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.subarray(p + 4, p + 8).toString('latin1');
    const data = buf.subarray(p + 8, p + 8 + len);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 3 || data[12] !== 0) {
        throw new Error(`不支持的 PNG：位深${data[8]} 色彩类型${data[9]} 交错${data[12]}`);
      }
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;

    p += 12 + len;
  }
  if (!palette) throw new Error('缺少 PLTE');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width; // 每像素 1 字节的调色板索引
  const out = Buffer.alloc(height * stride);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;

    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      // 左侧、上方、左上三个参考字节，PNG 的五种 filter 都由它们算预测值
      const a = x >= 1 ? cur[x - 1] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= 1 ? prev[x - 1] : 0;
      let v = line[x];

      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pred) & 0xff;
          break;
        }
        default: throw new Error(`未知的行过滤器 ${filter}`);
      }
      cur[x] = v;
    }
  }

  return { width, height, indices: out, palette, trns };
}

// ---------------------------------------------------------------- PNG 编码

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng(width, height, rgba) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };

  // 每行开头补一个 filter 字节（0 = 不过滤），换来解码端最省事
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 色彩类型 6 = RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 画布

const SIZE = 1024;
const canvas = Buffer.alloc(SIZE * SIZE * 4); // RGBA，初始全透明

function put(x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  if (a === 255) {
    canvas[i] = r; canvas[i + 1] = g; canvas[i + 2] = b; canvas[i + 3] = 255;
    return;
  }
  // 源覆盖：按 alpha 混合到已有像素上
  const sa = a / 255;
  canvas[i] = Math.round(r * sa + canvas[i] * (1 - sa));
  canvas[i + 1] = Math.round(g * sa + canvas[i + 1] * (1 - sa));
  canvas[i + 2] = Math.round(b * sa + canvas[i + 2] * (1 - sa));
  canvas[i + 3] = Math.max(canvas[i + 3], a);
}

function rect(x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, color);
}

// ---------------------------------------------------------------- 构图

// 背景：中心偏上的径向光晕，边缘压暗。纯色底在图标里会显得很平
const GLOW_X = SIZE / 2;
const GLOW_Y = SIZE * 0.42;
const INNER = [38, 38, 68];   // #262644
const OUTER = [16, 16, 32];   // #101020
const maxDist = Math.hypot(GLOW_X, GLOW_Y);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const t = Math.min(1, Math.hypot(x - GLOW_X, y - GLOW_Y) / maxDist);
    const e = t * t; // 平方一下，让亮区收得更紧
    const color = INNER.map((v, i) => Math.round(v + (OUTER[i] - v) * e));
    put(x, y, color);
  }
}

// 读出角色表里玩家那一帧：第 0 行第 2 列（与 config.ts 的 PLAYER_IDLE 一致）
const CHARS = decodeIndexedPng(fs.readFileSync(path.join(ROOT, 'public/assets/chars.png')));
const CHAR_PX = 24;
const FRAME_COL = 2;
const FRAME_ROW = 0;

// 上下各一条草地。上面那条是倒挂的——草朝下长，
// 一眼就能看出「头顶那片天也是能站的」，正好是这个游戏的核心机制
const CEIL_H = 140;
const FLOOR_H = 132;
const SOIL = [58, 42, 30, 255];
const GRASS = [90, 158, 58, 255];

rect(0, 0, SIZE, CEIL_H - 44, SOIL);
rect(0, CEIL_H - 44, SIZE, 44, GRASS);

rect(0, SIZE - FLOOR_H, SIZE, 36, GRASS);
rect(0, SIZE - FLOOR_H + 36, SIZE, FLOOR_H - 36, SOIL);

function sampleChar(sx, sy) {
  const srcX = FRAME_COL * CHAR_PX + sx;
  const srcY = FRAME_ROW * CHAR_PX + sy;
  const idx = CHARS.indices[srcY * CHARS.width + srcX];
  // tRNS 逐条给调色板条目定 alpha；没列到的条目一律不透明
  const alpha = CHARS.trns && idx < CHARS.trns.length ? CHARS.trns[idx] : 255;
  return [
    CHARS.palette[idx * 3],
    CHARS.palette[idx * 3 + 1],
    CHARS.palette[idx * 3 + 2],
    alpha,
  ];
}

const SCALE = 25;
const charW = CHAR_PX * SCALE;
const charX = Math.round((SIZE - charW) / 2);
const charY = SIZE - FLOOR_H - charW; // 脚正好落在地面顶边

// 角色本体：最近邻放大，每个源像素画成一个 SCALE×SCALE 的方块
for (let sy = 0; sy < CHAR_PX; sy++) {
  for (let sx = 0; sx < CHAR_PX; sx++) {
    const color = sampleChar(sx, sy);
    if (color[3] === 0) continue;
    rect(charX + sx * SCALE, charY + sy * SCALE, SCALE, SCALE, color);
  }
}

// ---------------------------------------------------------------- 输出

const outPath = path.join(ROOT, 'src-tauri/icons/icon-source.png');
fs.writeFileSync(outPath, encodePng(SIZE, SIZE, canvas));
console.log('已生成', outPath);
