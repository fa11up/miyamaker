import styled from 'styled-components/macro'

import { useSticky } from '@/store/experience/hooks'

import Sticky from '../../assets/sticky.png'

const FourthWallStyled = styled.div`
  display: flex;
  justify-content: end;
  align-items: start;
  position: absolute;
  z-index: ${100_000};
  top: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  top: 0;
  left: 0;
  pointer-events: none;
  > * {
    pointer-events: auto;
  }

  ${({ theme }) => theme.mediaWidth.upToMedium`
    display: none;
  `}
`

// The note sits above every window on purpose (it is "stuck to the screen"), so only the paper itself may take
// clicks: the image ignores the pointer and two hit areas clipped to the paper's outline sit on top of it.
// Polygons are the old image-map coords as percentages of the 400x360 image.
const StickyNote = styled.div<{ fell?: boolean }>`
  position: relative;
  pointer-events: none !important;
  transition: all 5s cubic-bezier(0.25, 1, 0.5, 1);
  > img {
    display: block;
    pointer-events: none;
  }
  ${({ fell }) => fell && `transform: translate(0, 200vh) rotate(-80deg);`}
`

const HitArea = styled.a`
  position: absolute;
  inset: 0;
  pointer-events: auto;
  clip-path: polygon(9.25% 35.28%, 66.75% 10.56%, 69.75% 19.17%, 77.75% 16.11%, 93.75% 61.11%, 26.25% 89.17%);
`

const ThrowAway = styled.button`
  position: absolute;
  inset: 0;
  padding: 0;
  border: 0;
  background: transparent;
  pointer-events: auto;
  cursor: no-drop;
  clip-path: polygon(74.75% 7.22%, 66.75% 10.56%, 69.75% 19.17%, 77.75% 16.11%);
`

export default function FourthWall() {
  const [sticky, toggleSticky] = useSticky()
  return (
    <FourthWallStyled>
      <StickyNote fell={!sticky}>
        <img
          src={Sticky}
          alt=""
          style={{
            userSelect: 'none',
            width: '400px',
            maxWidth: '100%',
            height: 'auto',
            border: '0px solid transparent',
          }}
        />
        <HitArea
          aria-label="0118 999 881 999 119 725...3 (Tech Support!)"
          title="Miya Heaven Discord Server"
          href="https://discord.gg/SekBTQARMk"
          target="_blank"
          rel="noopener noreferrer"
        />
        <ThrowAway type="button" aria-label="Throw away note" title="Throw away note" onClick={() => toggleSticky()} />
      </StickyNote>
    </FourthWallStyled>
  )
}
