import { PrivyProvider, useLogin, usePrivy, useWallets } from '@privy-io/react-auth'
import logo from 'assets/134321870.png'
import { useEffect } from 'react'

import { chains, mainnet } from '@/config/wagmi'

import type { EmbeddedWallet } from './privyBridge'
import { reportLogin, reportPrivy } from './privyBridge'

function Report() {
  const { ready, authenticated, logout } = usePrivy()
  const { wallets } = useWallets()
  const { login } = useLogin({
    onComplete: () => reportLogin(),
    onError: (code) => reportLogin(new Error(String(code))),
  })
  const wallet = wallets.find((w) => w.walletClientType === 'privy') as EmbeddedWallet | undefined

  useEffect(() => {
    reportPrivy({ ready, authenticated, wallet, openLogin: () => login(), logout })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, wallet])
  return null
}

/** Privy, on its own: it's the heavy part, so this file only loads once someone asks to log in with it. */
export default function PrivyHost({ appId }: { appId: string }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['google', 'twitter', 'email'],
        appearance: { theme: 'light', accentColor: '#4f1f96', logo, showWalletLoginFirst: false },
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        defaultChain: mainnet,
        supportedChains: [...chains],
      }}
    >
      <Report />
    </PrivyProvider>
  )
}
