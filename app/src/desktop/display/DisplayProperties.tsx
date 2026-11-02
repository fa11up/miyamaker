import Fumo from 'assets/pet/fumo-96.webp'
import styled from 'styled-components/macro'

import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { bevel, color, MOBILE_BREAKPOINT, space, text } from '@/theme/tokens'

import { PETS } from '../pet/registry'
import { setPrefs, startScreensaverPreview, useDesktopPrefs } from '../prefs'
import { DELAY_CHOICES_MIN } from '../screensaver/idle'

const ID = 'display'

const Root = styled.div`
  overflow: auto;
  padding: ${space[3]};
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  color: ${color.ink};
  font-size: ${text.sm};
`

/* The little CRT from Win9x Display Properties, showing what the screensaver looks like. */
const Monitor = styled.div`
  align-self: center;
  width: 196px;
  padding: 10px 10px 18px;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  position: relative;
  .screen {
    height: 118px;
    box-shadow: ${bevel.sunken};
    background: radial-gradient(circle at 20% 30%, #fff 0 1px, transparent 1.5px),
      radial-gradient(circle at 70% 20%, ${color.accent} 0 1px, transparent 1.5px),
      radial-gradient(circle at 40% 80%, #c9b8ff 0 1px, transparent 1.5px),
      radial-gradient(circle at 85% 70%, #fff 0 1px, transparent 1.5px),
      linear-gradient(180deg, #0f0b1c, #241c45 60%, #4a3a78);
    display: grid;
    place-items: center;
  }
  .screen img {
    border: none !important;
    margin: 0;
    height: 74px;
    width: auto;
    max-width: none;
    filter: drop-shadow(0 0 8px ${color.accent});
  }
  .screen.off {
    background: ${color.dark};
  }
  .screen.off img {
    display: none;
  }
  &::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -12px;
    width: 80px;
    margin-left: -40px;
    height: 12px;
    background: ${color.face};
    box-shadow: ${bevel.raised};
  }
`

const Group = styled.fieldset`
  margin: 0;
  padding: ${space[3]};
  border: none;
  box-shadow: ${bevel.sunken}, inset 3px 3px 0 ${color.face};
  outline: 1px solid ${color.highlight};
  outline-offset: -2px;
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  legend {
    padding: 0 ${space[1]};
    background: ${color.face};
  }
  label {
    display: flex;
    align-items: center;
    gap: ${space[2]};
    cursor: pointer;
  }
  input[type='checkbox'] {
    width: 16px;
    height: 16px;
    accent-color: ${color.accentDark};
  }
  select {
    min-height: 28px;
    padding: 0 ${space[1]};
    border: none;
    border-radius: 0;
    background: ${color.well};
    box-shadow: ${bevel.field};
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${space[2]};
  }
  .hint {
    font-size: ${text.xs};
    color: ${color.inkMuted};
    line-height: 1.35;
  }
  button {
    min-height: 28px;
    padding: 0 ${space[3]};
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    cursor: pointer;
    &:active {
      box-shadow: ${bevel.pressed};
    }
  }
  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    select,
    button {
      min-height: 44px;
    }
    input[type='checkbox'] {
      width: 22px;
      height: 22px;
    }
  }
`

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  button {
    min-width: 88px;
    min-height: 30px;
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    outline: 1px solid ${color.dark};
    outline-offset: -1px;
    cursor: pointer;
  }
`

export default function DisplayProperties() {
  const dispatch = useAppDispatch()
  const prefs = useDesktopPrefs()
  const close = () => dispatch(closeWindow({ value: ID }))
  const pets = Object.values(PETS)

  return (
    <WindowWrapper>
      <TitleBar minimizeBtn closeBtn onMinimize={() => dispatch(minimizeWindow({ value: ID }))} onClose={close}>
        Display Properties
      </TitleBar>
      <Root data-display-properties="">
        <Monitor aria-hidden>
          <div className={`screen ${prefs.screensaverEnabled ? '' : 'off'}`}>
            <img src={Fumo} alt="" />
          </div>
        </Monitor>

        <Group>
          <legend>Screen Saver</legend>
          <label>
            <input
              type="checkbox"
              checked={prefs.screensaverEnabled}
              onChange={(e) => setPrefs({ screensaverEnabled: e.target.checked })}
            />
            Miya Starfield (fumo dolls + collection art)
          </label>
          <div className="row">
            <label htmlFor="ss-wait">Wait:</label>
            <select
              id="ss-wait"
              value={prefs.screensaverDelay}
              disabled={!prefs.screensaverEnabled}
              onChange={(e) => setPrefs({ screensaverDelay: Number(e.target.value) })}
            >
              {!DELAY_CHOICES_MIN.includes(prefs.screensaverDelay as (typeof DELAY_CHOICES_MIN)[number]) && (
                <option value={prefs.screensaverDelay}>{prefs.screensaverDelay} minutes</option>
              )}
              {DELAY_CHOICES_MIN.map((m) => (
                <option key={m} value={m}>
                  {m} minute{m === 1 ? '' : 's'}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => startScreensaverPreview()} data-preview-screensaver="">
              Preview
            </button>
          </div>
          <div className="hint">
            Never starts while you type, while a wallet prompt is open or while a transaction is confirming.
          </div>
        </Group>

        <Group>
          <legend>Desktop Pet</legend>
          <label>
            <input
              type="checkbox"
              checked={prefs.petEnabled}
              onChange={(e) => setPrefs({ petEnabled: e.target.checked })}
              data-pet-toggle=""
            />
            Show a desktop pet
          </label>
          {pets.length > 1 && (
            <div className="row">
              <label htmlFor="pet-pick">Pet:</label>
              <select id="pet-pick" value={prefs.petId} onChange={(e) => setPrefs({ petId: e.target.value })}>
                {pets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="hint">Poke it, drag it around, or right-click the desktop to hide it.</div>
        </Group>

        <Group>
          <legend>Live Mints</legend>
          <label>
            <input
              type="checkbox"
              checked={prefs.mintFeedEnabled}
              onChange={(e) => setPrefs({ mintFeedEnabled: e.target.checked })}
            />
            Celebrate new mints (toast + confetti)
          </label>
        </Group>

        <Footer>
          <button type="button" onClick={close}>
            OK
          </button>
        </Footer>
      </Root>
    </WindowWrapper>
  )
}
