import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import styled, { keyframes } from 'styled-components/macro'
import { useAccount, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import { BigButton, Chip, StatusBox } from '@/components/Retro'
import { explorerUrl } from '@/config/wagmi'
import { LINKS } from '@/constants/miyanet'
import { DataTable, PortalBox, Prose, PushButton, reducedMotion, starfield, useWidth, y2k } from '@/pages/Home/y2k'
import { bevel, color, font, space, text } from '@/theme/tokens'

import type { Band, Order, OrderStatus, Quote, Verdict } from './box'
import { BoxError, toImdUsd, useBoxMe, useBoxOrders, useBoxSession, usePayQuote } from './box'
import type { BuildType } from './starters'
import { STARTERS } from './starters'

/* ---------- the page: a miyanet page, same night sky and portal boxes ---------- */

const Layout = styled.div`
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  ${starfield}
  color: ${color.ink};
`

const Inner = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  max-width: 880px;
  margin: 0 auto;
  padding: ${space[3]} ${space[4]} ${space[6]};
  .narrow & {
    padding: ${space[2]};
  }
`

/** The explorer's own address line: where you are in the miyanet, and the way back. */
const Crumbs = styled.nav`
  display: flex;
  align-items: center;
  gap: ${space[2]};
  padding: 3px;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  .addr {
    flex: 1 1 auto;
    min-width: 0;
    padding: 4px ${space[2]};
    background: #fff;
    box-shadow: ${bevel.field};
    font-family: ${font.mono};
    font-size: ${text.xs};
    color: ${color.ink};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const Masthead = styled.header`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${space[2]};
  padding: ${space[4]} 0 ${space[2]};
  text-align: center;
  h1 {
    margin: 0;
    font-family: ${font.display};
    font-weight: 400;
    font-size: 44px;
    line-height: 1;
    letter-spacing: 0.04em;
    background: ${y2k.chrome};
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(3px 3px 0 ${color.accentDark}) drop-shadow(1px 1px 0 ${color.dark});
  }
  p {
    margin: 0;
    max-width: 60ch;
    font-size: ${text.sm};
    line-height: 1.5;
    color: #fff;
  }
  em {
    font-style: normal;
    color: #f5c6f6;
  }
  .narrow & h1 {
    font-size: 30px;
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

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
  button[aria-pressed='true'] {
    background: #fff;
    box-shadow: ${bevel.pressed};
    font-weight: 700;
  }
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

const Label = styled.span`
  font-size: ${text.xs};
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: ${color.inkMuted};
`

const meterFill = keyframes`
  from { width: 0; }
`

/** The odds as an old download bar: green, amber or red blocks. */
const Odds = styled.div<{ $band: Band }>`
  display: flex;
  align-items: center;
  gap: ${space[3]};
  padding: ${space[2]} ${space[3]};
  background: #000;
  box-shadow: ${bevel.sunken};
  font-family: ${font.display};
  font-size: ${text.lg};
  color: ${({ $band }) => ($band === 'likely' ? y2k.phosphor : $band === 'uncertain' ? y2k.tape : y2k.lcd)};
  .bar {
    flex: 0 0 140px;
    height: 16px;
    background: #222;
    box-shadow: inset 1px 1px #000;
  }
  .bar span {
    display: block;
    height: 100%;
    background: repeating-linear-gradient(90deg, currentColor 0 10px, transparent 10px 12px);
    animation: ${meterFill} 0.8s steps(10);
    ${reducedMotion} {
      animation: none;
    }
  }
  .narrow & {
    flex-wrap: wrap;
  }
`

const List = styled.ul`
  margin: 0;
  padding-left: 1.2em;
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  li small {
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

const BAND: Record<Band, [string, string, number]> = {
  likely: ['Likely to pass', 'The swarm should complete this as it stands.', 100],
  uncertain: ['Uncertain', 'It could go either way. Fix what is below first.', 60],
  unlikely: ['Unlikely to pass', 'As it stands it would probably be refused or get stuck.', 20],
  refused: ['Not something the swarm runs', '', 0],
}
const SEVERITY = { block: ['Blocks it', 'warn'], high: ['High', 'warn'], medium: ['Medium', 'off'] } as const

const ORDER_SAYS: Record<OrderStatus, [string, 'ok' | 'warn' | 'off']> = {
  quoted: ['Waiting for the payment', 'off'],
  paid: ['Paid, sending to the swarm', 'off'],
  sending: ['Sending to the swarm', 'off'],
  held: ['Held: the swarm is busy', 'warn'],
  admitted: ['Accepted by the swarm', 'ok'],
  refused: ['Refused by the swarm', 'warn'],
  mismatch: ['Payment did not match: refund by hand', 'warn'],
  expired: ['Quote expired', 'off'],
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

const ext = { target: '_blank', rel: 'noreferrer noopener' } as const

function OrderRow({ order }: { order: Order }) {
  const [label, tone] = ORDER_SAYS[order.status] ?? [order.status, 'off']
  const delivered = order.job?.delivery?.repoUrl || order.job?.delivery?.url
  return (
    <tr>
      <th scope="row">
        {order.action}
        <br />
        <small>
          {new Date(order.created_at).toLocaleDateString()}
          {order.paid_tx && (
            <>
              {' · '}
              <a {...ext} href={`${explorerUrl(1)}/tx/${order.paid_tx}`}>
                payment
              </a>
            </>
          )}
          {order.job_id && (
            <>
              {' · '}
              <a {...ext} href={`https://explorer.imd.fun/jobs/${order.job_id}`}>
                swarm job
              </a>
            </>
          )}
          {delivered && (
            <>
              {' · '}
              <a {...ext} href={delivered}>
                the result
              </a>
            </>
          )}
        </small>
      </th>
      <td>
        <Chip tone={tone}>{label}</Chip>
      </td>
    </tr>
  )
}

/** INFER BOX inside the miyanet explorer: describe, check (free), price, pay, follow. */
export default function Build({ onHome }: { onHome: () => void }) {
  const location = useLocation()
  const params = useMemo(() => new URLSearchParams(location.search), [location.search])
  const [layoutRef, width] = useWidth<HTMLDivElement>()
  const narrow = width > 0 && width <= 620
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
  const [busy, setBusy] = useState<'evaluate' | 'quote' | 'pay' | undefined>()
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

  const pick = (s: (typeof STARTERS)[number]) => {
    setIdea(s.idea)
    setType(s.type)
    setVerdict(undefined)
    setQuote(undefined)
    setFacts({})
  }

  let action: { label: string; onClick: () => void; disabled?: boolean }
  if (!isConnected) action = { label: 'Connect wallet', onClick: () => openConnectModal?.() }
  else if (session.signingIn) action = { label: 'Sign in with your wallet…', onClick: () => {}, disabled: true }
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
  const secondsLeft = quote ? Math.max(0, Math.round((quote.expiresAt - now) / 1000)) : 0

  return (
    <Layout ref={layoutRef} className={narrow ? 'narrow' : undefined}>
      <Inner>
        <Crumbs aria-label="Where you are">
          <PushButton type="button" onClick={onHome}>
            ← miyanet
          </PushButton>
          <span className="addr">miyanet://build-with-the-swarm</span>
        </Crumbs>

        <Masthead>
          <h1>build with the swarm</h1>
          <p>
            Tell the swarm what to make. <em>INFER BOX</em> checks your idea for free and says what would stop it. When
            it looks likely, you pay in imdUSD and hundreds of AI agents do the work.
          </p>
        </Masthead>

        <PortalBox
          title="Your idea"
          label="Your idea"
          aside={session.signedIn ? <Chip tone="ok">Signed in</Chip> : <Chip tone="off">Not signed in</Chip>}
        >
          <Row>
            <Label>Start from</Label>
            {STARTERS.map((s) => (
              <PushButton key={s.label} type="button" onClick={() => pick(s)}>
                {s.label}
              </PushButton>
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
          <Row role="group" aria-label="What kind of request">
            {TYPES.map(([t, label]) => (
              <PushButton key={t || 'any'} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
                {label}
              </PushButton>
            ))}
          </Row>
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
          <Row style={{ justifyContent: 'space-between' }}>
            <Fine>
              {session.signedIn
                ? `Checking is free${
                    left !== undefined ? `: ${left} checks left today` : ''
                  }. Nothing is sent or paid until you press pay.`
                : 'Signing in asks your wallet for a signature. It costs nothing and sends no transaction.'}
            </Fine>
            {session.signedIn && (
              <PushButton type="button" onClick={() => session.signOut()}>
                Sign out
              </PushButton>
            )}
          </Row>
          {error && (
            <StatusBox tone="error" role="alert">
              <span>{error}</span>
            </StatusBox>
          )}
        </PortalBox>

        {verdict && (
          <PortalBox title="The verdict" label="Verdict">
            <div aria-live="polite">
              <Odds $band={verdict.band}>
                <span className="bar" aria-hidden>
                  <span style={{ width: `${BAND[verdict.band][2]}%` }} />
                </span>
                {BAND[verdict.band][0]}
              </Odds>
            </div>
            <Prose>
              {BAND[verdict.band][1] && <p>{BAND[verdict.band][1]}</p>}
              {verdict.action && <p>The swarm would run this as {verdict.action}.</p>}
            </Prose>
            {verdict.policy && (
              <StatusBox tone="error">
                <span>{verdict.policy.line}</span>
              </StatusBox>
            )}
            {!!verdict.risks?.length && (
              <>
                <Label>What could stop it</Label>
                <Prose as="div">
                  <List>
                    {verdict.risks.map((r) => (
                      <li key={r.reason}>
                        <Chip tone={SEVERITY[r.severity][1]}>{SEVERITY[r.severity][0]}</Chip> {r.reason}
                        {r.redirect && <small>Instead: {r.redirect}</small>}
                      </li>
                    ))}
                  </List>
                </Prose>
              </>
            )}
            {!!verdict.sharpen?.length && (
              <>
                <Label>Be more specific about</Label>
                <Prose as="div">
                  <List>
                    {verdict.sharpen.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </List>
                </Prose>
              </>
            )}
            {!!verdict.fields?.length && (
              <>
                <Label>Fill in what it needs</Label>
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
                <Row>
                  <PushButton type="button" disabled={!!busy} onClick={evaluate}>
                    Check again with these
                  </PushButton>
                </Row>
              </>
            )}
            {!!verdict.redacted && (
              <Fine>
                {verdict.redacted} line{verdict.redacted > 1 ? 's' : ''} withheld: they repeated private material.
              </Fine>
            )}
            {sendable(verdict) && me.data?.payments === false && (
              <StatusBox tone="info">
                <span>Paying opens soon. Your verdict is saved on INFER BOX.</span>
              </StatusBox>
            )}
            {sendable(verdict) && me.data?.payments !== false && !quote && (
              <BigButton type="button" disabled={!!busy} onClick={getQuote}>
                {busy === 'quote' ? 'Getting a price…' : 'Get a price'}
              </BigButton>
            )}
          </PortalBox>
        )}

        {quote && (
          <PortalBox title="The price" label="Price">
            <DataTable>
              <tbody>
                <tr>
                  <th scope="row">Swarm price</th>
                  <td>
                    {quote.shown.swarmPriceImd} IMD × ${quote.shown.imdUsd.toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Cost, pays the swarm</th>
                  <td>{toImdUsd(quote.pay.toFloat)} imdUSD</td>
                </tr>
                <tr>
                  <th scope="row">Buffer, 5% to the Treasury</th>
                  <td>{toImdUsd(quote.pay.toTreasury)} imdUSD</td>
                </tr>
                <tr>
                  <th scope="row">Total</th>
                  <td>{toImdUsd(quote.total)} imdUSD</td>
                </tr>
              </tbody>
            </DataTable>
            <Fine>
              Price holds for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}. You pay in
              imdUSD, a dollar coin.{' '}
              <a {...ext} href={`${LINKS.imdusd}terminal/`}>
                Get imdUSD
              </a>
            </Fine>
            {chainId !== 1 ? (
              <BigButton type="button" onClick={() => switchChain({ chainId: 1 })}>
                Switch to Ethereum
              </BigButton>
            ) : (
              <BigButton type="button" disabled={!!busy || secondsLeft === 0} onClick={pay}>
                {busy === 'pay'
                  ? 'Paying…'
                  : secondsLeft === 0
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
          </PortalBox>
        )}

        {paidOrder && (
          <StatusBox tone={followed?.status === 'admitted' ? 'ok' : 'info'} role="status">
            <span>
              {followed ? ORDER_SAYS[followed.status][0] : 'Paid. Waiting for INFER BOX to see the payment'}.{' '}
              {followed?.job_id && (
                <a {...ext} href={`https://explorer.imd.fun/jobs/${followed.job_id}`}>
                  Follow the swarm job
                </a>
              )}
            </span>
          </StatusBox>
        )}

        {session.signedIn && recent.length > 0 && (
          <PortalBox title="Your orders" label="Your orders">
            <DataTable>
              <tbody>
                {recent.map((o) => (
                  <OrderRow key={o.id} order={o} />
                ))}
              </tbody>
            </DataTable>
          </PortalBox>
        )}

        <Fine style={{ color: '#c9d4ff', textAlign: 'center' }}>
          Runs on{' '}
          <a {...ext} href={LINKS.box} style={{ color: '#f5c6f6' }}>
            INFER BOX
          </a>
          , the same Box as box.imdusd.com, with the same limits. Your idea stays private until you pay.
        </Fine>
      </Inner>
    </Layout>
  )
}
