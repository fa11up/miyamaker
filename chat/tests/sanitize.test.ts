import { describe, expect, it } from 'vitest'

import { sanitizeText } from '../src/sanitize'

// Built from code points so the test source holds no invisible characters.
const c = (...cps: number[]) => String.fromCodePoint(...cps)

describe('sanitizeText', () => {
  it('keeps ordinary text and trims', () => {
    expect(sanitizeText('  gm miya  ')).toEqual({ ok: true, text: 'gm miya' })
  })

  it('turns newlines/tabs into single spaces', () => {
    expect(sanitizeText(`a${c(10)}b${c(13, 10, 9)}c${c(0x2028)}d`)).toEqual({ ok: true, text: 'a b c d' })
  })

  it('strips C0/C1 controls, bidi overrides and zero-width chars', () => {
    const evil = `he${c(0)}l${c(7)}l${c(0x1b)}o${c(0x85)} ${c(0x202e)}cba${c(0x202c)}${c(0x2066)}x${c(0x2069)}${c(0x200b)}y${c(0xfeff)}z${c(0x90)}${c(0x61c)}${c(0xad)}`
    expect(sanitizeText(evil)).toEqual({ ok: true, text: 'hello cbaxyz' })
  })

  it('leaves HTML as literal text (rendering is text-only on the client)', () => {
    expect(sanitizeText('<img src=x onerror=alert(1)>')).toEqual({ ok: true, text: '<img src=x onerror=alert(1)>' })
  })

  it('rejects empty and whitespace/control-only input', () => {
    expect(sanitizeText('')).toEqual({ ok: false, code: 'empty' })
    expect(sanitizeText(` ${c(10, 0x200b, 0)} `)).toEqual({ ok: false, code: 'empty' })
    expect(sanitizeText(42)).toEqual({ ok: false, code: 'empty' })
    expect(sanitizeText(undefined)).toEqual({ ok: false, code: 'empty' })
  })

  it('allows exactly 280 code points and rejects 281', () => {
    expect(sanitizeText('a'.repeat(280))).toMatchObject({ ok: true })
    expect(sanitizeText('a'.repeat(281))).toEqual({ ok: false, code: 'length' })
  })

  it('counts astral emoji as one character each', () => {
    const heart = c(0x1f5a4)
    const emoji = heart.repeat(280) // 560 UTF-16 units
    expect(sanitizeText(emoji)).toMatchObject({ ok: true })
    expect(sanitizeText(emoji + heart)).toEqual({ ok: false, code: 'length' })
  })
})
