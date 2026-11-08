import { Buffer } from 'buffer'
import ReactDOM from 'react-dom/client'
import ReactGA from 'react-ga4'
import { HelmetProvider } from 'react-helmet-async'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import ErrorBoundary, { RootErrorFallback } from './components/ErrorBoundary'
import { GlobalHistory } from './GlobalHistory'
import { canonicalPath } from './pages/Swap/tradePath'

window.Buffer = Buffer

if (import.meta.env.VITE_ANALYTICS_ID) {
  ReactGA.initialize(import.meta.env.VITE_ANALYTICS_ID)
}

// Links from the HashRouter era (/#/swap, /#/manage?collection=0x...) keep working: move the hash route into the
// real path before the router reads it. Plain paths (/swap) are served index.html by the host's SPA rewrite.
if (window.location.hash.startsWith('#/')) {
  window.history.replaceState(null, '', window.location.hash.slice(1))
}

// Renamed windows keep their old links: /swap (miya swaps) is now /trade.
const renamed = canonicalPath(`${window.location.pathname}${window.location.search}${window.location.hash}`)
if (renamed) window.history.replaceState(null, '', renamed)

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const rootElement = document.getElementById('app')!
const root = ReactDOM.createRoot(rootElement)
root.render(
  <ErrorBoundary name="root" fallback={(props) => <RootErrorFallback {...props} />}>
    <BrowserRouter>
      <GlobalHistory />
      <HelmetProvider>
        <App />
      </HelmetProvider>
    </BrowserRouter>
  </ErrorBoundary>
)
