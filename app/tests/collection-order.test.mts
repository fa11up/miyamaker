// Collection page order (src/pages/Swap/nft/CollectionView.tsx): what's for sale comes first, and the gallery only
// shows when nothing is for sale. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { code } from './source-scan.mts'

const view = code('src/pages/Swap/nft/CollectionView.tsx')
const at = (needle: string) => {
  const i = view.indexOf(needle)
  assert.ok(i >= 0, `missing ${needle}`)
  return i
}

test('for sale and the sweep come right after the header, before yours and the gallery', () => {
  const header = at('data-collection-view')
  const forSale = at('aria-label="Cheapest for sale"')
  const sweep = at('aria-label="Sweep the floor"')
  const yours = at('aria-label="Yours"')
  const gallery = at('aria-label="Gallery"')
  assert.ok(header < forSale && forSale < sweep && sweep < yours && yours < gallery)
})

test('the gallery shows (and loads) only once listings answer with none for sale', () => {
  assert.match(view, /const showGallery = !listings\.loading && listed\.length === 0/)
  assert.match(view, /useCollectionGallery\(showGallery \? os\.slug : undefined\)/)
  assert.match(view, /\{showGallery && \(\s*<Card aria-label="Gallery"/)
})
