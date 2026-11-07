import assert from 'node:assert/strict'
import test from 'node:test'

import { encodeQR } from 'qr'

// RainbowKit's QR code asks for no border. Newer versions of qr refuse that, and the throw takes down the whole OS for anyone
// with no browser wallet, so package.json pins it.
test('the wallet dialog can draw its QR code', () => {
  const grid = encodeQR('wc:abc@2?relay-protocol=irn&symKey=123', 'raw', { border: 0, ecc: 'medium', scale: 1 })
  assert.equal(grid.length, grid[0]!.length)
  assert.equal(grid[0]![0], true)
})
