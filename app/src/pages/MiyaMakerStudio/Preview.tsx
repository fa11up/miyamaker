import styled from 'styled-components/macro'

import { font, space } from '@/theme/tokens'

import { pink } from './chrome'

import type { Trait } from './model'

const Strip = styled.div`
  padding: ${space[1]} ${space[2]};
  background: ${pink.blush};
  color: ${pink.ink};
  font-family: ${font.ui};
  font-size: 12px;

  .names {
    color: ${pink.inkMuted};
  }
`

/** Names of the worn stack, back to front. The pictures themselves are on the canvas. */
export default function Preview({ traits }: { traits: Trait[] }) {
  return (
    <Strip>
      <div>Wearing</div>
      <div className="names">{traits.length ? traits.map((trait) => trait.name).join(' · ') : 'Pick a trait in each layer.'}</div>
    </Strip>
  )
}
