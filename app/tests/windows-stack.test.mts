// src/store/windows/stack.ts: what closing, minimizing and raising a window do to the lists. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { closed, minimized, raised, repaired } from '../src/store/windows/stack.ts'

const lists = { active: ['a', 'b'], zIndex: ['a', 'b'], fullScreen: ['b'], minimized: [] as string[] }

test('a window closed while minimized does not come back hidden', () => {
  const away = minimized(lists, 'a')
  assert.deepEqual(closed(away, 'a'), { active: ['b'], zIndex: ['b'], fullScreen: ['b'], minimized: [] })
})

test('minimizing only ever puts a window away', () => {
  const away = minimized(lists, 'b')
  assert.deepEqual(away.zIndex, ['a'])
  assert.deepEqual(away.minimized, ['b'])
  assert.equal(minimized(away, 'b'), away)
  assert.equal(minimized(lists, 'nope'), lists)
})

test('raising brings a minimized window back to the top of the stack', () => {
  const back = raised(minimized(lists, 'a'), 'a')
  assert.deepEqual(back.zIndex, ['b', 'a'])
  assert.deepEqual(back.minimized, [])
})

test('raising a window that is not open changes nothing', () => {
  assert.equal(raised(lists, 'nope'), lists)
})

test('a saved session is put right: no ghost minimized, no showing window left off the stack', () => {
  assert.deepEqual(
    repaired({
      active: ['a', 'b', 'c'],
      zIndex: ['ghost', 'a', 'c'],
      fullScreen: ['ghost'],
      minimized: ['ghost', 'c'],
    }),
    { active: ['a', 'b', 'c'], zIndex: ['a', 'b'], fullScreen: [], minimized: ['c'] },
  )
})
