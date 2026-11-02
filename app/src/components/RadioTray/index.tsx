import styled from 'styled-components/macro'

import { useRadio } from '@/context/RadioProvider'
import { useOpenApp } from '@/music/useOpenApp'
import { Glyph } from '@/pages/Radio/Glyph'
import { bevel, color, text } from '@/theme/tokens'

const Tray = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  height: 100%;
  padding-right: 4px;
  margin-right: 2px;
  border-right: 1px solid ${color.shadow};
  box-shadow: 1px 0 0 ${color.highlight};
`

const TrayButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 22px;
  min-width: 22px;
  padding: 0 4px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: ${color.ink};
  font-size: ${text.xs};
  cursor: pointer;
  &:hover {
    background: ${color.faceLight};
  }
  &:active {
    box-shadow: ${bevel.pressed};
  }
  &:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: -3px;
  }
  &.playing {
    color: ${color.accentDark};
  }
  span {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (max-width: 768px) {
    min-width: 30px;
    height: 32px;
    padding: 0 2px;
    span {
      display: none;
    }
  }
`

/**
 * Compact miya radio control in the taskbar's notification area. Shown once something is queued, so music
 * can be paused or resumed while the radio window is minimized or closed.
 */
export default function RadioTray({ showTitle = true }: { showTitle?: boolean }) {
  const radio = useRadio()
  const openApp = useOpenApp()
  const { current, playing } = radio
  if (!current) return null
  const label = `${current.artist ? `${current.artist} - ` : ''}${current.title}`
  return (
    <Tray aria-label="miya radio">
      <TrayButton
        type="button"
        className={playing ? 'playing' : undefined}
        onClick={radio.toggle}
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        title={`${playing ? 'Pause' : 'Play'}: ${label}`}
      >
        <Glyph kind={playing ? 'pause' : 'play'} />
      </TrayButton>
      <TrayButton
        type="button"
        className={playing ? 'playing' : undefined}
        onClick={() => openApp('radio')}
        aria-label={`Open miya radio, now ${playing ? 'playing' : 'paused'}: ${label}`}
        title={`miya radio · ${playing ? 'playing' : 'paused'}: ${label}`}
      >
        <Glyph kind="note" />
        {showTitle && <span>{current.title}</span>}
      </TrayButton>
    </Tray>
  )
}
