// Generates build/icon.ico (multi-size, BMP-embedded) and build/icon-256.png.
// Pure Node - no image dependencies. Draws a rounded-square tile with a
// vertical indigo->violet gradient and a bold white "K" monogram, using
// signed-distance functions with 2x2 supersampling.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---- drawing (normalized 0..1 coordinates, y down) -------------------------
function roundedRectSdf(x, y) {
  // tile occupies [0.06, 0.94] with corner radius 0.16
  const cx = 0.5
  const cy = 0.5
  const half = 0.44
  const r = 0.16
  const qx = Math.abs(x - cx) - (half - r)
  const qy = Math.abs(y - cy) - (half - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

function segDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax
  const aby = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)))
  const dx = px - (ax + t * abx)
  const dy = py - (ay + t * aby)
  return Math.hypot(dx, dy)
}

// bold "K" strokes
const STROKE = 0.052
function kSdf(x, y) {
  const stem = segDist(x, y, 0.375, 0.245, 0.375, 0.755)
  const up = segDist(x, y, 0.43, 0.52, 0.66, 0.225)
  const down = segDist(x, y, 0.445, 0.545, 0.675, 0.78)
  return Math.min(stem, up, down) - STROKE
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

const TOP = [99, 102, 241] // indigo #6366F1
const BOTTOM = [124, 58, 237] // violet #7C3AED
const WHITE = [255, 255, 255]

function shade(px, py) {
  const aa = 1.5 / 256
  const d = roundedRectSdf(px, py)
  if (d > aa * 3) return [0, 0, 0, 0]
  if (d <= 0) {
    let col = [lerp(TOP[0], BOTTOM[0], Math.min(1, (py - 0.06) / 0.88)), lerp(TOP[1], BOTTOM[1], Math.min(1, (py - 0.06) / 0.88)), lerp(TOP[2], BOTTOM[2], Math.min(1, (py - 0.06) / 0.88))]
    // subtle lighter rim for polish
    if (d > -0.018) col = col.map((c) => lerp(c, 255, 0.18))
    const k = kSdf(px, py)
    if (k < 0) col = WHITE
    return [Math.round(col[0]), Math.round(col[1]), Math.round(col[2]), 255]
  }
  return [0, 0, 0, 0]
}

function renderRgba(size) {
  const buf = new Uint8Array(size * size * 4)
  const ss = 2
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (px + (sx + 0.5) / ss) / size
          const v = (py + (sy + 0.5) / ss) / size
          const c = shade(u, v)
          r += c[0] * c[3]
          g += c[1] * c[3]
          b += c[2] * c[3]
          a += c[3]
        }
      }
      const n = ss * ss
      const i = (py * size + px) * 4
      if (a > 0) {
        buf[i] = Math.round(r / a)
        buf[i + 1] = Math.round(g / a)
        buf[i + 2] = Math.round(b / a)
        buf[i + 3] = Math.round(a / n)
      }
    }
  }
  return buf
}

// ---- PNG encoder -----------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length)
  return out
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ---- ICO container (uncompressed BMP entries - rcedit-safe) -----------------
function bmpEntry(rgba, size) {
  const rowMask = ((size + 31) >> 5) * 4
  const maskSize = rowMask * size
  const pixelsSize = size * size * 4
  const out = Buffer.alloc(40 + pixelsSize + maskSize)
  out.writeUInt32LE(40, 0)
  out.writeInt32LE(size, 4)
  out.writeInt32LE(size * 2, 8)
  out.writeUInt16LE(1, 12)
  out.writeUInt16LE(32, 14)
  out.writeUInt32LE(pixelsSize + maskSize, 20)
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y
    for (let x = 0; x < size; x++) {
      const src = (srcY * size + x) * 4
      const dst = 40 + (y * size + x) * 4
      out[dst] = rgba[src + 2]
      out[dst + 1] = rgba[src + 1]
      out[dst + 2] = rgba[src]
      out[dst + 3] = rgba[src + 3]
    }
  }
  return out
}

function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const dirEntrySize = 16
  let offset = 6 + dirEntrySize * entries.length
  const dir = Buffer.alloc(dirEntrySize * entries.length)
  entries.forEach((e, i) => {
    const base = i * dirEntrySize
    dir.writeUInt8(e.size === 256 ? 0 : e.size, base)
    dir.writeUInt8(e.size === 256 ? 0 : e.size, base + 1)
    dir.writeUInt8(0, base + 2)
    dir.writeUInt8(0, base + 3)
    dir.writeUInt16LE(1, base + 4)
    dir.writeUInt16LE(32, base + 6)
    dir.writeUInt32LE(e.data.length, base + 8)
    dir.writeUInt32LE(offset, base + 12)
    offset += e.data.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.data)])
}

// ---- main --------------------------------------------------------------------
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const rendered = new Map()
for (const s of SIZES) rendered.set(s, renderRgba(s))

const ico = buildIco(SIZES.map((s) => ({ size: s, data: bmpEntry(rendered.get(s), s) })))
mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.ico'), ico)
writeFileSync(join(root, 'build', 'icon-256.png'), encodePng(rendered.get(256), 256))
writeFileSync(join(root, 'build', 'icon-32.png'), encodePng(rendered.get(32), 32))
console.log(`icon.ico (${(ico.length / 1024).toFixed(0)} KB, sizes: ${SIZES.join(',')}), icon-256.png, icon-32.png written to build/`)
