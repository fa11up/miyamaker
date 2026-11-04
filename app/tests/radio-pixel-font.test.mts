// src/pages/Radio/pixelFont.ts: the radio's bitmap lettering and clock digits. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { clockDigits, digitPath, foldText, textPath, textWidth } from '../src/pages/Radio/pixelFont.ts'

test('text folds to capitals, drops accents, and marks what the font lacks', () => {
  assert.equal(foldText('Café milady'), 'CAFE MILADY')
  assert.equal(foldText('夜 ok'), '? OK')
})

test('width counts cells, and a space draws nothing', () => {
  assert.equal(textWidth('ABC'), 15)
  assert.equal(textPath(' '), '')
  assert.ok(textPath('A').length > 0)
})

test('the second character is drawn one cell along', () => {
  assert.match(textPath(' I'), /^M5 0/)
})

test('every digit draws, and eight lights the most', () => {
  const lengths = Array.from({ length: 10 }, (_, d) => digitPath(d).length)
  assert.ok(lengths.every((n) => n > 0))
  assert.equal(Math.max(...lengths), digitPath(8).length)
})

test('the clock splits minutes and seconds and tops out at 99:59', () => {
  assert.deepEqual(clockDigits(0), [0, 0, 0, 0])
  assert.deepEqual(clockDigits(754), [1, 2, 3, 4])
  assert.deepEqual(clockDigits(5999), [9, 9, 5, 9])
  assert.deepEqual(clockDigits(7000), [9, 9, 5, 9])
  assert.deepEqual(clockDigits(Number.NaN), [0, 0, 0, 0])
})
