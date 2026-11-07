import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useConnect } from 'wagmi'

import { privyAppId } from '@/config/wagmi'

const Box = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
  color: #1b1530;
  h2 {
    margin: 0 0 2px;
    font-size: 18px;
    font-weight: 700;
    text-align: center;
  }
  p {
    margin: 0 0 8px;
    font-size: 14px;
    text-align: center;
  }
  button {
    all: unset;
    box-sizing: border-box;
    display: block;
    padding: 12px 14px;
    color: #fff;
    background: linear-gradient(90deg, #d97ada, #8f5fd0);
    box-shadow:
      inset -1px -1px #14101f,
      inset 1px 1px #fff,
      inset -2px -2px #a2479f,
      inset 2px 2px #f5c6f6;
    cursor: pointer;
    text-shadow: 1px 1px 0 #4f1f96;
  }
  button:active:not(:disabled) {
    box-shadow:
      inset 1px 1px #14101f,
      inset -1px -1px #fff;
  }
  button:focus-visible {
    outline: 2px dashed #fff35c;
    outline-offset: 2px;
  }
  b {
    display: block;
    font-size: 16px;
  }
  small {
    display: block;
    margin-top: 2px;
    font-size: 13px;
    line-height: 1.25;
  }
  .problem {
    margin: 0;
    color: #8f1610;
  }
`

const OPENING_MS = 4000

/**
 * The wallet dialog's right side, in place of its "What is a Wallet?" page: the two ways in for someone with no wallet.
 * RainbowKit's only slot here is its disclaimer, which sits beneath that page, so this clears the page out of the way.
 */
export default function NewHere() {
  const box = useRef<HTMLDivElement>(null)
  const { connect, connectors, isError, error } = useConnect()
  const [hidSiblings, setHidSiblings] = useState(false)
  const [opening, setOpening] = useState<string>()

  // A closed popup may never report back, so "Opening…" only lasts until the person returns here, and the button always works.
  useEffect(() => {
    if (!opening) return undefined
    const done = () => setOpening(undefined)
    const timer = setTimeout(done, OPENING_MS)
    window.addEventListener('focus', done)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', done)
    }
  }, [opening])

  useEffect(() => {
    const slot = box.current?.parentElement
    const page = slot?.parentElement
    // Only the desktop page. On a phone this slot shares its parent with the wallet list, which has to stay.
    if (!slot || !page || page.querySelector('button[data-testid^="rk-wallet-option"]')) return
    Array.from(page.children).forEach((other) => {
      if (other !== slot) (other as HTMLElement).style.display = 'none'
    })
    page.style.justifyContent = 'center'
    slot.style.alignSelf = 'stretch'
    slot.style.margin = '0 24px'
    setHidSiblings(true)
  }, [])

  const start = (id: string) => {
    const connector = connectors.find((c) => c.id === id)
    if (!connector) return
    setOpening(id)
    connect({ connector })
  }
  const declined = error?.name === 'UserRejectedRequestError' || /reject|denied|closed/i.test(error?.message ?? '')

  return (
    <Box ref={box} data-testid="wallet-new-here" data-page={hidSiblings || undefined}>
      <h2>New here?</h2>
      <p>You don&apos;t need to install anything.</p>
      <button type="button" onClick={() => start('miya-passkey')}>
        <b>{opening === 'miya-passkey' ? 'Opening…' : 'Create a wallet'}</b>
        <small>With Face ID or a fingerprint, in a Coinbase window.</small>
      </button>
      {privyAppId && (
        <button type="button" onClick={() => start('privy')}>
          <b>{opening === 'privy' ? 'Opening…' : 'Log in with Google, X or email'}</b>
          <small>A wallet is made for you when you log in.</small>
        </button>
      )}
      {isError && !declined && <p className="problem">That didn&apos;t connect. Try again.</p>}
    </Box>
  )
}
