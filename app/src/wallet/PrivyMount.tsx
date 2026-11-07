import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react'
import { createGlobalStyle } from 'styled-components/macro'
import { useConnect } from 'wagmi'

import ErrorBoundary from '@/components/ErrorBoundary'
import { privyAppId } from '@/config/wagmi'

import { onPrivyChange, privyBridge, privyWanted, reportBroken, returningFromLogin } from './privyBridge'

const PrivyHost = lazy(() => import('./PrivyHost'))

const STEP_ASIDE = createGlobalStyle`
  html.privy-login [data-rk][role='dialog'],
  html.privy-login [data-rk] [role='dialog'] {
    visibility: hidden;
  }
`
const RETURN_MS = 60_000

function Failed({ error }: { error: Error }) {
  reportBroken(error)
  return null
}

/** Nothing at all until someone asks for Privy. If it can't start, the wallet dialog says so and the desktop carries on. */
export default function PrivyMount() {
  const wanted = useSyncExternalStore(onPrivyChange, privyWanted)
  const { connect, connectors } = useConnect()

  // Back from Google or X: Privy finishes the login from the address bar, then the wallet connects as usual.
  useEffect(() => {
    if (!privyAppId || !returningFromLogin()) return
    privyBridge.request()
    privyBridge
      .wait((s) => (s.authenticated && s.wallet ? true : undefined), RETURN_MS)
      .then(() => {
        const connector = connectors.find((c) => c.id === 'privy')
        if (connector) connect({ connector })
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!privyAppId) return null
  if (!wanted) return <STEP_ASIDE />
  return (
    <ErrorBoundary name="privy" fallback={({ error }) => <Failed error={error} />}>
      <STEP_ASIDE />
      <Suspense fallback={null}>
        <PrivyHost appId={privyAppId} />
      </Suspense>
    </ErrorBoundary>
  )
}
