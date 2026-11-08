// Walks miyaOS's apps at desktop and phone size: screenshots plus automatic QA checks. See ../SKILL.md.
// node .claude/skills/ux-guru/scripts/capture.mjs <outdir> [app,app]   (SITE=http://localhost:5198 by default)
// Exits 1 when any state had a page error or a step it could not perform, so a broken walk is never mistaken for a clean one.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Playwright is an app devDependency: load it from this repo's app/, never from somewhere else on the machine.
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../app')
let chromium
try {
  ;({ chromium } = createRequire(join(APP, 'package.json'))('playwright'))
} catch {
  console.error(
    `capture.mjs: Playwright is not installed in ${APP}.\n` +
      '  Run `yarn install` in app/ (playwright is a devDependency), then `npx playwright install chromium`.'
  )
  process.exit(2)
}

const OUT = process.argv[2] || 'ux-captures'
const ONLY = process.argv[3]?.split(',')
const SITE = process.env.SITE || 'http://localhost:5198'
const LIVE = 'https://www.miyamaker.com'
const SIZES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
}

/** A wallet in the page: reads go to a public node, every write is recorded and refused. Nothing can be sent. */
const wallet = () => {
  const account = '0x28C6c06298d514Db089934071355E5743bf21d60'
  const rpc = async (method, params) => {
    const r = await fetch('https://ethereum-rpc.publicnode.com', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const j = await r.json()
    if (j.error) throw Object.assign(new Error(j.error.message), j.error)
    return j.result
  }
  const provider = {
    isMetaMask: true,
    on() {},
    removeListener() {},
    async request({ method, params }) {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [account]
        case 'eth_chainId':
          return '0x1'
        case 'net_version':
          return '1'
        case 'wallet_requestPermissions':
        case 'wallet_getPermissions':
          return [{ parentCapability: 'eth_accounts' }]
        case 'wallet_getCapabilities':
          throw Object.assign(new Error('Method not supported'), { code: 4200 })
        case 'eth_sendTransaction':
        case 'eth_sendRawTransaction':
        case 'wallet_sendCalls':
        case 'personal_sign':
        case 'eth_signTypedData_v4':
          throw Object.assign(new Error('User rejected the request'), { code: 4001 })
        default:
          return rpc(method, params)
      }
    },
  }
  window.ethereum = provider
  window.addEventListener('eip6963:requestProvider', () =>
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({
          info: {
            uuid: '11111111-1111-4111-8111-111111111111',
            name: 'MetaMask',
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
            rdns: 'io.metamask',
          },
          provider,
        }),
      }),
    ),
  )
}

const press = (p, name) => p.getByRole('button', { name, exact: typeof name === 'string' }).first().click({ timeout: 8000 })
const tv = (id) => ({ path: '/tv', storage: { 'miyatv.channel': id } })
/** Clicks a spot rather than an element: for things a listing-wide button sits over. */
const clickSpot = async (p, locator) => {
  const b = await locator.boundingBox({ timeout: 8000 })
  if (!b) throw new Error('nothing to click')
  await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}

