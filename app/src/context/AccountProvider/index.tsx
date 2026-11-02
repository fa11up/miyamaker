import { useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect } from 'react'
import type { UseAccountReturnType, UseBalanceReturnType } from 'wagmi'
import { useAccount as useWagmiAccount, useBalance, useBlockNumber } from 'wagmi'

export type BalanceData = UseBalanceReturnType['data']

type AccountContextType = {
  block: string
  account: UseAccountReturnType | undefined
  balance: BalanceData | undefined
}

const AccountContext = createContext<AccountContextType>({
  block: '',
  account: undefined,
  balance: undefined,
})

export const useAccount = () => useContext(AccountContext)

export default function AccountProvider({ children }: { children: ReactNode }) {
  const account = useWagmiAccount()
  const { data: block } = useBlockNumber({ watch: true })
  const balance = useBalance({
    address: account.address,
    query: { enabled: !!account.address, staleTime: 10_000 },
  })

  // wagmi v2 removed `watch` on useBalance: refresh the balance every new block instead.
  const queryClient = useQueryClient()
  useEffect(() => {
    if (account.address) queryClient.invalidateQueries({ queryKey: balance.queryKey })
  }, [block])

  return (
    <AccountContext.Provider value={{ block: block?.toString() || '', account, balance: balance.data }}>
      {children}
    </AccountContext.Provider>
  )
}
