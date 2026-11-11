#!/usr/bin/env node
// Points a registered reveal at its drop once the drop exists: the site checks on the chain that the contract was
// created in --deploy-block, its maxSupply is the collection's supply and its baseURI is <site>/reveal/<slug>/. From then
// on the cron reads its mints. Also prints the collection's status (--status alone does only that).
//
//   REVEAL_ADMIN_KEY=… node scripts/reveal/attach.mjs --address 0x… --deploy-block 24000000
//       [--site https://www.miyamaker.com] [--slug miyamaker]
import { admin, adminKey, log, parseArgs, revealBase, run } from './lib.mjs'

const flags = parseArgs(process.argv.slice(2), {
  site: 'value',
  slug: 'value',
  address: 'value',
  'deploy-block': 'value',
  status: 'flag',
})

run(async () => {
  const key = adminKey()
  const base = revealBase(flags.site ?? 'https://www.miyamaker.com', flags.slug ?? 'miyamaker')
  if (!flags.status) {
    if (!flags.address || !flags['deploy-block'])
      throw new Error('--address and --deploy-block are required (or --status).')
    const r = await admin(base, 'attach', {
      method: 'POST',
      key,
      body: JSON.stringify({ address: flags.address, deployBlock: Number(flags['deploy-block']) }),
    })
    if (r.status !== 200) throw new Error(`attach: ${r.status} ${r.data.error}`)
    log(`attached ${flags.address} from block ${flags['deploy-block']}`)
  }
  const s = await admin(base, 'status', { key })
  if (s.status !== 200) throw new Error(`status: ${s.status} ${s.data.error}`)
  const c = s.data.collection
  log(
    `${c.slug}: chain ${c.chainId}, ${c.address ?? 'no address yet'}, scanned to ${c.lastScannedBlock ?? '-'}, ` +
      `${c.minted} minted, ${c.assigned} drawn, missing ${s.data.missingImages.length} image(s) / ` +
      `${s.data.missingMetadata.length} metadata${c.lastError ? `; last error: ${c.lastError}` : ''}`
  )
  return 0
})