const row = (p, name) => p.getByRole('row', { name }).first()
const openCollection = async (p, name = /milady/i) => {
  await row(p, name).getByRole('link').or(row(p, name).getByRole('button')).first().click({ timeout: 10000 })
  await p.waitForTimeout(7000)
}
const openToken = async (p, name = /INFER/) => {
  await p.locator('section[aria-label=Tokens]').getByRole('row', { name }).first().getByRole('link').or(p.locator('section[aria-label=Tokens]').getByRole('row', { name }).first().getByRole('button')).first().click({ timeout: 10000 })
  await p.waitForTimeout(6000)
}
const openListing = async (p) => {
  await openCollection(p)
  await p.getByRole('button', { name: /^#\d+.*Open$/ }).first().click({ timeout: 10000 })
  await p.waitForTimeout(4000)
}
const openLot = async (p) => {
  await p.getByText(/Miya Auction/).first().click({ timeout: 10000 })
  await p.waitForTimeout(4000)
}

// No wallet unless a state says so: that is what a first-time visitor sees.
const STATES = {
  trade: [
    { name: 'home', path: '/trade', wait: 7000 },
    { name: 'search', path: '/trade', wait: 6000, act: async (p) => { await p.getByLabel(/Search NFTs and tokens/).fill('mil'); await p.waitForTimeout(2500) } },
    { name: 'sorted', path: '/trade', wait: 6000, act: async (p) => { await p.locator('th button').filter({ hasText: /Floor/i }).first().click({ timeout: 10000 }); await p.waitForTimeout(800) } },
    { name: 'robinhood', path: '/trade', wait: 6000, act: async (p) => { await p.getByRole('group', { name: 'Network' }).getByRole('button', { name: /Robinhood/i }).click({ timeout: 10000 }); await p.waitForTimeout(6000) } },
    { name: 'collection', path: '/trade', wait: 7000, act: (p) => openCollection(p) },
    { name: 'collection-empty', path: '/trade', wait: 7000, act: (p) => openCollection(p, /miyamaker mini/i) },
    { name: 'listing', path: '/trade', wait: 7000, act: openListing },
    { name: 'listing-wallet', wallet: true, path: '/trade', wait: 7000, act: openListing },
    { name: 'token', path: '/trade', wait: 7000, act: (p) => openToken(p) },
    { name: 'token-wallet', wallet: true, path: '/trade', wait: 7000, act: (p) => openToken(p) },
    { name: 'wallet', wallet: true, path: '/trade', wait: 7000 },
  ],
  tv: [
    { name: 'lofi', ...tv('lofi'), wait: 9000 },
    { name: 'radio', ...tv('miya-radio'), wait: 4000 },
    { name: 'monterey', ...tv('monterey'), wait: 9000 },
    { name: 'space', ...tv('iss'), wait: 9000 },
    { name: 'squeek', ...tv('squeekchain'), wait: 5000 },
    { name: 'kick', ...tv('kick-imdusd'), wait: 8000 },
    { name: 'public', ...tv('public-access'), wait: 8000 },
    { name: 'guide', ...tv('lofi'), wait: 3000, act: async (p) => { await press(p, 'Guide'); await p.waitForTimeout(2500) } },
    { name: 'guide-end', ...tv('lofi'), wait: 3000, act: async (p) => { await press(p, 'Guide'); await p.waitForTimeout(1500); await p.getByTestId('guide').getByText('Public Access').first().scrollIntoViewIfNeeded(); await p.waitForTimeout(1000) } },
    { name: 'no-chat', ...tv('lofi'), wait: 5000, act: async (p) => { await p.getByRole('button', { name: /^(Hide the sidebar|Chat)$/ }).click({ timeout: 10000 }); await p.waitForTimeout(1000) } },
    { name: 'wallet', wallet: true, ...tv('miya-radio'), wait: 5000 },
  ],
  radio: [
    { name: 'empty', path: '/radio', wait: 4000 },
    { name: 'wallet', wallet: true, path: '/radio', wait: 5000 },
  ],
  auction: [
    { name: 'home', path: '/auction', wait: 6000 },
    { name: 'lot', path: '/auction', wait: 6000, act: openLot },
    { name: 'viewer', path: '/auction', wait: 6000, act: async (p) => { await openLot(p); await p.locator('button[title="View artwork"]').first().click({ timeout: 10000 }); await p.waitForTimeout(2500) } },
    { name: 'lot-wallet', wallet: true, path: '/auction', wait: 6000, act: openLot },
  ],
  launch: [
    { name: 'start', path: '/launch', wait: 4000 },
    { name: 'step2', path: '/launch', wait: 4000, act: async (p) => { await press(p, /Next/i); await p.waitForTimeout(1000) } },
    { name: 'wallet', wallet: true, path: '/launch', wait: 5000 },
  ],
  dropmusic: [
    { name: 'start', path: '/drop-music', wait: 4000 },
    { name: 'wallet', wallet: true, path: '/drop-music', wait: 5000 },
  ],
  upload: [
    { name: 'start', path: '/upload', wait: 4000 },
    { name: 'wallet', wallet: true, path: '/upload', wait: 5000 },
  ],
  files: [
    { name: 'start', path: '/files', wait: 4000 },
    { name: 'wallet', wallet: true, path: '/files', wait: 12000 },
  ],
}

/** Everything checked in the page, per state. */
const inspect = (phone) => {
  const shown = (e) => {
    const r = e.getBoundingClientRect()
    const s = getComputedStyle(e)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const say = (e) => (e.getAttribute('aria-label') || e.labels?.[0]?.innerText || e.innerText || e.getAttribute('title') || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 50)
  const all = [...document.querySelectorAll('body *')].filter(shown)
  const sideways = all
    .filter((e) => { const s = getComputedStyle(e); return e.scrollWidth > e.clientWidth + 2 && (s.overflowX === 'auto' || s.overflowX === 'scroll') })
    .map((e) => `${say(e)} (${e.scrollWidth - e.clientWidth}px)`)
  const clipped = all
    .filter((e) => { const s = getComputedStyle(e); return e.children.length === 0 && e.innerText?.trim() && s.overflowX === 'hidden' && s.textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 1 })
    .map(say)
  const ellipsed = all
    .filter((e) => getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1 && !e.title)
    .map(say)
  const controls = all.filter((e) => e.matches('a[href],button,input:not([type=hidden]),select,[role=button],[role=tab]'))
  const past = controls
    .filter((e) => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1 })
    .map(say)
  const small = phone
    ? controls.filter((e) => { const r = e.getBoundingClientRect(); return (r.width < 32 || r.height < 32) && e.type !== 'range' }).map((e) => { const r = e.getBoundingClientRect(); return `${say(e)} ${Math.round(r.width)}x${Math.round(r.height)}` })
    : []
  const nameless = controls.filter((e) => !say(e) || say(e) === e.tagName).map((e) => e.outerHTML.slice(0, 80))
  const broken = [...document.images].filter((i) => shown(i) && i.complete && i.naturalWidth === 0).map((i) => i.currentSrc.slice(0, 90))
  const noAlt = [...document.images].filter((i) => shown(i) && !i.hasAttribute('alt')).length
  const connects = controls.filter((e) => /connect( a)?( wallet)?$/i.test((e.innerText || '').trim())).length
  const text = document.body.innerText.replace(/\s+/g, ' ').trim()
  return {
    pageOverflow: document.documentElement.scrollWidth - innerWidth,
    sideways, clipped: [...new Set(clipped)].slice(0, 20), ellipsed: [...new Set(ellipsed)].slice(0, 20),
    pastScreen: [...new Set(past)].slice(0, 20), smallTargets: [...new Set(small)].slice(0, 40), nameless: nameless.slice(0, 10),
    brokenImages: broken, imagesNoAlt: noAlt, connectButtons: connects, text: text.slice(0, 3000),
  }
}

/** Server routes (app/api/worker.ts) a vite preview doesn't serve: their GETs are read from the live site. */
const PROXIED = [
  '**/api/market/**',
  '**/api/opensea**',
  '**/api/tv/live',
  '**/api/public-access*',
  '**/api/station*',
  '**/api/contracts/verified*',
  '**/api/0x/**',
  // In the build too, but the Worker serves them with its own range handling (serveRange): read the live copy.
  '**/commercials/**',
]

const proxied = async (route) => {
  const req = route.request()
  if (req.method() !== 'GET') return route.fallback()
  const u = new URL(req.url())
  try {
    const res = await fetch(LIVE + u.pathname + u.search, { headers: { origin: LIVE, referer: `${LIVE}/` } })
    return route.fulfill({ status: res.status, contentType: res.headers.get('content-type') || 'application/json', body: Buffer.from(await res.arrayBuffer()) })
  } catch {
    return route.abort()
  }
}

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
const report = {}
const size = 3
const jobs = []
for (const [app, states] of Object.entries(STATES)) {
  if (ONLY && !ONLY.includes(app)) continue
  mkdirSync(join(OUT, app), { recursive: true })
  for (const state of states) for (const sizeName of Object.keys(SIZES)) jobs.push({ app, state, sizeName })
}
const run = async ({ app, state, sizeName }) => {
  const c = await browser.newContext({ ...SIZES[sizeName], serviceWorkers: 'block' })
  const p = await c.newPage()
  const r = { errors: [], console: [], failed: [] }
  p.on('pageerror', (e) => r.errors.push(String(e).slice(0, 200)))
  p.on('console', (m) => { if (m.type() === 'error') r.console.push(m.text().slice(0, 200)) })
  p.on('response', (x) => { if (x.status() >= 400 && x.url().startsWith(SITE)) r.failed.push(`${x.status()} ${x.url().replace(SITE, '').slice(0, 90)}`) })
  if (state.wallet) await p.addInitScript(wallet)
  if (state.storage) await p.addInitScript((s) => Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, v)), state.storage)
  for (const glob of PROXIED) await p.route(glob, proxied)
  try {
    await p.goto(SITE + state.path, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await p.waitForTimeout(state.wait ?? 4000)
    if (state.act) await state.act(p)
  } catch (e) {
    r.stepFailed = String(e).replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').slice(0, 420)
  }
  await p.screenshot({ path: join(OUT, app, `${state.name}.${sizeName}.png`) }).catch(() => {})
  Object.assign(r, await p.evaluate(inspect, sizeName === 'phone').catch((e) => ({ inspectFailed: String(e).slice(0, 150) })))
  ;(report[app] ??= {})[`${state.name}.${sizeName}`] = r
  await c.close()
}
const queue = [...jobs]
await Promise.all(Array.from({ length: size }, async () => { while (queue.length) await run(queue.shift()) }))
await browser.close()
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1))
const rows = Object.entries(report).flatMap(([a, s]) => Object.entries(s).map(([k, r]) => `${a}/${k}: err ${r.errors.length} cons ${r.console.length} fail ${r.failed.length} sideways ${r.sideways?.length ?? '?'} clip ${r.clipped?.length ?? '?'} past ${r.pastScreen?.length ?? '?'} small ${r.smallTargets?.length ?? 0} broken ${r.brokenImages?.length ?? '?'} connect ${r.connectButtons ?? '?'}${r.stepFailed ? ` STEP: ${r.stepFailed}` : ''}`))
console.log(rows.join('\n'))
const broken = Object.entries(report).flatMap(([a, s]) =>
  Object.entries(s)
    .filter(([, r]) => r.stepFailed || r.errors.length || r.inspectFailed)
    .map(([k]) => `${a}/${k}`)
)
if (broken.length) {
  console.error(`\n${broken.length} state(s) had a page error or a failed step: ${broken.join(', ')}`)
  process.exit(1)
}
