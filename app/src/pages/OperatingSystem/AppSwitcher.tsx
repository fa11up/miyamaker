import styled from 'styled-components/macro'

import Pages from '@/constants/pages'
import type { PageKey } from '@/store/windows/reducer'
import { bevel, color, space, text } from '@/theme/tokens'

import type { DesktopApp } from './index'

const Backdrop = styled.div`
  position: fixed;
  inset: 0 0 var(--taskbar-h) 0;
  z-index: 50000;
  background: rgba(20, 16, 31, 0.45);
  display: flex;
  align-items: flex-end;
`

const Sheet = styled.div`
  width: 100%;
  max-height: 80%;
  overflow: auto;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  padding: 3px;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 ${space[3]};
  background: linear-gradient(90deg, ${color.titleFrom}, ${color.titleTo});
  color: ${color.highlight};
  font-weight: 700;
  font-size: ${text.md};
`

const Section = styled.div`
  padding: ${space[3]};
  h3 {
    font-size: ${text.xs};
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: ${color.inkMuted};
    margin-bottom: ${space[2]};
  }
`

const Row = styled.div<{ active?: boolean }>`
  display: flex;
  align-items: center;
  gap: ${space[3]};
  min-height: 48px;
  padding: 0 ${space[2]};
  background: ${({ active }) => (active ? color.well : 'transparent')};
  box-shadow: ${({ active }) => (active ? bevel.sunken : 'none')};
  button.open {
    flex: 1;
    display: flex;
    align-items: center;
    gap: ${space[3]};
    min-height: 44px;
    border: none;
    background: none;
    text-align: left;
    font-size: ${text.md};
    cursor: pointer;
  }
  img {
    width: 28px;
    height: 28px;
    object-fit: contain;
    border: none;
    margin: 0;
    image-rendering: pixelated;
  }
`

const SmallButton = styled.button`
  min-width: 44px;
  min-height: 36px;
  border: none;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  font-size: ${text.sm};
  &:active {
    box-shadow: ${bevel.pressed};
  }
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${space[2]};
  button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${space[1]};
    padding: ${space[2]} ${space[1]};
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    font-size: ${text.sm};
    &:active {
      box-shadow: ${bevel.pressed};
    }
  }
  img {
    width: 36px;
    height: 36px;
    object-fit: contain;
    border: none;
    margin: 0;
  }
`

export default function AppSwitcher({
  open,
  focus,
  apps,
  onSelect,
  onClose,
  onDismiss,
}: {
  open: PageKey[]
  focus: PageKey | undefined
  apps: DesktopApp[]
  onSelect: (id: PageKey) => void
  onClose: (id: PageKey) => void
  onDismiss: () => void
}) {
  return (
    <Backdrop onClick={onDismiss}>
      <Sheet role="dialog" aria-label="App switcher" onClick={(e) => e.stopPropagation()}>
        <Header>
          <span>Programs</span>
          <SmallButton aria-label="Close switcher" onClick={onDismiss} style={{ minHeight: 28, minWidth: 36 }}>
            X
          </SmallButton>
        </Header>
        {open.length > 0 && (
          <Section>
            <h3>Open windows</h3>
            {open.map((id) => (
              <Row key={id} active={id === focus}>
                <button className="open" onClick={() => onSelect(id)}>
                  <img src={Pages[id]?.icon?.src} alt="" />
                  {Pages[id]?.label}
                </button>
                <SmallButton aria-label={`Close ${Pages[id]?.label}`} onClick={() => onClose(id)}>
                  X
                </SmallButton>
              </Row>
            ))}
          </Section>
        )}
        <Section>
          <h3>All programs</h3>
          <Grid>
            {apps.map((app) => (
              <button key={app.id} onClick={() => onSelect(app.id)}>
                <img src={app.src} alt="" />
                {app.label}
              </button>
            ))}
          </Grid>
        </Section>
      </Sheet>
    </Backdrop>
  )
}
