import { lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import styled, { createGlobalStyle } from 'styled-components/macro'
import { useConnect } from 'wagmi'

import ErrorBoundary from '@/components/ErrorBoundary'
import { StatusBox } from '@/components/Retro'
import { privyAppId, reconnectWallets } from '@/config/wagmi'

import {
  clearPrivyLoginFailure,
  onPrivyChange,
  privyAttempt,
  privyBridge,
  privyLoginFailure,
  privyWanted,
  reportBroken,
  returningFromLogin,
} from './privyBridge'

const STEP_ASIDE = createGlobalStyle`
  html.privy-login [data-rk][role='dialog'],
  html.privy-login [data-rk] [role='dialog'] {
    visibility: hidden;
  }
`
const RETURN_MS = 60_000

/** The person is back on the desktop with no dialog open, so nothing else would say so. */
const LoginFailed = styled(StatusBox)`
  position: fixed;
  z-index: 100000;
  left: 50%;
  bottom: 56px;
  transform: translateX(-50%);
  width: min(420px, calc(100vw - 32px));
  align-items: center;
  span {
    flex: 1;
  }
`

function Failed({ error }: { error: Error }) {
  useEffect(() => reportBroken(error), [error])
  return null
}

/** Nothing at all until someone asks for Privy. If it can't start, the wallet dialog says so and the desktop carries on. */
export default function PrivyMount() {
  const wanted = useSyncExternalStore(onPrivyChange, privyWanted)
  const attempt = useSyncExternalStore(onPrivyChange, privyAttempt)
  // A failed download stays failed inside lazy(), so each new attempt needs its own.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const PrivyHost = useMemo(() => lazy(() => import('./PrivyHost')), [attempt])
  const { connect, connectors } = useConnect()
  const failure = useSyncExternalStore(onPrivyChange, privyLoginFailure)
  const [returnFailed, setReturnFailed] = useState(false)

  useEffect(() => {
    reconnectWallets().catch(() => {})
  }, [])

  // Back from Google or X: Privy finishes the login from the address bar, then the wallet connects as usual.
  useEffect(() => {
    if (!privyAppId || !returningFromLogin()) return
    privyBridge.request()
    privyBridge
      .wait((s) => (s.authenticated && s.wallet ? true : undefined), RETURN_MS)
      .then(() => {
        const connector = connectors.find((c) => c.id === 'privy')
        if (connector) connect({ connector }, { onError: () => setReturnFailed(true) })
      })
      .catch(() => setReturnFailed(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!privyAppId) return null
  const failedNote = (failure || returnFailed) && (
    <LoginFailed tone="error" role="alert">
      <span>That login did not finish. Try again from Connect wallet.</span>
      <button
        type="button"
        onClick={() => {
          setReturnFailed(false)
          clearPrivyLoginFailure()
        }}
      >
        OK
      </button>
    </LoginFailed>
  )
  if (!wanted) return <STEP_ASIDE />
  return (
    <>
      {failedNote}
      <ErrorBoundary key={attempt} name="privy" fallback={({ error }) => <Failed error={error} />}>
        <STEP_ASIDE />
        <Suspense fallback={null}>
          <PrivyHost appId={privyAppId} />
        </Suspense>
      </ErrorBoundary>
    </>
  )
}
