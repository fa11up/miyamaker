import Fumo from 'assets/pet/fumo-96.webp'
import type { KeyboardEvent } from 'react'
import { useId, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { bevel, color, focusRing, MOBILE_BREAKPOINT, space, text } from '@/theme/tokens'

import { PETS } from '../pet/registry'
import type { DesktopPrefs } from '../prefs'
import { setPrefs, startScreensaverPreview, useDesktopPrefs } from '../prefs'
import { DELAY_CHOICES_MIN } from '../screensaver/idle'

const ID = 'display'
const MOBILE = `@media (max-width: ${MOBILE_BREAKPOINT}px)`

const TABS = [
  { id: 'screensaver', title: 'Screen Saver' },
  { id: 'desktop', title: 'Desktop' },
] as const
type TabId = (typeof TABS)[number]['id']

/* Dialog layout: tab strip, a panel that takes the spare height, and the button row pinned to the bottom. */
const Root = styled.form`
  display: flex;
  flex-direction: column;
  padding: ${space[2]} ${space[2]} ${space[3]};
  color: ${color.ink};
  font-size: ${text.sm};
  line-height: 1.25;

  button,
  select {
    font: inherit;
    color: ${color.ink};
  }
  button:focus-visible,
  select:focus-visible {
    ${focusRing}
  }
  input[type='checkbox']:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: 2px;
  }

  ${MOBILE} {
    padding: ${space[3]};
  }
`

const TabStrip = styled.div`
  flex: 0 0 auto;
  display: flex;
  padding-left: 2px;
  position: relative;
  z-index: 1;
  margin-bottom: -2px;

  button {
    min-height: 24px;
    padding: 2px ${space[3]} 0;
    margin-top: 2px;
    border: none;
    border-radius: 3px 3px 0 0;
    background: ${color.face};
    box-shadow: inset 1px 1px ${color.highlight}, inset 2px 2px ${color.light}, inset -1px 0 ${color.dark},
      inset -2px 0 ${color.shadow};
    cursor: pointer;
    white-space: nowrap;
  }
  /* The selected tab grows up a little and merges with the panel below it. */
  button[aria-selected='true'] {
    position: relative;
    min-height: 28px;
    margin: 0 -2px;
    padding-bottom: 2px;
    z-index: 2;
  }

  ${MOBILE} {
    button {
      flex: 1 1 0;
      min-height: 40px;
    }
    button[aria-selected='true'] {
      min-height: 44px;
    }
  }
`

const Panel = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  padding: ${space[3]};
  background: ${color.face};
  box-shadow: ${bevel.raised};

  @media (max-width: 360px) {
    padding: ${space[3]} ${space[2]};
  }
`

/* The little CRT from Win9x Display Properties, showing what the screensaver looks like. */
const Monitor = styled.div`
  flex: 0 0 auto;
  align-self: center;
  display: flex;
  flex-direction: column;
  align-items: center;

  .case {
    padding: 9px 9px 14px;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    position: relative;
  }
  /* power LED */
  .case::after {
    content: '';
    position: absolute;
    right: 10px;
    bottom: 5px;
    width: 4px;
    height: 4px;
    background: #6be38a;
    box-shadow: inset -1px -1px ${color.shadow};
  }
  .case.off::after {
    background: ${color.shadow};
  }
  .screen {
    width: 160px;
    height: 120px;
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
    height: 72px;
    width: auto;
    max-width: none;
    filter: drop-shadow(0 0 8px ${color.accent});
  }
  .off .screen {
    background: ${color.dark};
  }
  .off .screen img {
    display: none;
  }
  /* Short phones: a smaller CRT so the settings fit without scrolling. */
  @media (max-height: 640px) {
    .screen {
      width: 120px;
      height: 90px;
    }
    .screen img {
      height: 54px;
    }
  }
  .neck {
    width: 40px;
    height: 8px;
    background: ${color.face};
    box-shadow: inset 1px 0 ${color.highlight}, inset -1px 0 ${color.dark}, inset -2px 0 ${color.shadow};
  }
  .base {
    width: 104px;
    height: 10px;
    background: ${color.face};
    box-shadow: ${bevel.raised};
  }
`

/* Etched Win98 group box. Real borders (not box-shadow) so the legend notches the top line cleanly. */
const Group = styled.fieldset`
  flex: 0 0 auto;
  min-width: 0;
  margin: 0;
  padding: ${space[2]} ${space[3]} ${space[3]};
  border: 1px solid ${color.shadow};
  box-shadow: 1px 1px 0 ${color.highlight}, inset 1px 1px 0 ${color.highlight};
  display: flex;
  flex-direction: column;
  gap: ${space[2]};

  legend {
    padding: 0 ${space[1]};
    margin-left: -${space[1]};
    background: ${color.face};
  }
  .check {
    display: flex;
    align-items: center;
    gap: ${space[2]};
    min-height: 24px;
    cursor: pointer;
  }
  input[type='checkbox'] {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: ${color.accentDark};
    cursor: pointer;
  }
  /* Label column + control column, so "Wait:" and "Pet:" line up with each other and with the checkbox text. */
  .field {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    column-gap: ${space[2]};
    padding-left: 24px;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${space[2]};
  }
  select {
    min-width: 0;
    flex: 0 1 132px;
    min-height: 26px;
    padding: 0 ${space[1]};
    border: none;
    border-radius: 0;
    background: ${color.well};
    box-shadow: ${bevel.field};
  }
  select:disabled {
    color: ${color.inkMuted};
    background: ${color.faceLight};
  }
  .hint {
    margin: 0;
    padding-left: 24px;
    font-size: ${text.xs};
    color: ${color.inkMuted};
    line-height: 1.4;
  }
  .disabled {
    color: ${color.inkMuted};
  }

  ${MOBILE} {
    select {
      min-height: 44px;
    }
    /* If Preview has to wrap under the dropdown, keep "Wait:" on the dropdown's line. */
    .field > label {
      align-self: start;
      line-height: 44px;
    }
    .check {
      min-height: 44px;
    }
    input[type='checkbox'] {
      width: 22px;
      height: 22px;
    }
    .field,
    .hint {
      padding-left: 30px;
    }
  }
  @media (max-width: 360px) {
    padding-left: ${space[2]};
    padding-right: ${space[2]};
    select {
      flex: 1 1 96px;
    }
    .controls button {
      min-width: 0;
    }
  }
`

const Button = styled.button`
  min-width: 80px;
  min-height: 26px;
  padding: 0 ${space[3]};
  border: none;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  cursor: pointer;
  white-space: nowrap;

  &:active:not(:disabled) {
    box-shadow: ${bevel.pressed};
  }
  &:disabled {
    color: ${color.shadow};
    text-shadow: 1px 1px ${color.highlight};
    cursor: default;
  }
  /* Default button (Enter) gets the extra black frame, as in Win98. */
  &[data-default] {
    outline: 1px solid ${color.dark};
    outline-offset: -1px;
  }

  ${MOBILE} {
    min-height: 44px;
  }
`

const Footer = styled.div`
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding-top: ${space[3]};

  ${MOBILE} {
    gap: ${space[2]};
    ${Button} {
      flex: 1 1 0;
      min-width: 0;
    }
  }
`

const LookPreview = styled.img`
  height: auto;
  border: none;
  image-rendering: pixelated;

  :hover {
    border: none;
  }
`

export default function DisplayProperties() {
  const dispatch = useAppDispatch()
  const prefs = useDesktopPrefs()
  const uid = useId()
  const [tab, setTab] = useState<TabId>('screensaver')
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  // Edits are held here until OK/Apply, like the real dialog; Cancel throws them away.
  const [pending, setPending] = useState<Partial<DesktopPrefs>>({})
  const shown: DesktopPrefs = { ...prefs, ...pending }
  const dirty = (Object.keys(pending) as (keyof DesktopPrefs)[]).some((k) => pending[k] !== prefs[k])
  const edit = (patch: Partial<DesktopPrefs>) => setPending((p) => ({ ...p, ...patch }))

  const close = () => dispatch(closeWindow({ value: ID }))
  const apply = () => {
    if (dirty) setPrefs(pending)
    setPending({})
  }

  const ok = () => {
    apply()
    close()
  }

  const pets = Object.values(PETS)
  const selectedPet = PETS[shown.petId]
  const chosenLook = selectedPet?.variants?.find((v) => v.id === shown.petVariant)
  const delayKnown = DELAY_CHOICES_MIN.includes(shown.screensaverDelay as (typeof DELAY_CHOICES_MIN)[number])

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    if (!step) return
    e.preventDefault()
    const i = TABS.findIndex((t) => t.id === tab)
    const next = TABS[(i + step + TABS.length) % TABS.length]?.id ?? tab
    setTab(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <WindowWrapper>
      <TitleBar minimizeBtn closeBtn onMinimize={() => dispatch(minimizeWindow({ value: ID }))} onClose={close}>
        Display Properties
      </TitleBar>
      <Root
        data-display-properties=""
        onSubmit={(e) => {
          e.preventDefault()
          ok()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            close()
          }
        }}
      >
        <TabStrip role="tablist" aria-label="Display Properties">
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el
              }}
              type="button"
              role="tab"
              id={`${uid}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${uid}-panel`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={onTabKey}
            >
              {t.title}
            </button>
          ))}
        </TabStrip>

        <Panel role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`}>
          {tab === 'screensaver' && (
            <>
              <Monitor aria-hidden>
                <div className={`case ${shown.screensaverEnabled ? '' : 'off'}`}>
                  <div className="screen">
                    <img src={Fumo} alt="" />
                  </div>
                </div>
                <div className="neck" />
                <div className="base" />
              </Monitor>

              <Group>
                <legend>Screen Saver</legend>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={shown.screensaverEnabled}
                    onChange={(e) => edit({ screensaverEnabled: e.target.checked })}
                  />
                  Miya Starfield (fumo dolls + collection art)
                </label>
                <div className="field">
                  <label htmlFor={`${uid}-wait`} className={shown.screensaverEnabled ? '' : 'disabled'}>
                    Wait:
                  </label>
                  <div className="controls">
                    <select
                      id={`${uid}-wait`}
                      value={shown.screensaverDelay}
                      disabled={!shown.screensaverEnabled}
                      onChange={(e) => edit({ screensaverDelay: Number(e.target.value) })}
                    >
                      {!delayKnown && <option value={shown.screensaverDelay}>{shown.screensaverDelay} minutes</option>}
                      {DELAY_CHOICES_MIN.map((m) => (
                        <option key={m} value={m}>
                          {m} minute{m === 1 ? '' : 's'}
                        </option>
                      ))}
                    </select>
                    <Button type="button" onClick={() => startScreensaverPreview()} data-preview-screensaver="">
                      Preview
                    </Button>
                  </div>
                </div>
                <p className="hint">
                  Never starts while you type, while a wallet prompt is open or while a transaction is confirming.
                </p>
              </Group>
            </>
          )}

          {tab === 'desktop' && (
            <>
              <Group>
                <legend>Desktop Pet</legend>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={shown.petEnabled}
                    onChange={(e) => edit({ petEnabled: e.target.checked })}
                    data-pet-toggle=""
                  />
                  Show a desktop pet
                </label>
                {pets.length > 1 && (
                  <div className="field">
                    <label htmlFor={`${uid}-pet`} className={shown.petEnabled ? '' : 'disabled'}>
                      Pet:
                    </label>
                    <div className="controls">
                      <select
                        id={`${uid}-pet`}
                        value={shown.petId}
                        disabled={!shown.petEnabled}
                        onChange={(e) => edit({ petId: e.target.value })}
                      >
                        {pets.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                {!!selectedPet?.variants?.length && (
                  <div className="field">
                    <label htmlFor={`${uid}-look`} className={shown.petEnabled ? '' : 'disabled'}>
                      Which:
                    </label>
                    <div className="controls">
                      <select
                        id={`${uid}-look`}
                        value={shown.petVariant}
                        disabled={!shown.petEnabled}
                        onChange={(e) => edit({ petVariant: e.target.value })}
                      >
                        <option value="">Surprise me</option>
                        {selectedPet.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                      {chosenLook && (
                        <LookPreview src={chosenLook.src} alt={chosenLook.name} style={{ width: chosenLook.w * 2 }} />
                      )}
                    </div>
                  </div>
                )}
                <p className="hint">Poke it, drag it around, or right-click the desktop to hide it.</p>
              </Group>

              <Group>
                <legend>Live Mints</legend>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={shown.mintFeedEnabled}
                    onChange={(e) => edit({ mintFeedEnabled: e.target.checked })}
                  />
                  Celebrate new mints (toast + confetti)
                </label>
              </Group>
            </>
          )}
        </Panel>

        <Footer>
          <Button type="submit" data-default="">
            OK
          </Button>
          <Button type="button" onClick={close}>
            Cancel
          </Button>
          <Button type="button" onClick={apply} disabled={!dirty}>
            Apply
          </Button>
        </Footer>
      </Root>
    </WindowWrapper>
  )
}
