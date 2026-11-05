import Waves from 'assets/waves.png?preset=icon&resize=true'
import WavesBw from 'assets/waves_bw.png?preset=icon&resize=true'
import styled from 'styled-components/macro'

import Pages from '@/constants/pages'
import { useAccount } from '@/context/AccountProvider'
import { useWaves } from '@/store/experience/hooks'
import { useWindows } from '@/store/windows/hooks'
import { bevel, color, text } from '@/theme/tokens'

import { ButtonIcon, HighlightButton } from '../Button'
import RadioTray from '../RadioTray'
import { VerticalSeparator } from '../Separator'
import StartButton from './StartButton'

const NoScroll = styled.div`
  overflow: hidden;
`

const TaskBarStyled = styled.div`
  position: relative;
  z-index: 10;
  background-color: ${color.face};
  height: var(--taskbar-h);
  padding: 4px 4px 3px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 4px;
  font-size: ${text.sm};
  box-shadow: inset 0 1px 0 ${color.light}, inset 0 2px 0 ${color.highlight};
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: max(3px, env(safe-area-inset-bottom));
`

// Every program gets the same width; they all narrow together once the bar fills up.
const TaskButton = styled(HighlightButton)`
  height: 100%;
  flex: 0 1 160px;
  && {
    min-width: 0;
  }
  justify-content: flex-start;
  padding: 0 10px 0 6px;
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const MobileButton = styled(HighlightButton)`
  height: 100%;
  min-width: 44px;
  padding: 0 12px;
  font-size: ${text.sm};
`

const Row = styled.div`
  display: flex;
  flex-shrink: 0;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  height: 100%;
`

const ButtonContainer = styled.div`
  height: 100%;
  display: flex;
  flex-shrink: 0;
  flex-direction: row;
  gap: 3px;
  align-items: start;
`

// The desktop's program list takes whatever the Start button and the tray leave free.
const TaskRow = styled(Row)`
  flex: 1 1 0;
  min-width: 0;
  > * {
    flex-shrink: 0;
  }
  > ${ButtonContainer} {
    flex: 1 1 0;
    min-width: 0;
  }
`

const MobileButtons = styled(ButtonContainer)`
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
`

const InsetContainer = styled.div`
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: end;
  height: 100%;
  padding: 0 4px;
  box-shadow: ${bevel.sunken};
  font-size: ${text.xs};
`

const BlockNumber = styled.div`
  padding: 0 8px 0 12px;
`

export default function TaskBar({
  active,
  focus,
  onClick,
  mobile,
  onOpenSwitcher,
  onHome,
}: {
  active: string[]
  focus: string | undefined
  onClick: (id: string) => void
  mobile?: boolean
  onOpenSwitcher?: () => void
  onHome?: () => void
}) {
  const [waves, toggleWaves] = useWaves()
  const { block } = useAccount()
  const [, , , minimized] = useWindows()
  const Left = mobile ? Row : TaskRow

  return (
    <NoScroll>
      <TaskBarStyled>
        <Left>
          <StartButton />
          <VerticalSeparator />
          {mobile ? (
            <MobileButtons>
              <MobileButton className="free-height" onClick={onHome}>
                Desktop
              </MobileButton>
              <MobileButton className="free-height" onClick={onOpenSwitcher} title="Switch programs">
                Programs{active.length ? ` (${active.length})` : ''}
              </MobileButton>
            </MobileButtons>
          ) : (
            <ButtonContainer>
              {/* The minimized radio lives in its dock by the wave button instead. */}
              {active
                .filter((id) => !(id === 'radio' && minimized.includes(id)))
                .map((id) => {
                  const page = Pages[id]!
                  return (
                    <TaskButton
                      key={`${id}-taskbar`}
                      className={`free-height free-width ${focus === id ? 'focus-taskbar' : ''}`}
                      onClick={() => onClick(id)}
                      title={page.label}
                      aria-pressed={focus === id && !minimized.includes(id)}
                    >
                      <img
                        src={page.icon?.src}
                        srcSet={page.icon?.srcset}
                        sizes="(min-width: 1px) 16px, 60px"
                        width={16}
                        height={16}
                        style={{ minWidth: 16, width: 16, border: 'none', margin: 0 }}
                        alt=""
                      />
                      <span>{page.label}</span>
                    </TaskButton>
                  )
                })}
            </ButtonContainer>
          )}
        </Left>
        <Row>
          <VerticalSeparator />
          <InsetContainer>
            <RadioTray showTitle={!mobile} />
            <ButtonIcon
              onClick={() => toggleWaves()}
              aria-label="Wave background"
              aria-pressed={waves}
              title={waves ? 'Wave: on' : 'Wave: off'}
              data-pet-poke="wave"
            >
              <img
                src={waves ? Waves[0]?.src : WavesBw[0]?.src}
                srcSet={waves ? Waves[0]?.srcset : WavesBw[0]?.srcset}
                sizes="(min-width: 1px) 16px, 60px"
                width={16}
                height={16}
                style={{ minWidth: 16, width: 16, border: 'none' }}
                alt=""
              />
            </ButtonIcon>
            {block && !mobile && (
              <BlockNumber title="Latest Ethereum block. A new one comes about every 12 seconds; if this number moves, you are online.">
                {block}
              </BlockNumber>
            )}
          </InsetContainer>
        </Row>
      </TaskBarStyled>
    </NoScroll>
  )
}
