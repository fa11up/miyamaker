import styled from 'styled-components/macro'

import { useRadio, useRadioClock } from '@/context/RadioProvider'
import { formatDuration } from '@/music/audio'
import { useOpenApp } from '@/music/useOpenApp'
import { Glyph } from '@/pages/Radio/Glyph'
import { feather, HEART_PATH } from '@/pages/Radio/heartGeometry'
import { Bead, Marquee, PixelText } from '@/pages/Radio/parts'
import { skinById } from '@/pages/Radio/skins'
import { useWindows } from '@/store/windows/hooks'
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

/* The minimized radio: a small chrome capsule of its own, right beside the wave button. */
const Dock = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  margin-right: 5px;
  padding: 0 4px 0 2px;
  border-radius: 12px;
  background: linear-gradient(180deg, #f6f8ff 0%, #a4adc6 34%, #4b5270 50%, #dfe5f5 56%, #8089a6 80%, #2c3048 100%);
  box-shadow: 0 0 0 1px #10101d, inset 0 1px 0 rgba(255, 255, 255, 0.8);
`

const DockHeart = styled.button`
  all: unset;
  display: block;
  flex: 0 0 auto;
  width: 30px;
  height: 22px;
  cursor: pointer;
  svg {
    display: block;
    filter: drop-shadow(0 1px 1px rgba(2, 1, 10, 0.7));
  }
  &:hover {
    filter: brightness(1.2);
  }
  &:focus-visible {
    outline: 1px dotted #fff;
  }
`

const DockGlass = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 5px;
  height: 14px;
  padding: 0 5px;
  border-radius: 3px;
  color: var(--rk-lcd-ink);
  background: var(--rk-lcd);
  box-shadow: 0 0 0 1px #0a0814, inset 0 1px 2px rgba(0, 0, 0, 0.45);
  cursor: pointer;
  @media (max-width: 768px) {
    display: none;
  }
`

const DOCK_FEATHERS = [
  { angle: 34, length: 300 },
  { angle: 12, length: 320 },
  { angle: -10, length: 280 },
]

function MiniHeart() {
  return (
    <svg width="30" height="22" viewBox="0 0 1000 735" aria-hidden="true">
      <defs>
        <linearGradient id="dock-chrome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#59648a" />
          <stop offset="0.55" stopColor="#e3e9f8" />
          <stop offset="1" stopColor="#262c48" />
        </linearGradient>
      </defs>
      {(['left', 'right'] as const).map((side) =>
        DOCK_FEATHERS.map((f) => (
          <path
            key={`${side}${f.angle}`}
            d={feather(side, f.angle, f.length, 44).d}
            fill="url(#dock-chrome)"
            stroke="#05060e"
            strokeWidth="12"
          />
        ))
      )}
      <path d={HEART_PATH} fill="#2a1048" stroke="url(#dock-chrome)" strokeWidth="60" />
    </svg>
  )
}

/** Its own place on the taskbar while minimized: click the heart or the glass to bring the radio back. */
function RadioDock() {
  const radio = useRadio()
  const clock = useRadioClock()
  const openApp = useOpenApp()
  const { current, playing } = radio
  const restore = () => openApp('radio')
  const label = current ? `${current.artist ? `${current.artist} - ` : ''}${current.title}` : 'MIYA RADIO'
  return (
    <Dock style={skinById('classic').vars} role="group" aria-label="miya radio, minimized">
      <DockHeart type="button" aria-label="Open miya radio" title="Open miya radio" onClick={restore}>
        <MiniHeart />
      </DockHeart>
      <DockGlass onClick={restore} title={label} aria-hidden="true">
        {current && <PixelText text={formatDuration(clock.time)} />}
        <Marquee value={label} width={70} />
      </DockGlass>
      <Bead
        $orb
        $lit={playing}
        $size={18}
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        title={playing ? 'Pause' : 'Play'}
        disabled={!current}
        onClick={radio.toggle}
      >
        <Glyph kind={playing ? 'pause' : 'play'} size={9} />
      </Bead>
      <Bead $size={16} aria-label="Next track" title="Next" disabled={!current} onClick={radio.next}>
        <Glyph kind="next" size={8} />
      </Bead>
    </Dock>
  )
}

/**
 * Compact miya radio control in the taskbar's notification area. Shown once something is queued, so music
 * can be paused or resumed while the radio window is minimized or closed.
 */
export default function RadioTray({ showTitle = true }: { showTitle?: boolean }) {
  const radio = useRadio()
  const openApp = useOpenApp()
  const { current, playing } = radio
  const [windows, , , minimized] = useWindows()
  if (windows.includes('radio') && minimized.includes('radio')) return <RadioDock />
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
