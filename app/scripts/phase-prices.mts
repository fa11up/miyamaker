// What to type in the Launch window for a phase priced at an ETH amount in imdUSD, IMD and INFER too. Read-only.
//
//   node scripts/phase-prices.mts [--eth 0.01] [--block <n>]
//
// Spot values (scripts/lib/prices.mts), cut to 4 significant digits. The V4Quoter's figures (what the ETH would buy
// after pool fees and impact) are printed beside them as a check.
import { parseEther } from 'viem'

import { args, client, rpcHost, rpcUrl, short } from './lib/chain.mts'
import { ethEquivalents, fmt, roundPrice } from './lib/prices.mts'

async function main() {
  const o = args()
  const url = rpcUrl()
  const c = client(url)
  const wei = parseEther(o.eth || '0.01')
  const block = o.block ? BigInt(o.block) : await c.getBlockNumber()
  const e = await ethEquivalents(c, wei, block)
  console.log(`RPC ${rpcHost(url)}, block ${block}. ${fmt(wei)} ETH (ETH = $${e.ethUsd.toFixed(2)}) is about:`)
  console.log(`  imdUSD  ${fmt(roundPrice(e.imdUSD))}   (exact ${fmt(e.imdUSD)})`)
  console.log(`  IMD     ${fmt(roundPrice(e.imd))}   (exact ${fmt(e.imd)}; quoter after fees: ${fmt(e.quoted.imd)})`)
  console.log(`  INFER   ${fmt(roundPrice(e.infer))}   (exact ${fmt(e.infer)}; quoter after fees: ${fmt(e.quoted.infer)})`)
  for (const n of e.notes) console.log(`  note: ${n}`)
}

main().catch((e) => {
  console.error(short(e))
  process.exit(1)
})
