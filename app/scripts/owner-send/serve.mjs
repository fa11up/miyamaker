// Serves a one-page signer on 127.0.0.1 for owner transactions prepared by a script (a phase reset, a mint, a lock).
// The page connects the browser wallet, checks the chain and the account, re-reads every guard from the chain, simulates
// each transaction from the connected account, and only then offers Send. Nothing here holds a key or sends anything
// itself: the wallet signs.
//
//   node scripts/owner-send/serve.mjs --plan ~/miyamaker-drop/plan.json [--port 8765]
//
// The plan (JSON):
//   { "title": "…", "chainId": 1, "from": "0xOwner", "note": "…",
//     "guards": [ { "label": "…", "to": "0x…", "data": "0x…", "expect": "0x…" } ],   // eth_call result must equal expect
//       or { …, "arrayAt": [1, 2], "equals": ["2", "41"] }: only those positions of a returned uint256[] must match
//     "txs": [ { "label": "…", "to": "0x…", "data": "0x…", "value": "0x0", "gas": "0x…"? } ] }
// A guard that no longer matches means the chain moved since the plan was made: the page refuses and says so.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
)
if (!args.plan) {
  console.error('usage: node scripts/owner-send/serve.mjs --plan <plan.json> [--port 8765]')
  process.exit(2)
}
const port = Number(args.port || 8765)
const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, 'index.html'), 'utf8')
const HEX = /^0x[0-9a-fA-F]*$/
const ADDR = /^0x[0-9a-fA-F]{40}$/

const readPlan = () => {
  const p = JSON.parse(readFileSync(args.plan, 'utf8'))
  if (!Number.isInteger(p.chainId) || !ADDR.test(p.from) || !Array.isArray(p.txs) || !p.txs.length) {
    throw new Error('plan needs chainId, from and at least one tx')
  }
  for (const t of p.txs) if (!ADDR.test(t.to) || !HEX.test(t.data)) throw new Error(`bad tx: ${t.label}`)
  for (const g of p.guards || []) {
    const ok = g.arrayAt ? Array.isArray(g.arrayAt) && Array.isArray(g.equals) && g.arrayAt.length === g.equals.length : HEX.test(g.expect)
    if (!ADDR.test(g.to) || !HEX.test(g.data) || !ok) throw new Error(`bad guard: ${g.label}`)
  }
  return p
}
readPlan() // fail at start, not in the browser

createServer((req, res) => {
  // Only this machine: the plan is not secret, but nothing else should drive it.
  const host = (req.headers.host || '').split(':')[0]
  if (host !== '127.0.0.1' && host !== 'localhost') {
    res.writeHead(403).end()
    return
  }
  if (req.url === '/plan.json') {
    try {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(readPlan()))
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e.message))
    }
    return
  }
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page)
    return
  }
  res.writeHead(404).end()
}).listen(port, '127.0.0.1', () => console.log(`owner-send: http://127.0.0.1:${port}/  (plan ${args.plan})`))
