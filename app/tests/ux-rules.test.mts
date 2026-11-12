// The owner's decided UX rules (.claude/skills/ux-guru/references/rubric.md) as cheap source scans. Run: yarn test
//
// Each rule has an allowlist. An entry is either a place where the rule's words are fine on purpose (say why), or a
// known violation in code someone else owns, marked TODO, kept so the suite stays green while the owner burns it down.
// Fix the code and delete the entry; never add an entry to hide new work.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { code, hits, outside, walk } from './source-scan.mts'

// The app's own source and the pages it frames (embed/: miyakeys), which live inside its windows too.
const ROOTS = ['src', 'embed']
const SRC = ROOTS.flatMap((d) => walk(d))
/** The same, with stylesheets. */
const SRC_CSS = ROOTS.flatMap((d) => walk(d, true))
const TSX = SRC.filter((p) => /\.[jt]sx$/.test(p))

test('the rule scans cover the framed pages (embed/) as well as src/', () => {
  assert.ok(SRC.includes('embed/miyakeys/js/app.js'))
  assert.ok(SRC_CSS.includes('embed/miyakeys/css/components.css'))
  assert.ok(SRC_CSS.includes('embed/miyakeys/css/mobile.css'))
})

test('raw error text never reaches the screen', () => {
  const ALLOW = [
    // Crash screens: a plain sentence first, the raw text only behind a "Details" toggle.
    'src/components/ErrorBoundary/index.tsx',
    'src/components/DynamicWrapper/index.tsx',
    // fundAndUpload only throws uploadErrorWords sentences (utils/uploadError.ts), so .message is already plain.
    'src/components/ProgressUploader/index.tsx',
  ]
  const found = [
    // In JSX: {e.message}, {err.message}, {error?.message}, {x.shortMessage}
    ...TSX.flatMap((p) => hits(p, /\{\s*(e|err|error|[a-z]*Err)\??\.message\s*\}|\.shortMessage\s*\}/g)),
    // (e as Error).message in a component, unless it only feeds a check (`… || ''` going into a regex or classifier).
    ...TSX.flatMap((p) => hits(p, /as Error\)\??\.message\b(?!\s*(\|\||\?\?)\s*'')/g)),
    // A state setter fed an error's own text, unless the same line maps it.
    ...SRC.flatMap((p) =>
      hits(p, /\bset[A-Z]\w*\([^\n]*\b(e|err|error|\w+ as Error\))\??\.(message|shortMessage)\b[^\n]*/g).filter(
        (h) => {
          const line = code(h.split(':')[0]!).split('\n')[Number(h.split(':')[1]) - 1] ?? ''
          return !/plainTxError\(|describe\w*Error\(|uploadErrorWords\(|instanceof TxEndError/.test(line)
        }
      )
    ),
  ]
  assert.deepEqual(outside(found, ALLOW), [])
})

test('every looping animation stops for prefers-reduced-motion', () => {
  const ALLOW: string[] = []
  const found = SRC_CSS.filter(
    (p) =>
      /\binfinite\b/.test(code(p)) &&
      !/prefers-reduced-motion|useReducedMotion|reducedMotion|reduceMotion/.test(readFileSync(p, 'utf8'))
  )
  assert.deepEqual(outside(found, ALLOW), [])
})

test('no sideways scrolling inside a window', () => {
  const ALLOW = [
    // The taskbar is the desktop's own strip, not a window: its buttons scroll when there are many.
    'src/components/TaskBar/index.tsx',
  ]
  const found = SRC_CSS.flatMap((p) =>
    hits(p, /overflow-x:\s*(auto|scroll)|overflowX:\s*['"](auto|scroll)['"]/g)
  )
  assert.deepEqual(outside(found, ALLOW), [])
})

test('only a pressed link opens another site: no window.open, no picture-only new-tab links', () => {
  const ALLOW = [
    // The webring's "Random site" button: the person pressed it, and its label says where it goes.
    'src/pages/Home/Webring.tsx',
  ]
  assert.deepEqual(outside(SRC.flatMap((p) => hits(p, /\bwindow\.open\(/g)), ALLOW), [])

  const attrs = String.raw`(?:[^>{]|\{[^}]*\})*`
  const pictureLink = new RegExp(
    String.raw`<(a|\w*Link)\b(${attrs})>\s*<(img|\w*(?:Img|Image|Logo))\b${attrs}/>\s*</\1>`,
    'g'
  )
  const found = TSX.flatMap((p) => {
    const text = code(p)
    return [...text.matchAll(pictureLink)]
      .filter((m) => /_blank/.test(m[2]!))
      .map((m) => `${p}:${text.slice(0, m.index).split('\n').length}`)
  })
  assert.deepEqual(found, [])
})

test('no "powered by" boxes', () => {
  assert.deepEqual(
    SRC.flatMap((p) => hits(p, /powered by/gi)),
    []
  )
})

test('no yield, profit or guarantee promises', () => {
  const found = SRC.flatMap((p) => {
    const lines = code(p).split('\n')
    return hits(p, /\b(APY|APR|guaranteed|guarantee[sd]?|profits?|profitable)\b/gi).filter((h) => {
      const line = lines[Number(h.split(':')[1]) - 1] ?? ''
      // The one place these words may appear: saying it is not an investment.
      return !/not an investment/i.test(line)
    })
  })
  assert.deepEqual(found, [])
})

test('no Home button in Trade', () => {
  const found = walk('src/pages/Swap').flatMap((p) =>
    hits(p, />\s*Home\s*<|\bHomeButton\b|aria-label=\{?\s*['"`]Home\b|label:\s*['"`]Home['"`]/g)
  )
  assert.deepEqual(found, [])
})

test('one Connect wallet per view: at most one connect button in a file', () => {
  const ALLOW: string[] = []
  const connect = /<(ConnectedButton|ConnectWalletButton|ConnectButton)\b|['"`>]Connect( a)? wallet['"`<]/g
  const found = SRC.filter((p) => !/components\/Button\/|Mint\/Button\/ConnectWalletButton/.test(p)).filter(
    (p) => [...code(p).matchAll(connect)].length > 1
  )
  assert.deepEqual(outside(found, ALLOW), [])
})

test('page-wide shortcuts on printable keys never fire while typing', () => {
  const ALLOW = [
    // Modals that own the keyboard while open (nothing to type into behind them):
    // the handheld's zoom viewer (+, -, arrows, Escape).
    'src/pages/Mint/handheld/Holo.tsx',
    // The sampler's keyboard: its handler returns first when typing(e) (keys.js) says a field has focus.
    'src/pages/MusicMaker/MiyaMusicMaker.jsx',
  ]
  const printable = /\.key\s*===\s*['"][^'"\\]['"]|\.test\(\s*\w+\.key\s*\)|\.key\.length\s*===\s*1/
  const found = SRC.filter((p) => {
    const text = code(p)
    return (
      /(window|document)\.addEventListener\(\s*['"]key(down|press)['"]/.test(text) &&
      printable.test(text) &&
      !/isTyping|isTextEntry|isEditable|isContentEditable|tagName/.test(text)
    )
  })
  assert.deepEqual(outside(found, ALLOW), [])
})
