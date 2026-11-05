import type { Address } from 'viem'
import { mainnet } from 'viem/chains'

/**
 * The miyanet: tokens and contracts the miyamaker ecosystem runs on. All Ethereum mainnet, all verified on
 * chain (symbol/supply via `cast call`). Keep this to public facts: no season pot sizes or unannounced plans.
 */
export const MIYANET_CHAIN_ID = mainnet.id

export const INFER: Address = '0x53d0eA0A685220718Dc6a0a6e4617194C6F37921'
export const MIYA: Address = '0xa358491CA72B793ddf21cF46C7289CC6e0ce9e5A'
export const MXXN: Address = '0x2BBC21129E072A2A92A0Fd13DA750c1F977a25fB'
export const IMDUSD_V1: Address = '0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25'
/** Burns MIYA/MXXN for INFER at fixed rates for one year (closes 2027-10-11). Owns MIYA since 2026-10-11. */
export const LEGACY_REDEEMER: Address = '0x5E11e627d63755Afa4b01D4c1de1E315EeFdb348'
export const IMDUSD_TREASURY: Address = '0x6Ac8fF96Fb8DCF5d79A8eF1E59D9AC23f2BD27Bc'

export const INFER_SUPPLY = 1_000_000_000
/** MIYA a wallet can redeem before the rest vests over one 13-week season (`IMMEDIATE_A`). */
export const MIYA_IMMEDIATE_LIMIT = 200_000
/** INFER a wallet can receive at once from MXXN before the rest vests (`IMMEDIATE_B_INFER`). */
export const MXXN_IMMEDIATE_INFER = 930_000

/** The two tokens the claim burns for INFER. */
export type Legacy = 'miya' | 'mxxn'

export const LINKS = {
  infer: 'https://infer.imdusd.com/',
  claim: 'https://infer.imdusd.com/claim/',
  tokenomics: 'https://infer.imdusd.com/tokenomics/',
  imdusd: 'https://imdusd.com/',
  docs: 'https://imdusd.com/docs',
  whitepaper: 'https://whitepaper.imdusd.com/',
  box: 'https://box.imdusd.com/',
} as const

export const legacyRedeemerAbi = [
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'legacy', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'out', type: 'uint256' }],
  },
  { type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'claimable',
    stateMutability: 'view',
    inputs: [{ name: 'holder', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'quote',
    stateMutability: 'view',
    inputs: [
      { name: 'legacy', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [
      { name: 'out', type: 'uint256' },
      { name: 'left', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'quoteFor',
    stateMutability: 'view',
    inputs: [
      { name: 'holder', type: 'address' },
      { name: 'legacy', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [
      { name: 'now_', type: 'uint256' },
      { name: 'later', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'vestingOf',
    stateMutability: 'view',
    inputs: [{ name: 'holder', type: 'address' }],
    outputs: [
      { name: 'total', type: 'uint128' },
      { name: 'claimed', type: 'uint128' },
      { name: 'start', type: 'uint64' },
    ],
  },
  { type: 'function', name: 'closesAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'rateA', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'rateB', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'paidImmediately',
    stateMutability: 'view',
    inputs: [
      { name: 'legacy', type: 'address' },
      { name: 'holder', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'advanceClock',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'legacy', type: 'address' },
      { name: 'steps', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

/** MXXN moves (and so redeems) only inside its full-moon window, given in block numbers. */
export const mxxnAbi = [
  {
    type: 'function',
    name: 'moonConfig',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'start', type: 'uint256' },
      { name: 'end', type: 'uint256' },
    ],
  },
] as const
