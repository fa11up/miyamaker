import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import styled from 'styled-components/macro'
import { useAccount, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import { BigButton, Chip, DisplayTitle, Eyebrow, Panel, StatusBox, Well } from '@/components/Retro'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { explorerUrl } from '@/config/wagmi'
import { LINKS } from '@/constants/miyanet'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import { bevel, color, font, space, text } from '@/theme/tokens'

import type { Band, Order, OrderStatus, Quote, Verdict } from './box'
import { BoxError, toImdUsd, useBoxMe, useBoxOrders, useBoxSession, usePayQuote } from './box'
import type { BuildType } from './starters'
import { STARTERS } from './starters'

const page = Pages.build

const Layout = styled.div`
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
`

const Inner = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  padding: ${space[3]};
  max-width: 860px;
  margin: 0 auto;
`

const Head = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: ${space[2]};
`

const Lead = styled.p`
  margin: 0;
  font-size: ${text.sm};
  line-height: 1.5;
  color: ${color.ink};
`

const Fine = styled.p`
  margin: 0;
  font-size: ${text.xs};
  line-height: 1.5;
  color: ${color.inkMuted};
  a {
    color: ${color.link};
  }
`

const IdeaBox = styled.textarea`
  box-sizing: border-box;
  width: 100%;
  min-height: 120px;
  resize: vertical;
  border: none;
  border-radius: 0;
  padding: ${space[2]} ${space[3]};
  background: #fff;
  box-shadow: ${bevel.field};
  font-family: ${font.body};
  font-size: ${text.sm};
  line-height: 1.5;
  color: ${color.ink};
`

const Choices = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[1]};
  button {
    min-height: 32px;
    padding: 0 ${space[3]};
    border: none;
    border-radius: 0;
    background: ${color.face};
    color: ${color.ink};
    box-shadow: ${bevel.raised};
    font-family: ${font.ui};
    font-size: ${text.sm};
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    background: #fff;
    box-shadow: ${bevel.pressed};
    font-weight: 700;
  }
  button:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: -5px;
  }
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
`

const Small = styled.button`
  min-height: 32px;
  padding: 0 ${space[3]};
  border: none;
  border-radius: 0;
  background: ${color.face};
  color: ${color.ink};
  box-shadow: ${bevel.raised};
  font-family: ${font.ui};
  font-size: ${text.sm};
  cursor: pointer;
  &:active:not(:disabled) {
    box-shadow: ${bevel.pressed};
  }
  &:disabled {
    color: ${color.shadow};
    cursor: not-allowed;
  }
`

const Banner = styled.div<{ $band: Band }>`
  display: flex;
  align-items: center;
  gap: ${space[3]};
  padding: ${space[2]} ${space[3]};
  font-family: ${font.display};
  font-size: ${text.lg};
  color: #fff;
  background: ${({ $band }) =>
    $band === 'likely' ? color.success : $band === 'uncertain' ? color.warning : color.danger};
  box-shadow: ${bevel.raised};
  .meter {
    font-family: ${font.mono};
    font-size: ${text.sm};
    letter-spacing: -1px;
  }
`

const List = styled.ul`
  margin: 0;
  padding-left: 1.2em;
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  font-size: ${text.sm};
  line-height: 1.45;
  color: ${color.ink};
  small {
    display: block;
    color: ${color.inkMuted};
  }
`

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: ${text.sm};
  color: ${color.ink};
  input {
    height: 36px;
    border: none;
    border-radius: 0;
    padding: 0 ${space[2]};
    background: #fff;
    box-shadow: ${bevel.field};
    font-size: ${text.sm};
  }
`

const Lines = styled.dl`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: ${space[1]} ${space[3]};
  margin: 0;
  font-size: ${text.sm};
  dt {
    color: ${color.inkMuted};
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  dd.total {
    font-weight: 700;
  }
`

const BAND: Record<Band, [string, string, string]> = {
  likely: ['Likely to pass', 'The swarm should complete this as it stands.', '██████████'],
  uncertain: ['Uncertain', 'It could go either way. Fix what is below first.', '██████░░░░'],
  unlikely: ['Unlikely to pass', 'As it stands it would probably be refused or get stuck.', '██░░░░░░░░'],
  refused: ['Not something the swarm runs', '', '░░░░░░░░░░'],
}
const SEVERITY = { block: ['Blocks it', 'warn'], high: ['High', 'warn'], medium: ['Medium', 'off'] } as const

const ORDER_SAYS: Record<OrderStatus, [string, 'ok' | 'warn' | 'off']> = {
  quoted: ['Waiting for the payment to be confirmed', 'off'],
  paid: ['Paid. Sending it to the swarm', 'off'],
  sending: ['Sending it to the swarm', 'off'],
  held: ['The swarm is busy: held, it will be sent when it is back', 'warn'],
  admitted: ['The swarm accepted it', 'ok'],
  refused: ['The swarm refused it', 'warn'],
  mismatch: ['The payment did not match the quote: it will be refunded by hand', 'warn'],
  expired: ['The quote expired before a payment was seen', 'off'],
}

