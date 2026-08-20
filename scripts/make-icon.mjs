// Generates build/icon.ico (multi-size, BMP-embedded) and build/icon-256.png.
// Pure Node - no image dependencies. Draws a shield with a "K" monogram
// using signed-distance functions with 4x supersampling.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---- drawing --------------------------------------------------------------
// All in normalized 0..1 coordinates, y down.

function shieldHalfWidth(x, y) {
  const top = 0.09
  const r = 0.1
  const w = 0.4
  const taperStart = 0.5
  const bottom = 0.93
  if (y < top || y > bottom) return -1
  if (y < top + r) {
    const dy = top + r - y
    return w - r + Math.sqrt(Math.max(0, r * r - dy * dy))
  }
  if (y <= taperStart) return w
  const t = (y - taperStart) / (bottom - taperStart)
  return w * Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.8)))
}

function shieldSdf(x, y) {
  const hw = shieldHalfWidth(x, y)
  if (hw < 0) return 1
  return Math.max(Math.abs(x - 0.5) - hw, 0)
}

function segDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax
  const aby = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)))
  const dx = px - (ax + t * abx)
  const dy = py - (ay + t * aby)
  return Math.hypot(dx, dy)
}

// "K" strokes: vertical stem + two diagonals, all with the same thickness.
const STROKE = 0.045
function kSdf(x, y) {
  const stem = segDist(x, y, 0.395, 0.27, 0.395, 0.75)
  const up = segDist(x, y, 0.42, 0.515, 0.655, 0.245)
  const down = segDist(x, y, 0.44, 0.53, 0.675, 0.79)
  return Math.min(stem, up, down) - STROKE
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]
}

const TOP = [96, 165, 250] // light blue
const BOTTOM = [29, 78, 216] // deep blue
const EDGE = [23, 47, 132] // dark border
const WHITE = [255, 255, 255]

function shade(px, py) {
  // px,py in 0..1. Returns [r,g,b,a] (a: 0..255)
  const inside = shieldSdf(px, py)
  const aa = 1.5 / 256
  if (inside > aa * 3) return [0, 0, 0, 0]
  let r, g, b, a
  if (inside <= 0) {
    let col = mix(TOP, BOTTOM, Math.min(1, (py - 0.06) / 0.9))
    if (inside > -0.022) col = mix(col, EDGE, 1 + inside / 0.022) // darker rim
    const k = kSdf(px, py)
    if (k < 0) col = mix(col, WHITE, 0.96)
    else if (k < 0.016) col = mix(col, WHITE, 0.35 * (1 - k / 0.016)) // soft glow edge
    r = col[0]
    g = col[1]
    b = col[2]
    a = 255
  } else {
    a = 0
    r = g = b = 0
  }
  return [r, g, b, a]
}

function renderRgba(size) {
  const buf = new Uint8Array(size * size * 4)
  const ss = 2 // 2x2 supersamples per pixel
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

// ---- PNG encoder ----------------------------------------------------------
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
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // filter 0 per scanline
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

// ---- ICO container (uncompressed BMP entries - rcedit-safe) ----------------
function bmpEntry(rgba, size) {
  const rowMask = ((size + 31) >> 5) * 4
  const maskSize = rowMask * size
  const pixelsSize = size * size * 4
  const out = Buffer.alloc(40 + pixelsSize + maskSize)
  out.writeUInt32LE(40, 0) // biSize
  out.writeInt32LE(size, 4)
  out.writeInt32LE(size * 2, 8) // XOR + AND
  out.writeUInt16LE(1, 12) // planes
  out.writeUInt16LE(32, 14) // bpp
  out.writeUInt32LE(pixelsSize + maskSize, 20)
  // rows bottom-up, BGRA
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
  // AND mask all zero (alpha channel drives transparency)
  return out
}

function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // icon
  header.writeUInt16LE(entries.length, 4)
  const dirEntrySize = 16
  let offset = 6 + dirEntrySize * entries.length
  const dir = Buffer.alloc(dirEntrySize * entries.length)
  entries.forEach((e, i) => {
    const base = i * dirEntrySize
    dir.writeUInt8(e.size === 256 ? 0 : e.size, base)
    dir.writeUInt8(e.size === 256 ? 0 : e.size, base + 1)
    dir.writeUInt8(0, base + 2) // colors
    dir.writeUInt8(0, base + 3)
    dir.writeUInt16LE(1, base + 4) // planes
    dir.writeUInt16LE(32, base + 6) // bpp
    dir.writeUInt32LE(e.data.length, base + 8)
    dir.writeUInt32LE(offset, base + 12)
    offset += e.data.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.data)])
}

// ---- main -------------------------------------------------------------------
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const rendered = new Map()
for (const s of SIZES) rendered.set(s, renderRgba(s))

const ico = buildIco(SIZES.map((s) => ({ size: s, data: bmpEntry(rendered.get(s), s) })))
mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.ico'), ico)
writeFileSync(join(root, 'build', 'icon-256.png'), encodePng(rendered.get(256), 256))
writeFileSync(join(root, 'build', 'icon-32.png'), encodePng(rendered.get(32), 32))
console.log(`icon.ico (${(ico.length / 1024).toFixed(0)} KB, sizes: ${SIZES.join(',')}), icon-256.png, icon-32.png written to build/`)
