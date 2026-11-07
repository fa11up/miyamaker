import { useState } from 'react'
import styled from 'styled-components/macro'

import Carousel, { Glyph, PAINTED } from './Carousel'
import Device, { Lcd } from './Device'
import { setLook, tintOf, TINTS, useLook } from './look'
import { wrapIndex } from './status'

/** The system menu the device starts on: every game it holds, and how it looks. Each game has its own start menu. */

const Picker = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  background: ${PAINTED};
  color: #fff;
  h2 {
    margin: 0;
    text-align: center;
    font-size: 24px;
    font-weight: 400;
    text-shadow: 0 1px 3px rgba(20, 6, 60, 0.85);
  }
`

const Tints = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  button {
    all: unset;
    box-sizing: border-box;
    padding: 6px;
    border-radius: 8px;
    cursor: pointer;
    text-align: center;
    font-size: 13px;
    color: #fff;
    background: rgba(28, 20, 54, 0.82);
  }
  button[aria-pressed='true'] {
    box-shadow: 0 0 0 3px #fff;
  }
  button:focus-visible {
    outline: 2px dashed #fff35c;
    outline-offset: 2px;
  }
  em {
    display: block;
    height: 44px;
    margin-bottom: 5px;
    border-radius: 5px;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
  }
`

export default function GameSelect({ onMint, onFrenPet }: { onMint: () => void; onFrenPet: () => void }) {
  const look = useLook()
  const [lookOpen, setLookOpen] = useState(false)

  if (lookOpen) {
    const step = (by: number) => {
      const i = TINTS.findIndex((t) => t.id === look.tint)
      setLook({ tint: TINTS[wrapIndex(TINTS.length, i, by)]!.id })
    }
    const done = { label: 'Done', onClick: () => setLookOpen(false) }
    return (
      <Device
        title="Shell color"
        lamp={{ color: '#3dff7a', label: 'Shell color' }}
        screen={
          <Picker>
            <h2>Shell color</h2>
            <Tints>
              {TINTS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={look.tint === t.id}
                  onClick={() => setLook({ tint: t.id })}
                >
                  <em style={{ background: `linear-gradient(160deg, ${t.light}, ${t.deep})` }} />
                  {t.name}
                </button>
              ))}
            </Tints>
          </Picker>
        }
        lcd={
          <Lcd>
            <div>
              <span>Shell: {tintOf(look.tint).name}</span>
            </div>
            <div>
              <span>◀▶ Choose</span>
            </div>
            <div>
              <span>Ⓐ Done</span>
            </div>
          </Lcd>
        }
        a={done}
        b={{ label: 'Back', onClick: () => setLookOpen(false) }}
        select={{ label: 'Next color', onClick: () => step(1) }}
        start={done}
        dpad={{ left: () => step(-1), right: () => step(1) }}
      />
    )
  }

  return (
    <Carousel
      title="Games"
      lampLabel="Select a game"
      ariaLabel="Games"
      back={{ label: 'Back', disabled: true, onClick: () => {} }}
      items={[
        {
          key: 'mint',
          name: 'Mint',
          line: 'Collect miyamaker drops',
          action: 'Open Mint',
          open: onMint,
          pic: <Glyph $bg="linear-gradient(160deg, #ff6fbf, #7a2fd0)">♥</Glyph>,
        },
        {
          key: 'frenpet',
          name: 'Fren Pet',
          line: 'Watch a pet, live from Base',
          action: 'Open Fren Pet',
          open: onFrenPet,
          pic: <Glyph $bg="linear-gradient(160deg, #7ee8a2, #1f8fd8)">🐾</Glyph>,
        },
        {
          key: 'look',
          name: 'Shell color',
          line: 'Change the look of the device',
          action: 'Open Shell color',
          open: () => setLookOpen(true),
          pic: <Glyph $bg="linear-gradient(135deg, #18a9b8, #ffa650 50%, #ff66b4)">◐</Glyph>,
        },
      ]}
    />
  )
}
