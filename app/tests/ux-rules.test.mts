// The owner's decided UX rules (.claude/skills/ux-guru/references/rubric.md) as cheap source scans. Run: yarn test
//
// Each rule has an allowlist. An entry is either a place where the rule's words are fine on purpose (say why), or a
// known violation in code someone else owns, marked TODO, kept so the suite stays green while the owner burns it down.
// Fix the code and delete the entry; never add an entry to hide new work.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { code, hits, outside, sidewaysScrollers, unstoppedLoops, walk } from './source-scan.mts'

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
  // Its page too: a <style> or style="" there is under the same rules.
  assert.ok(SRC_CSS.includes('embed/miyakeys/index.html'))
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

test('every looping animation stops for prefers-reduced-motion, each one on its own', () => {
  const ALLOW: string[] = []
  assert.deepEqual(outside(SRC_CSS.flatMap((p) => unstoppedLoops(p)), ALLOW), [])
})

test("the reduced-motion rule catches a loop the file's other reduced-motion rule does not stop", () => {
  // One stopped loop no longer excuses a second one in the same file.
  const css = `.a { animation: spin 1s infinite; }
.b { animation: blink 1s steps(1) infinite; }
@media (prefers-reduced-motion: reduce) {
  .a { animation: none; }
}`
  assert.deepEqual(unstoppedLoops('x.css', css), ['x.css:2 .b'])
  assert.deepEqual(unstoppedLoops('x.css', `${css}\n@media (prefers-reduced-motion: reduce) { .c, .b { animation: none } }`), [])
  assert.deepEqual(unstoppedLoops('x.css', '@media (prefers-reduced-motion: no-preference) { .a { animation: s 1s infinite } }'), [])
  assert.deepEqual(unstoppedLoops('x.css', '.a { animation: s 1s infinite } @media (prefers-reduced-motion: reduce) { * { animation: none } }'), [])
  // A shorter selector only wins with !important.
  const deep = '.pet.idle .body { animation: s 1s infinite } @media (prefers-reduced-motion: reduce) { .body { animation: none'
  assert.deepEqual(unstoppedLoops('x.css', `${deep} } }`), ['x.css:1 .pet.idle .body'])
  assert.deepEqual(unstoppedLoops('x.css', `${deep} !important } }`), [])
  // styled-components: the media block has to be in the same component, naming the same rule.
  const tsx = [
    'const A = styled.div`',
    '  animation: ${spin} 1s infinite;',
    '  @media (prefers-reduced-motion: reduce) {',
    '    animation: none;',
    '  }',
    '`',
    '',
    'const B = styled.div`',
    '  .dot {',
    '    animation: ${spin} 1s infinite;',
    '  }',
    '  .ring {',
    '    animation: ${spin} 2s infinite;',
    '  }',
    '  @media (prefers-reduced-motion: reduce) {',
    '    .dot {',
    '      animation: none;',
    '    }',
    '  }',
    '`',
    '',
    'const C = styled.div`',
    '  animation: ${spin} 1s infinite;',
    '`',
    '',
  ].join('\n')
  assert.deepEqual(unstoppedLoops('x.tsx', tsx), ['x.tsx:13 .ring', 'x.tsx:23'])
  // A component the window stills from JS (a $still prop, a reduced flag) counts.
  const still = ['const D = styled.div<{ $still: boolean }>`', '  ${({ $still }) => !$still && css`animation: ${s} 1s infinite;`}', '`', ''].join('\n')
  assert.deepEqual(unstoppedLoops('x.tsx', still), [])
})

