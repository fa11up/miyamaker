import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'

type FallbackProps = { error: Error; reset: () => void }

/**
 * Catches render-time errors below it so one broken app cannot take down the whole desktop.
 * `fallback` renders in place of the crashed subtree; `reset()` remounts the children.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode; fallback: (props: FallbackProps) => ReactNode; name?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[${this.props.name || 'app'}] crashed`, error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (error) return this.props.fallback({ error, reset: this.reset })
    return this.props.children
  }
}

const reloadPage = () => window.location.reload()

/** Last-resort fallback for the whole app. Uses inline styles only: the theme provider may be what crashed. */
export function RootErrorFallback({ error, reset }: FallbackProps) {
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'linear-gradient(180deg, #6a78d8 0%, #8a6fb8 100%)',
        fontFamily: "'W95FA', monospace",
        padding: '16px',
      }}
    >
      <div
        style={{
          background: '#a9a3c9',
          color: '#1b1530',
          boxShadow:
            'inset -1px -1px #14101f, inset 1px 1px #ffffff, inset -2px -2px #6f6894, inset 2px 2px #dcd8f0',
          padding: '3px',
          maxWidth: '420px',
          width: '100%',
        }}
      >
        <div
          style={{
            background: 'linear-gradient(90deg, #d97ada, #8f5fd0)',
            color: '#fff',
            padding: '4px 8px',
            fontWeight: 700,
          }}
        >
          miyaOS
        </div>
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <b>Something went wrong.</b>
          <span>Your windows are safe. Try again to go back to them.</span>
          <code style={{ wordBreak: 'break-word', fontSize: '12px', opacity: 0.75 }}>{error.message}</code>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={reloadPage} style={{ minHeight: '36px', padding: '0 16px' }}>
              Reload
            </button>
            <button type="button" autoFocus onClick={reset} style={{ minHeight: '36px', padding: '0 16px' }}>
              Try again
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
