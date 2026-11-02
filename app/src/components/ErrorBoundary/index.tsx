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
export function RootErrorFallback({ error }: FallbackProps) {
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: '#6f6894',
        fontFamily: 'monospace',
        padding: '16px',
      }}
    >
      <div style={{ background: '#c0c0c0', border: '2px outset #fff', maxWidth: '420px', width: '100%' }}>
        <div style={{ background: '#000080', color: '#fff', padding: '4px 8px', fontWeight: 700 }}>miyaOS</div>
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', color: '#000' }}>
          <b>miyaOS crashed.</b>
          <code style={{ wordBreak: 'break-word', fontSize: '12px' }}>{error.message}</code>
          <button type="button" onClick={reloadPage} style={{ alignSelf: 'flex-end', padding: '4px 16px' }}>
            Reload
          </button>
        </div>
      </div>
    </div>
  )
}