const TYPES: [BuildType, string][] = [
  ['', 'Not sure'],
  ['build', 'Build something'],
  ['launch', 'Launch on chain'],
  ['question', 'Ask a question'],
]

const sendable = (v: Verdict | undefined) =>
  !!v && v.band !== 'refused' && !!v.action && !(v.risks ?? []).some((r) => r.severity === 'block')

const message = (e: unknown) => {
  if (e instanceof BoxError) return e.message
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage || (e as Error)?.message || ''
  if (/rejected|denied/i.test(m)) return 'You cancelled it in your wallet.'
  return m || 'Something went wrong. Try again.'
}

function OrderLine({ order }: { order: Order }) {
  const [label, tone] = ORDER_SAYS[order.status] ?? [order.status, 'off']
  const delivered = order.job?.delivery?.repoUrl || order.job?.delivery?.url
  return (
    <li>
      <Row style={{ justifyContent: 'space-between' }}>
        <span>{order.action}</span>
        <Chip tone={tone}>{label}</Chip>
      </Row>
      <small>
        {new Date(order.created_at).toLocaleString()}
        {order.paid_tx && (
          <>
            {' · '}
            <a href={`${explorerUrl(1)}/tx/${order.paid_tx}`} target="_blank" rel="noreferrer noopener">
              payment
            </a>
          </>
        )}
        {order.job_id && (
          <>
            {' · '}
            <a href={`https://explorer.imd.fun/jobs/${order.job_id}`} target="_blank" rel="noreferrer noopener">
              swarm job
            </a>
            {order.job?.state ? ` (${order.job.state})` : ''}
          </>
        )}
        {delivered && (
          <>
            {' · '}
            <a href={delivered} target="_blank" rel="noreferrer noopener">
              the result
            </a>
          </>
        )}
      </small>
    </li>
  )
}

