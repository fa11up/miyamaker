/**
 * Revenue split display for miyamints collections. Mirrors contracts/src/shared/libraries/RevenueSplitLib.sol:
 * protocol and vault cuts round down, the artist gets the remainder (dust included). Pure: tested in
 * tests/miyamints-launch.test.mts.
 */
import { formatEther, parseEther } from 'viem'

export const BPS = 10_000

export type SplitAmounts = { protocol: bigint; vault: bigint; artist: bigint }

export function splitAmount(amount: bigint, protocolBps: number, alignmentBps: number): SplitAmounts {
  const protocol = (amount * BigInt(protocolBps)) / BigInt(BPS)
  const vault = (amount * BigInt(alignmentBps)) / BigInt(BPS)
  return { protocol, vault, artist: amount - protocol - vault }
}

/** 1000 → "10%", 1250 → "12.5%", 8875 → "88.75%". */
export function pctLabel(bps: number): string {
  const whole = Math.floor(bps / 100)
  const frac = bps % 100
  if (!frac) return `${whole}%`
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}%`
}

/** Short ETH amount for plain-words copy: at most 4 decimals, trailing zeros dropped, "<0.0001" for dust. */
export function ethLabel(wei: bigint): string {
  if (wei === 0n) return '0 ETH'
  const s = formatEther(wei)
  const [w, f = ''] = s.split('.')
  const cut = f.slice(0, 4).replace(/0+$/, '')
  if (w === '0' && !cut) return '<0.0001 ETH'
  return `${w}${cut ? `.${cut}` : ''} ETH`
}

export type SplitPart = {
  key: 'artist' | 'vault' | 'protocol'
  bps: number
  pct: string
  amount: bigint
  words: string
}

/**
 * The three shares in plain words for an example sale amount (default 1 ETH), artist first.
 * `vaultName` is what the alignment vault buys, e.g. "INFER".
 */
export function describeSplit(p: { protocolBps: number; alignmentBps: number; vaultName?: string; example?: bigint }): {
  parts: SplitPart[]
  sentence: string
  valid: boolean
} {
  const example = p.example ?? parseEther('1')
  const valid = p.alignmentBps >= 0 && p.protocolBps >= 0 && p.protocolBps + p.alignmentBps <= BPS
  const a = splitAmount(example, p.protocolBps, valid ? p.alignmentBps : 0)
  const artistBps = BPS - p.protocolBps - (valid ? p.alignmentBps : 0)
  const vault = p.vaultName ? `the ${p.vaultName} vault` : 'the community vault'
  const parts: SplitPart[] = [
    { key: 'artist', bps: artistBps, pct: pctLabel(artistBps), amount: a.artist, words: 'goes to you' },
    {
      key: 'vault',
      bps: p.alignmentBps,
      pct: pctLabel(p.alignmentBps),
      amount: a.vault,
      words: `buys into ${vault}`,
    },
    { key: 'protocol', bps: p.protocolBps, pct: pctLabel(p.protocolBps), amount: a.protocol, words: 'goes to miya' },
  ]
  const sentence = `Of every ${ethLabel(example)} collected, ${ethLabel(a.artist)} goes to you, ${ethLabel(
    a.vault
  )} buys into ${vault} and ${ethLabel(a.protocol)} goes to miya.`
  return { parts, sentence, valid }
}
