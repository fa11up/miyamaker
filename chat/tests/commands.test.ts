import { describe, expect, it } from 'vitest'

import { parseCommand } from '../src/commands'

const ADDR = '0xAbCdEf0123456789abcdef0123456789ABCDEF01'

describe('parseCommand', () => {
  it('ignores non-commands', () => {
    expect(parseCommand('hello /del x')).toBeNull()
  })
  it('/del', () => {
    expect(parseCommand('/del abc123')).toEqual({ cmd: 'del', id: 'abc123' })
    expect(parseCommand('/delete abc-123')).toEqual({ cmd: 'del', id: 'abc-123' })
    expect(parseCommand('/del')).toMatchObject({ cmd: 'invalid' })
    expect(parseCommand('/del <script>')).toMatchObject({ cmd: 'invalid' })
  })
  it('/timeout with default and explicit seconds, lowercases address', () => {
    expect(parseCommand(`/timeout ${ADDR}`)).toEqual({ cmd: 'timeout', address: ADDR.toLowerCase(), seconds: 600 })
    expect(parseCommand(`/timeout ${ADDR} 30`)).toEqual({ cmd: 'timeout', address: ADDR.toLowerCase(), seconds: 30 })
    expect(parseCommand(`/timeout ${ADDR} 0`)).toEqual({ cmd: 'untimeout', address: ADDR.toLowerCase() })
    expect(parseCommand(`/timeout ${ADDR} 9999999`)).toMatchObject({ seconds: 7 * 24 * 3600 })
    expect(parseCommand('/timeout 0x123')).toMatchObject({ cmd: 'invalid' })
    expect(parseCommand(`/timeout ${ADDR} -5`)).toMatchObject({ cmd: 'invalid' })
  })
  it('/untimeout', () => {
    expect(parseCommand(`/untimeout ${ADDR}`)).toEqual({ cmd: 'untimeout', address: ADDR.toLowerCase() })
  })
  it('/slow', () => {
    expect(parseCommand('/slow 10')).toEqual({ cmd: 'slow', seconds: 10 })
    expect(parseCommand('/slow off')).toEqual({ cmd: 'slow', seconds: 0 })
    expect(parseCommand('/slow 0')).toEqual({ cmd: 'slow', seconds: 0 })
    expect(parseCommand('/slow 301')).toMatchObject({ cmd: 'invalid' })
    expect(parseCommand('/slow')).toMatchObject({ cmd: 'invalid' })
  })
  it('unknown command', () => {
    expect(parseCommand('/ban x')).toMatchObject({ cmd: 'invalid' })
  })
})
