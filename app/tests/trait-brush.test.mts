import assert from 'node:assert/strict'
import test from 'node:test'

import { blankPixels, brushRadius, DEFAULT_BRUSH, paintDab, smudgeDab, type Brush, type Dab, type Pixels } from '../src/pages/MiyaMakerStudio/brush.ts'

const red: [number, number, number, number] = [255, 0, 0, 255]

const brush = (patch: Partial<Brush>): Brush => ({ ...DEFAULT_BRUSH, ...patch })

function alphas(pixels: Pixels): number[] {
  const out: number[] = []
  for (let i = 3; i < pixels.data.length; i += 4) out.push(pixels.data[i] ?? 0)
  return out
}

function inkCount(pixels: Pixels): number {
  return alphas(pixels).filter((alpha) => alpha === 255).length
}

function painted(pixels: Pixels): number {
  return alphas(pixels).filter((alpha) => alpha > 0).length
}

test('a hard pixel dab is only ink or empty', () => {
  const pixels = blankPixels(16, 16)
  paintDab(pixels, 8, 8, brush({ size: 4, softness: 0, pixel: true, spray: 0, noise: 0 }), {
    pen: false,
    pressure: 0.5,
    stroke: 1,
    dab: 0,
    color: red,
    erase: false,
  })
  const values = alphas(pixels)
  assert.ok(values.every((alpha) => alpha === 0 || alpha === 255))
  assert.ok(inkCount(pixels) > 0)
  assert.equal(pixels.data[(8 * 16 + 8) * 4], 255)
})

test('softness in pixel mode dithers the rim instead of blurring it', () => {
  const soft = brush({ size: 14, softness: 1, pixel: false, spray: 0, noise: 0 })
  const pixel = brush({ size: 14, softness: 1, pixel: true, spray: 0, noise: 0 })
  const blurred = blankPixels(24, 24)
  const hard = blankPixels(24, 24)
  const dab = { pen: false, pressure: 1, stroke: 3, dab: 1, color: red, erase: false as const }
  paintDab(blurred, 12, 12, soft, dab)
  paintDab(hard, 12, 12, pixel, dab)
  assert.ok(alphas(blurred).some((alpha) => alpha > 0 && alpha < 255), 'a smooth brush leaves partial pixels')
  assert.ok(alphas(hard).every((alpha) => alpha === 0 || alpha === 255), 'a pixel brush does not')
  assert.ok(inkCount(hard) > 0)
  assert.ok(alphas(hard).some((alpha) => alpha === 0))
})

test('spray with the same stroke lands on the same pixels', () => {
  const spray = brush({ size: 3, spray: 1, scatter: 8, noise: 0.5, softness: 0, pixel: true })
  const dab = { pen: false, pressure: 1, stroke: 9, dab: 2, color: red, erase: false as const }
  const a = blankPixels(32, 32)
  const b = blankPixels(32, 32)
  paintDab(a, 16, 16, spray, dab)
  paintDab(b, 16, 16, spray, dab)
  assert.deepEqual(a.data, b.data)
  const once = blankPixels(32, 32)
  paintDab(once, 16, 16, brush({ size: 3, spray: 0, noise: 0 }), dab)
  assert.ok(painted(a) > painted(once))
})

test('pressure changes a pen and leaves a mouse at the knob size', () => {
  assert.equal(brushRadius(brush({ size: 10, minSize: 1, pressureSize: true }), 0, false), 5)
  assert.equal(brushRadius(brush({ size: 10, minSize: 1, pressureSize: true }), 0, true), 0.5)
  assert.equal(brushRadius(brush({ size: 10, minSize: 1, pressureSize: true }), 1, true), 5)
  const full = blankPixels(20, 20)
  const light = blankPixels(20, 20)
  const settings = brush({ size: 10, minSize: 1, pressureSize: true, softness: 0, pixel: true })
  const at = { stroke: 1, dab: 0, color: red, erase: false as const }
  paintDab(full, 10, 10, settings, { ...at, pen: false, pressure: 0 })
  paintDab(light, 10, 10, settings, { ...at, pen: true, pressure: 0.05 })
  assert.ok(inkCount(full) > inkCount(light))
})

test('a light pen sprays fewer dots than a full pen, and a mouse keeps the spray', () => {
  const settings = brush({
    size: 2,
    spray: 1,
    scatter: 12,
    noise: 0,
    softness: 0,
    pixel: true,
    pressureSize: false,
    pressureOpacity: false,
  })
  const dab = { stroke: 4, dab: 1, color: red, erase: false as const }
  const full = blankPixels(48, 48)
  const light = blankPixels(48, 48)
  const mouse = blankPixels(48, 48)
  paintDab(full, 24, 24, settings, { ...dab, pen: true, pressure: 1 })
  paintDab(light, 24, 24, settings, { ...dab, pen: true, pressure: 0.05 })
  paintDab(mouse, 24, 24, settings, { ...dab, pen: false, pressure: 0 })
  assert.ok(painted(full) > painted(light))
  assert.deepEqual(mouse.data, full.data)
})

function fillRed(pixels: Pixels, x0: number, x1: number, y: number) {
  for (let x = x0; x <= x1; x += 1) {
    const index = (y * pixels.width + x) * 4
    pixels.data[index] = 255
    pixels.data[index + 3] = 255
  }
}

function channel(pixels: Pixels, x: number, y: number, offset: number): number {
  return pixels.data[(y * pixels.width + x) * 4 + offset] ?? 0
}

const smear: Dab = { pen: false, pressure: 0, stroke: 1, dab: 0, color: [0, 0, 255, 255], erase: false }

test('smudge drags existing ink and ignores the brush colour', () => {
  const walk = (pen: boolean, pressure: number) => {
    const pixels = blankPixels(24, 12)
    fillRed(pixels, 0, 8, 5)
    const settings = brush({ size: 4, opacity: 1, softness: 0, pixel: true, pressureSize: false })
    for (let x = 4; x < 16; x += 1) {
      smudgeDab(pixels, x, 5, x + 1, 5, settings, { ...smear, pen, pressure })
    }
    return pixels
  }
  const mouse = walk(false, 0)
  const full = walk(true, 1)
  const light = walk(true, 0.1)
  assert.equal(channel(mouse, 14, 5, 0), 255)
  assert.equal(channel(mouse, 14, 5, 2), 0)
  assert.equal(channel(mouse, 14, 5, 3), 255)
  assert.deepEqual(full.data, mouse.data)
  assert.equal(channel(light, 14, 5, 3), 0)
  assert.equal(channel(light, 4, 5, 0), 255)
})

test('the eraser clears coverage and does not leave a colour', () => {
  const pixels = blankPixels(12, 12)
  const settings = brush({ size: 6, softness: 0, pixel: true, spray: 0, noise: 0 })
  paintDab(pixels, 6, 6, settings, { pen: false, pressure: 1, stroke: 1, dab: 0, color: red, erase: false })
  paintDab(pixels, 6, 6, settings, { pen: false, pressure: 1, stroke: 2, dab: 0, color: red, erase: true })
  assert.equal(pixels.data[(6 * 12 + 6) * 4 + 3], 0)
})