export default function Build() {
  const dispatch = useAppDispatch()
  const [fullscreen, toggleFullscreen] = useFullscreen('build')
  const location = useLocation()
  const params = useMemo(() => new URLSearchParams(location.search), [location.search])
  const { isConnected, chainId } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { switchChain } = useSwitchChain()
  const queryClient = useQueryClient()

  const session = useBoxSession()
  const me = useBoxMe(session)
  const orders = useBoxOrders(session)
  const payQuote = usePayQuote()

  const [idea, setIdea] = useState(params.get('idea') ?? '')
  const [type, setType] = useState<BuildType>((params.get('type') as BuildType) || '')
  const [code, setCode] = useState('')
  const [facts, setFacts] = useState<Record<string, string>>({})
  const [verdict, setVerdict] = useState<Verdict>()
  const [busy, setBusy] = useState<'signin' | 'evaluate' | 'quote' | 'pay' | undefined>()
  const [error, setError] = useState<string>()
  const [quote, setQuote] = useState<Quote>()
  const [payNote, setPayNote] = useState<string>()
  const [paidOrder, setPaidOrder] = useState<string>()
  const [now, setNow] = useState(Date.now())

  // A new idea handed over from miyanet (search or one of the starters) replaces the one on screen.
  useEffect(() => {
    const next = params.get('idea')
    if (next) {
      setIdea(next)
      setType((params.get('type') as BuildType) || '')
      setVerdict(undefined)
      setQuote(undefined)
      setFacts({})
    }
  }, [params])

  useEffect(() => {
    if (!quote) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [quote])

  const blanks = idea.includes('___')
  const tooShort = idea.trim().length < 20

  const run = async <T,>(what: typeof busy, f: () => Promise<T>) => {
    setError(undefined)
    setBusy(what)
    try {
      return await f()
    } catch (e) {
      setError(message(e))
      return undefined
    } finally {
      setBusy(undefined)
    }
  }

  const evaluate = () =>
    run('evaluate', async () => {
      const fresh = session.signedIn ? undefined : await session.signIn(code)
      setQuote(undefined)
      const filled = Object.fromEntries(Object.entries(facts).filter(([, v]) => v.trim()))
      const v = await session.authed<Verdict>('/evaluate', { idea: idea.trim(), typeHint: type, facts: filled }, fresh)
      setVerdict(v)
      queryClient.invalidateQueries({ queryKey: ['box-me'] })
    })

  const getQuote = () =>
    run('quote', async () => {
      if (!verdict) return
      setQuote(await session.authed<Quote>('/order', { evalId: verdict.id }))
    })

  const pay = () =>
    run('pay', async () => {
      if (!quote || !me.data) return
      await payQuote(quote, me.data.wallet, setPayNote)
      setPaidOrder(quote.orderId)
      setQuote(undefined)
      setPayNote(undefined)
      orders.refetch()
    })

  let action: { label: string; onClick: () => void; disabled?: boolean }
  if (!isConnected) action = { label: 'Connect wallet', onClick: () => openConnectModal?.() }
  else if (busy === 'signin' || session.signingIn)
    action = { label: 'Sign in with your wallet…', onClick: () => {}, disabled: true }
  else if (busy === 'evaluate') action = { label: 'The Box is checking it…', onClick: () => {}, disabled: true }
  else
    action = {
      label: verdict ? 'Check it again (free)' : 'Check my idea (free)',
      onClick: evaluate,
      disabled: tooShort || blanks,
    }

  const left = me.data ? Math.max(0, me.data.evalsPerDay - me.data.usedToday) : undefined
  const recent = (orders.data?.orders ?? []).slice(0, 5)
  const followed = recent.find((o) => o.id === paidOrder)

  return (
    <WindowWrapper>
      <TitleBar
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(closeWindow({ value: 'build' }))
        }}
        fullscreen={fullscreen}
        fullscreenBtn
        onFullscreen={() => toggleFullscreen()}
        minimizeBtn
        onMinimize={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(minimizeWindow({ value: 'build' }))
        }}
      >
        {page?.label}
      </TitleBar>
      <Layout>
        <Inner>
          <Head>
            <div>
              <Eyebrow style={{ color: color.highlight, textShadow: `1px 1px 0 ${color.dark}` }}>INFER BOX</Eyebrow>
              <DisplayTitle>Build with the swarm</DisplayTitle>
            </div>
            {session.signedIn ? (
              <Row>
                <Chip tone="ok">Signed in</Chip>
                <Small type="button" onClick={() => session.signOut()}>
                  Sign out
                </Small>
              </Row>
            ) : (
              <Chip tone="off">Not signed in</Chip>
            )}
          </Head>

          <Panel>
            <Lead>
              Describe what you want built, launched or answered. The Box checks it for free and tells you what would
              stop it. When it looks likely, you pay in imdUSD and the swarm does the work.
            </Lead>
            <Row>
              {STARTERS.map((s) => (
                <Small
                  key={s.label}
                  type="button"
                  onClick={() => {
                    setIdea(s.idea)
                    setType(s.type)
                    setVerdict(undefined)
                    setQuote(undefined)
                  }}
                >
                  {s.label}
                </Small>
              ))}
            </Row>
            <IdeaBox
              aria-label="Your idea"
              placeholder="What should the swarm build?"
              value={idea}
              maxLength={4000}
              onChange={(e) => setIdea(e.target.value)}
            />
            {blanks && <Fine>Fill in each ___ with your own details first.</Fine>}
            <Choices role="group" aria-label="What kind of request">
              {TYPES.map(([t, label]) => (
                <button key={t || 'any'} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
                  {label}
                </button>
              ))}
            </Choices>
            {!session.signedIn && isConnected && (
              <details>
                <summary style={{ cursor: 'pointer', fontSize: text.sm }}>Have an INFER BOX access code?</summary>
                <Field style={{ marginTop: space[2] }}>
                  Access code (optional)
                  <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" />
                </Field>
              </details>
            )}
            <BigButton type="button" disabled={action.disabled} onClick={action.onClick}>
              {action.label}
            </BigButton>
            <Fine>
              {session.signedIn
                ? `Checking is free${
                    left !== undefined ? `: ${left} checks left today` : ''
                  }. Nothing is sent or paid until you press pay.`
                : 'Signing in asks your wallet for a signature. It costs nothing and sends no transaction.'}
            </Fine>
            {error && (
              <StatusBox tone="error" role="alert">
                <span>{error}</span>
              </StatusBox>
            )}
          </Panel>

          {verdict && (
            <Panel aria-label="Verdict" aria-live="polite">
              <Banner $band={verdict.band}>
                <span className="meter" aria-hidden>
                  {BAND[verdict.band][2]}
                </span>
                {BAND[verdict.band][0]}
              </Banner>
              {BAND[verdict.band][1] && <Lead>{BAND[verdict.band][1]}</Lead>}
              {verdict.action && <Fine>Route: {verdict.action}</Fine>}
              {verdict.policy && (
                <StatusBox tone="error">
                  <span>{verdict.policy.line}</span>
                </StatusBox>
              )}
              {!!verdict.risks?.length && (
                <>
                  <Eyebrow>What could stop it</Eyebrow>
                  <List>
                    {verdict.risks.map((r) => (
                      <li key={r.reason}>
                        <Chip tone={SEVERITY[r.severity][1]}>{SEVERITY[r.severity][0]}</Chip> {r.reason}
                        {r.redirect && <small>Instead: {r.redirect}</small>}
                      </li>
                    ))}
                  </List>
                </>
              )}
              {!!verdict.sharpen?.length && (
                <>
                  <Eyebrow>Be more specific about</Eyebrow>
                  <List>
                    {verdict.sharpen.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </List>
                </>
              )}
              {!!verdict.fields?.length && (
                <>
                  <Eyebrow>Fill in what it needs</Eyebrow>
                  {verdict.fields.map((f) => (
                    <Field key={f.id}>
                      {f.label}
                      <input
                        value={facts[f.label] ?? ''}
                        placeholder={f.example}
                        inputMode={f.type === 'number' ? 'decimal' : undefined}
                        onChange={(e) => setFacts((x) => ({ ...x, [f.label]: e.target.value }))}
                      />
                    </Field>
                  ))}
                  <Small type="button" disabled={!!busy} onClick={evaluate}>
                    Check again with these
                  </Small>
                </>
              )}
              {!!verdict.redacted && (
                <Fine>
                  {verdict.redacted} line{verdict.redacted > 1 ? 's' : ''} withheld: they repeated private material.
                </Fine>
              )}

              {sendable(verdict) &&
                (me.data?.payments === false ? (
                  <StatusBox tone="info">
                    <span>Paying opens soon. Your verdict is saved on INFER BOX.</span>
                  </StatusBox>
                ) : !quote ? (
                  <BigButton type="button" disabled={!!busy} onClick={getQuote}>
                    {busy === 'quote' ? 'Getting a price…' : 'Get a price'}
                  </BigButton>
                ) : (
                  <Well style={{ padding: space[3], display: 'flex', flexDirection: 'column', gap: space[2] }}>
                    <Lines>
                      <dt>Swarm price</dt>
                      <dd>
                        {quote.shown.swarmPriceImd} IMD × ${quote.shown.imdUsd.toFixed(2)}
                      </dd>
                      <dt>Cost (pays the swarm)</dt>
                      <dd>{toImdUsd(quote.pay.toFloat)} imdUSD</dd>
                      <dt>Buffer (5% to the Treasury)</dt>
                      <dd>{toImdUsd(quote.pay.toTreasury)} imdUSD</dd>
                      <dt>Total</dt>
                      <dd className="total">{toImdUsd(quote.total)} imdUSD</dd>
                    </Lines>
                    <Fine>
                      Price holds for{' '}
                      {(() => {
                        const s = Math.max(0, Math.round((quote.expiresAt - now) / 1000))
                        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
                      })()}
                      . You pay in imdUSD, a dollar coin.{' '}
                      <a href={`${LINKS.imdusd}terminal/`} target="_blank" rel="noreferrer noopener">
                        Get imdUSD
                      </a>
                    </Fine>
                    {chainId !== 1 ? (
                      <BigButton type="button" onClick={() => switchChain({ chainId: 1 })}>
                        Switch to Ethereum
                      </BigButton>
                    ) : (
                      <BigButton type="button" disabled={!!busy || quote.expiresAt < now} onClick={pay}>
                        {busy === 'pay'
                          ? 'Paying…'
                          : quote.expiresAt < now
                          ? 'Price expired: get a new one'
                          : `Pay ${toImdUsd(quote.total)} imdUSD`}
                      </BigButton>
                    )}
                    {payNote && (
                      <StatusBox tone="info" role="status">
                        <img src={LoadingHourglass} alt="" />
                        <span>{payNote}</span>
                      </StatusBox>
                    )}
                  </Well>
                ))}
            </Panel>
          )}

          {paidOrder && (
            <StatusBox tone={followed?.status === 'admitted' ? 'ok' : 'info'} role="status">
              <span>
                {followed ? ORDER_SAYS[followed.status][0] : 'Paid. Waiting for INFER BOX to see the payment'}.{' '}
                {followed?.job_id && (
                  <a
                    href={`https://explorer.imd.fun/jobs/${followed.job_id}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Follow the swarm job
                  </a>
                )}
              </span>
            </StatusBox>
          )}

          {session.signedIn && recent.length > 0 && (
            <Panel aria-label="Your orders">
              <Eyebrow>Your orders</Eyebrow>
              <List style={{ listStyle: 'none', paddingLeft: 0 }}>
                {recent.map((o) => (
                  <OrderLine key={o.id} order={o} />
                ))}
              </List>
            </Panel>
          )}

          <Fine>
            Runs on{' '}
            <a href={LINKS.box} target="_blank" rel="noreferrer noopener">
              INFER BOX
            </a>
            , the same Box as box.imdusd.com, with the same limits. Your idea stays private until you pay.
          </Fine>
        </Inner>
      </Layout>
    </WindowWrapper>
  )
}
