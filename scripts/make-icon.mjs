// Generates build/icon.ico (multi-size, BMP-embedded) and build/icon-256.png
// from the app logo (src/renderer/src/assets/logo.png). Pure Node - no image
// dependencies. Decodes the RGBA PNG, area-average resamples it to each icon
// size with premultiplied alpha, and packs rcedit-safe uncompressed BMP
// entries into the ICO container.
import { deflateSync, inflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'src', 'renderer', 'src', 'assets', 'logo.png')

// ---- PNG decoder (8-bit truecolor +/- alpha, non-interlaced) ------------------
function decodePng(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('not a PNG file')
  let pos = 8
  let width = 0
  let height = 0
  let colorType = -1
  let interlace = -1
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8) throw new Error(`unsupported bit depth ${data[8]} (need 8)`)
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported color type ${colorType} (need RGB/RGBA)`)
  if (interlace !== 0) throw new Error('interlaced PNG not supported')

  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = new Uint8Array(width * height * 4)
  const prev = new Uint8Array(stride)
  const line = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let i = 0; i < stride; i++) line[i] = raw[y * (stride + 1) + 1 + i]
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? line[i - bpp] : 0
      const up = prev[i]
      const ul = i >= bpp ? prev[i - bpp] : 0
      switch (filter) {
        case 0: break
        case 1: line[i] = (line[i] + left) & 0xff; break
        case 2: line[i] = (line[i] + up) & 0xff; break
        case 3: line[i] = (line[i] + ((left + up) >> 1)) & 0xff; break
        case 4: {
          const p = left + up - ul
          const pa = Math.abs(p - left)
          const pb = Math.abs(p - up)
          const pc = Math.abs(p - ul)
          line[i] = (line[i] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)) & 0xff
          break
        }
        default: throw new Error(`bad PNG filter ${filter}`)
      }
    }
    for (let x = 0; x < width; x++) {
      const s = x * bpp
      const d = (y * width + x) * 4
      out[d] = line[s]
      out[d + 1] = line[s + 1]
      out[d + 2] = line[s + 2]
      out[d + 3] = bpp === 4 ? line[s + 3] : 255
    }
    prev.set(line)
  }
  return { width, height, rgba: out }
}

// ---- area-average resampling (premultiplied alpha) ---------------------------
function resample(src, sw, sh, tw, th) {
  if (tw === sw && th === sh) return src
  const out = new Uint8Array(tw * th * 4)
  const sx = sw / tw
  const sy = sh / th
  for (let y = 0; y < th; y++) {
    const fy0 = y * sy
    const fy1 = fy0 + sy
    for (let x = 0; x < tw; x++) {
      const fx0 = x * sx
      const fx1 = fx0 + sx
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let area = 0
      const iy0 = Math.floor(fy0)
      const iy1 = Math.min(sh, Math.ceil(fy1))
      const ix0 = Math.floor(fx0)
      const ix1 = Math.min(sw, Math.ceil(fx1))
      for (let yy = iy0; yy < iy1; yy++) {
        const cy = Math.min(fy1, yy + 1) - Math.max(fy0, yy)
        for (let xx = ix0; xx < ix1; xx++) {
          const cx = Math.min(fx1, xx + 1) - Math.max(fx0, xx)
          const wgt = cx * cy
          const i = (yy * sw + xx) * 4
          const al = src[i + 3] / 255
          r += src[i] * al * wgt
          g += src[i + 1] * al * wgt
          b += src[i + 2] * al * wgt
          a += src[i + 3] * wgt
          area += wgt
        }
      }
      const d = (y * tw + x) * 4
      if (a > 0) {
        out[d] = Math.min(255, Math.round(r / (a / 255)))
        out[d + 1] = Math.min(255, Math.round(g / (a / 255)))
        out[d + 2] = Math.min(255, Math.round(b / (a / 255)))
      }
      out[d + 3] = Math.round(a / area)
    }
  }
  return out
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
const { width, height, rgba } = decodePng(readFileSync(SRC))
if (width !== height) throw new Error(`logo must be square, got ${width}x${height}`)
const rendered = new Map()
for (const s of SIZES) rendered.set(s, resample(rgba, width, height, s, s))

const ico = buildIco(SIZES.map((s) => ({ size: s, data: bmpEntry(rendered.get(s), s) })))
mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.ico'), ico)
writeFileSync(join(root, 'build', 'icon-256.png'), encodePng(rendered.get(256), 256))
writeFileSync(join(root, 'build', 'icon-32.png'), encodePng(rendered.get(32), 32))
console.log(`icon.ico (${(ico.length / 1024).toFixed(0)} KB, sizes: ${SIZES.join(',')}), icon-256.png, icon-32.png written to build/ from ${SRC.slice(root.length + 1)}`)