test('no sideways scrolling inside a window', () => {
  // Entries are `path rule` (the rule's selector, or the styled component's name), so an entry holds while lines move;
  // a bare path allows the whole file. `overflow: auto` scrolls both ways: an entry says its content cannot be wider
  // than the box (it wraps, or is a column of full-width rows), or is a TODO for the code's owner.
  const ALLOW = [
    // The taskbar is the desktop's own strip, not a window: its buttons scroll when there are many.
    'src/components/TaskBar/index.tsx',
    // Columns of rows or wrapping text, sized to their box: only ever taller than it.
    'src/desktop/files/MyFiles.tsx Pane',
    'src/desktop/files/Properties.tsx .content',
    'src/pages/MiyaMakerStudio/Inspector.tsx Column',
    'src/pages/MiyaMakerStudio/Assets.tsx List',
    'src/pages/MusicMaker/PublishDialog.tsx Card',
    'src/pages/MusicMaker/styles/miyamaker.css .browser-tree',
    'src/pages/MusicMaker/styles/miyamaker.css .pad-pick .file-menu',
    'src/pages/MusicMaker/styles/miyamaker.css .side-controls',
    'src/pages/MusicMaker/styles/miyamaker.css .dialog',
    'src/pages/MusicMaker/styles/miyamaker.css .lib-list',
    'src/pages/MusicMaker/styles/miyamaker.css .rail-slot',
    'src/pages/MusicMaker/styles/miyamaker.css .arranger-list',
    'src/pages/MusicMaker/styles/miyamaker.css .arrange-menu',
    'src/pages/MusicMaker/styles/miyamaker.css .pad-layout > .side-controls',
    'src/pages/MusicMaker/styles/miyamaker.css .coach-card',
    'src/pages/MusicMaker/styles/miyamaker.css .manual-side',
    'src/pages/MusicMaker/styles/miyamaker.css .manual-read',
    'src/pages/MusicMaker/styles/miyamaker.css .manual-pop',
    'src/pages/MusicMaker/styles/miyamaker.css .strum-picker',
    // TODO (owner): these can be wider than their box, so they scroll sideways. Make them `overflow: hidden auto`
    // with wrapping (overflow-wrap: anywhere; white-space: pre-wrap for a <pre>), or fit them; then delete the entry.
    // A description with a long link or word (pre-wrap breaks only at spaces).
    'src/desktop/files/Properties.tsx .desc',
    // A notice or error with a long unbroken word.
    'src/components/Notification/Message/index.tsx > div',
    'src/components/Errors/ErrorMessage/index.tsx > div',
    // A <pre> of JSON: long lines scroll sideways.
    'src/pages/DropMusic/index.tsx Json',
    // A row of panes and a resize gutter: narrower than the panes, it scrolls sideways.
    'src/pages/MiyaMakerStudio/index.tsx Panes',
    // The old manager's tables.
    'src/pages/Manage/Legacy.tsx SunkenPanel',
    // The sequencer's grid, wider than the window when zoomed in: decide whether a zoomable grid may pan sideways.
    'src/pages/MusicMaker/styles/miyamaker.css .part',
  ]
  const named = (h: string) => h.replace(/:\d+ /, ' ')
  const found = SRC_CSS.flatMap((p) => sidewaysScrollers(p)).filter(
    (h) => !ALLOW.some((a) => named(h) === a || h.split(':')[0] === a)
  )
  assert.deepEqual(found, [])
})

test('the sideways rule catches every way of writing it, and lets a vertical-only scroller be', () => {
  const css = `.a { overflow-x: auto; }
.b { overflow: auto; }
.c { overflow: scroll hidden; }
.d { overflow: hidden auto; }
.e { overflow-y: auto; }
.f { overflow: hidden; }`
  assert.deepEqual(sidewaysScrollers('x.css', css), ['x.css:1 .a', 'x.css:2 .b', 'x.css:3 .c'])
  const js = [
    'const Box = styled.div`',
    '  overflow: auto;',
    '`',
    "el.style.overflowX = 'scroll'",
    "el.style.overflow = 'auto'",
    "el.style.overflowY = 'auto'",
    "const s = { overflowX: 'auto' }",
    "const t = { overflow: 'scroll' }",
    "const u = { overflow: 'hidden' }",
    '',
  ].join('\n')
  const found = sidewaysScrollers('x.tsx', js)
  assert.deepEqual(found.map((h) => h.split(' ')[0]), ['x.tsx:2', 'x.tsx:4', 'x.tsx:5', 'x.tsx:7', 'x.tsx:8'])
  assert.equal(found[0], 'x.tsx:2 Box')
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
