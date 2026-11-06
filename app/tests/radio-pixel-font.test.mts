// src/pages/Radio/pixelFont.ts: the radio's bitmap lettering and clock digits. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cjkFamily, clockDigits, digitPath, foldText, hasCjk, pixelsToPath, textPath, textWidth } from '../src/pages/Radio/pixelFont.ts'

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

test('CJK is told apart from what the 4x5 font can draw', () => {
  assert.ok(hasCjk('IMDガールズ'))
  assert.ok(hasCjk('金庫のドル'))
  assert.ok(hasCjk('夜晚的电台'))
  assert.ok(hasCjk('밤의 라디오'))
  assert.ok(!hasCjk('Café milady - 3:03'))
})

test('kana picks the Japanese face, everything else the other one', () => {
  assert.equal(cjkFamily('金庫のドル'), 'Fusion Pixel JA')
  assert.equal(cjkFamily('ｶﾀｶﾅ'), 'Fusion Pixel JA')
  assert.equal(cjkFamily('夜晚的电台'), 'Fusion Pixel SC')
  assert.equal(cjkFamily('밤의 라디오'), 'Fusion Pixel SC')
})

test('canvas pixels become rectangles, one per solid run', () => {
  const px = (a: number) => [0, 0, 0, a]
  const rgba = [...px(255), ...px(255), ...px(0), ...px(127), ...px(0), ...px(0), ...px(0), ...px(128)]
  assert.equal(pixelsToPath(rgba, 4, 2), 'M0 0h2v1h-2zM3 1h1v1h-1z')
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
