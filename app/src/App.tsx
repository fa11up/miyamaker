import '@rainbow-me/rainbowkit/styles.css'

import { ApolloClient, ApolloProvider, InMemoryCache } from '@apollo/client'
import type { Theme } from '@rainbow-me/rainbowkit'
import { lightTheme, RainbowKitProvider } from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import merge from 'lodash.merge'
import { Provider } from 'react-redux'
import { WagmiProvider } from 'wagmi'

import { wagmiConfig } from './config/wagmi'
import { GRAPHQL_URL } from './constants/indexer'
import AccountProvider from './context/AccountProvider'
import ClustersProvider from './context/ClustersProvider'
import RadioProvider from './context/RadioProvider'
import Router from './Router'
import store from './store'
import ThemeProvider, { ThemedGlobalStyle } from './theme'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 2 } },
})

const readTheme = merge(lightTheme(), {
  colors: {
    modalBackground: '#a9a3c9',
    accentColor: '#d97ada',
    selectedOptionBorder: '#000',
  },
  fonts: {
    body: 'inherit',
  },
  radii: {
    actionButton: '0',
    connectButton: '0',
    menuButton: '0',
    modal: '0',
    modalMobile: '0',
  },
  shadows: {
    connectButton: '0',
    dialog: '0',
    profileDetailsAction: '0',
    selectedOption: '0',
    selectedWallet: '0',
    walletLogo: '0',
  },
} as Theme)

const client = new ApolloClient({
  // Optional indexer; queries are skipped when it is not configured (see constants/indexer.ts).
  uri: GRAPHQL_URL || 'http://indexer.invalid/graphql',
  cache: new InMemoryCache(),
})

export default function App() {
  return (
    <ApolloProvider client={client}>
      <Provider store={store}>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <AccountProvider>
              <ClustersProvider>
                <RainbowKitProvider theme={readTheme} appInfo={{ appName: 'miyamaker' }}>
                  <ThemeProvider>
                    <ThemedGlobalStyle />
                    <RadioProvider>
                      <Router />
                    </RadioProvider>
                  </ThemeProvider>
                </RainbowKitProvider>
              </ClustersProvider>
            </AccountProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </Provider>
    </ApolloProvider>
  )
}
