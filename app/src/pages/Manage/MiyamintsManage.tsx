import { useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { isAddress } from 'viem'
import { useReadContract, useReadContracts } from 'wagmi'

import { Err, Field, Row2, SmallButton, SplitMeter } from '@/components/LaunchKit'
import { BigButton, Eyebrow, StatusBox, Well } from '@/components/Retro'
import Tabs from '@/components/Tabs'
import type { SupportedChainId } from '@/config/wagmi'
import { explorerUrl } from '@/config/wagmi'
import { miyamintsAddresses } from '@/constants/contracts'
import { auctionInstanceAbi, dropInstanceAbi, editionsManageAbi, erc1155InstanceAbi, vaultAbi } from '@/miyamints/abi'
import type { LaunchKind } from '@/miyamints/collections'
import { progressLabel } from '@/miyamints/collections'
import { jsonDataUri, parseLink, parseName, parseWhole, tokenJson } from '@/miyamints/launch'
import { pctLabel } from '@/miyamints/split'
import type { ClaimModeName, PayToken } from '@/miyamints/tokens'
import {
  approveWords,
  buildPrices,
  claimArgs,
  feesWords,
  hasFees,
  isEth,
  parseTokenAmount,
  pricesWords,
  tokenExact,
  tokenLabel,
} from '@/miyamints/tokens'
import { usePay, useTokenInfo } from '@/miyamints/usePay'
import { useVaultInfo } from '@/miyamints/useMiyamints'
import { txWords } from '@/miyamints/useTx'
import { color, font, space, text } from '@/theme/tokens'

import type { TokenMoney } from './payout'
import { anyPayout, cappedNote, editionTotals, tokenPayout, TOTALS_CAP } from './payout'

type Tokens = Record<string, PayToken | undefined>
type Price = { token: Address; price: bigint }

/** "0.01 ETH or 25 USDC"; a token whose decimals couldn't be read shows as "…", never at a guessed scale. */
function priceListWords(prices: readonly Price[] | undefined, info: Tokens): string {
  if (!prices) return '…'
  const known = prices.map((p) => ({ price: p.price, token: info[p.token.toLowerCase()] }))
  if (known.some((k) => !k.token)) return '…'
  return pricesWords(known as { price: bigint; token: PayToken }[])
}

/** Rows read per page in the Editions and Pieces tabs. */
const PAGE = 50

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  font-size: ${text.sm};
  color: ${color.ink};
  p {
    margin: 0;
    line-height: 1.45;
  }
`

const Stats = styled.dl`
  margin: 0;
  display: grid;
  grid-template-columns: minmax(120px, auto) minmax(0, 1fr);
  gap: ${space[1]} ${space[3]};
  dt {
    color: ${color.inkMuted};
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${text.sm};
  th,
  td {
    text-align: left;
    padding: 4px 6px;
    vertical-align: middle;
  }
  th {
    font-size: ${text.xs};
    color: ${color.inkMuted};
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  tbody tr:nth-child(odd) {
    background: rgba(255, 255, 255, 0.5);
  }
`

/** A step's state. An ERC-20 payment's approval (`<id>:approve`) shows under the same note. */
function TxNote({ tx, id, explorer }: { tx: ReturnType<typeof usePay>['tx']; id: string; explorer: string }) {
  if (!id || (tx.id !== id && tx.id !== `${id}:approve`) || tx.phase === 'idle') return null
  const tone = tx.phase === 'error' ? 'error' : tx.phase === 'done' ? 'ok' : 'info'
  return (
    <StatusBox tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <span>
        {tx.id === `${id}:approve` && tx.phase !== 'error' ? 'Step 1 of 2, the approval: ' : ''}
        {txWords(tx)}{' '}
        {tx.hash && (
          <a href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer">
            View transaction ↗
          </a>
        )}
      </span>
    </StatusBox>
  )
}

type Common = {
  run: ReturnType<typeof usePay>['run']
  busy: boolean
  tx: ReturnType<typeof usePay>['tx']
  explorer: string
  isOwner: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CallFn = (fn: string, args?: unknown[], extra?: Record<string, unknown>) => any

function DropMetadata({
  dropReads,
  run,
  busy,
  tx,
  explorer,
  call,
  isOwner,
}: Common & { dropReads: { data?: readonly { result?: unknown }[] }; call: CallFn }) {
  const cur = {
    baseURI: (dropReads.data?.[5]?.result as string) || '',
    unrevealedURI: (dropReads.data?.[6]?.result as string) || '',
    contractURI: (dropReads.data?.[7]?.result as string) || '',
    locked: !!dropReads.data?.[8]?.result,
    royaltyLocked: !!dropReads.data?.[12]?.result,
  }
  const [reveal, setReveal] = useState<string>()
  const value = reveal ?? cur.baseURI
  const link = parseLink(value, false)
  return (
    <Stack>
      <p>
        Every piece shows your launch artwork until you add a metadata folder. Then piece 1 reads the folder link + 1,
        piece 2 the folder link + 2.
      </p>
      <Field>
        Metadata folder link
        <input
          value={value}
          placeholder="ipfs://…/"
          disabled={cur.locked}
          aria-invalid={!link.ok}
          onChange={(e) => setReveal(e.target.value)}
        />
        <Err>{!link.ok ? link.error : undefined}</Err>
      </Field>
      <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
        <SmallButton
          type="button"
          disabled={busy || cur.locked || !link.ok || !isOwner || value === cur.baseURI}
          onClick={() =>
            run('meta', call('setMetadata', [link.ok ? link.uri : '', cur.unrevealedURI, cur.contractURI]))
          }
        >
          Save folder link
        </SmallButton>
        <SmallButton
          type="button"
          disabled={busy || cur.locked || !cur.baseURI || !isOwner}
          onClick={() => {
            // eslint-disable-next-line no-alert
            if (window.confirm('Lock metadata forever? Nobody can change it after this, not even you.')) {
              run('lock', call('lockMetadata'))
            }
          }}
        >
          {cur.locked ? 'Metadata is locked' : 'Lock metadata forever'}
        </SmallButton>
        <SmallButton
          type="button"
          disabled={busy || cur.royaltyLocked || !isOwner}
          onClick={() => {
            // eslint-disable-next-line no-alert
            if (window.confirm('Lock the royalty forever? Nobody can change it after this, not even you.')) {
              run('lockRoyalty', call('lockRoyalty'))
            }
          }}
        >
          {cur.royaltyLocked ? 'Royalty is locked' : 'Lock royalty forever'}
        </SmallButton>
      </div>
      <TxNote tx={tx} id="meta" explorer={explorer} />
      <TxNote tx={tx} id="lock" explorer={explorer} />
      <TxNote tx={tx} id="lockRoyalty" explorer={explorer} />
    </Stack>
  )
}

function DropActions({
  run,
  busy,
  tx,
  explorer,
  call,
  isOwner,
  dropReads,
  info,
}: Common & { call: CallFn; dropReads: { data?: readonly { result?: unknown }[] }; info: Tokens }) {
  const [to, setTo] = useState('')
  const [qty, setQty] = useState('1')
  useEffect(() => {
    if (tx.phase === 'done' && tx.id === 'gift') {
      setTo('')
      setQty('1')
    }
  }, [tx.phase, tx.id])
  const q = parseWhole(qty, { min: 1, max: 500, label: 'Amount' })
  type Ph = { start: bigint; end: bigint; maxPerWallet: number; supplyCap: number; prices: readonly Price[] }
  const phases = (dropReads.data?.[9]?.result as Ph[] | undefined) || []
  const reserve = Number((dropReads.data?.[10]?.result as number | undefined) ?? 0)
  const reserveUsed = Number((dropReads.data?.[11]?.result as bigint | undefined) ?? 0n)
  const reserveLeft = reserve - reserveUsed
  return (
    <Stack>
      <Eyebrow>Sale phases</Eyebrow>
      <Table>
        <thead>
          <tr>
            <th>#</th>
            <th>Price</th>
            <th>Starts</th>
            <th>Ends</th>
            <th>Per wallet</th>
            <th>For sale</th>
          </tr>
        </thead>
        <tbody>
          {phases.map((p, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{priceListWords(p.prices, info)}</td>
              <td>{new Date(Number(p.start) * 1000).toLocaleString()}</td>
              <td>{p.end === 0n ? 'No end' : new Date(Number(p.end) * 1000).toLocaleString()}</td>
              <td>{p.maxPerWallet || 'No limit'}</td>
              <td>{p.supplyCap || 'No limit'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Eyebrow>Give pieces away</Eyebrow>
      <p>
        Mint the pieces you kept back at launch to any wallet, for your team or giveaways. {reserveLeft} of {reserve}{' '}
        left.
      </p>
      <Row2>
        <Field>
          Wallet address
          <input value={to} placeholder="0x…" onChange={(e) => setTo(e.target.value)} spellCheck={false} />
        </Field>
        <Field>
          How many
          <input value={qty} inputMode="numeric" onChange={(e) => setQty(e.target.value)} />
          <Err>{!q.ok ? q.error : undefined}</Err>
        </Field>
      </Row2>
      <div>
        <SmallButton
          type="button"
          disabled={busy || !isOwner || !isAddress(to) || !q.ok || q.n > reserveLeft}
          onClick={() => q.ok && run('gift', call('ownerMint', [to, BigInt(q.n)]))}
        >
          Mint for free
        </SmallButton>
      </div>
      <TxNote tx={tx} id="gift" explorer={explorer} />
    </Stack>
  )
}

function AuctionPieces({
  ps,
  run,
  busy,
  tx,
  explorer,
  call,
  isOwner,
  more,
  currency,
  pay,
  address,
  chainId,
}: Common & {
  call: CallFn
  ps: { tokenId: number; minBid: bigint; highBid: bigint; highBidder: Address; endTime: number; settled: boolean }[]
  more: { note?: string; onMore: () => void }
  /** The house's one currency; undefined until read (then no amount is shown). */
  currency?: PayToken
  pay: ReturnType<typeof usePay>['pay']
  address: Address
  chainId: SupportedChainId
}) {
  const money = (amount: bigint) => (currency ? tokenLabel(amount, currency) : '…')
  const [img, setImg] = useState('')
  const [name, setName] = useState('')
  const [reserve, setReserve] = useState('')
  // Ticks, so Settle appears when a piece's time runs out with the tab open.
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now() / 1000), 15_000)
    return () => clearInterval(tick)
  }, [])
  // Sent and landed: a filled form would offer the same deposit again.
  useEffect(() => {
    if (tx.phase === 'done' && tx.id === 'queue') {
      setImg('')
      setName('')
      setReserve('')
    }
  }, [tx.phase, tx.id])
  const l = parseLink(img)
  const n = parseName(name)
  const p = currency ? parseTokenAmount(reserve, currency, { label: 'Starting bid' }) : undefined
  const erc20 = !!currency && !isEth(currency.address)
  return (
    <Stack>
      <Table>
        <thead>
          <tr>
            <th>#</th>
            <th>Status</th>
            <th>Top bid</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {ps.map((x) => {
            const ended = x.endTime > 0 && now >= x.endTime
            const status = x.settled
              ? 'Finished'
              : x.endTime === 0
              ? 'Waiting in line'
              : ended
              ? x.highBid > 0n
                ? 'Ended: ready to settle'
                : 'Ended: no bids'
              : `Live until ${new Date(x.endTime * 1000).toLocaleString()}`
            return (
              <tr key={x.tokenId}>
                <td>{x.tokenId}</td>
                <td>{status}</td>
                <td>{x.highBid > 0n ? money(x.highBid) : `from ${money(x.minBid)}`}</td>
                <td>
                  {!x.settled && ended && x.highBid > 0n && (
                    <SmallButton
                      type="button"
                      disabled={busy}
                      onClick={() => run(`settle-${x.tokenId}`, call('settleAuction', [x.tokenId]))}
                    >
                      Settle
                    </SmallButton>
                  )}
                  {!x.settled && ended && x.highBid === 0n && (
                    <SmallButton
                      type="button"
                      disabled={busy || !isOwner}
                      onClick={() => run(`reclaim-${x.tokenId}`, call('reclaimUnsold', [x.tokenId]))}
                    >
                      Close unsold
                    </SmallButton>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      {more.note && (
        <p>
          {more.note}{' '}
          <SmallButton type="button" onClick={more.onMore}>
            Show more
          </SmallButton>
        </p>
      )}
      {ps.map((x) => (
        <TxNote
          key={x.tokenId}
          tx={tx}
          id={tx.id?.endsWith(`-${x.tokenId}`) ? (tx.id as string) : ''}
          explorer={explorer}
        />
      ))}
      <Eyebrow>Put up another piece</Eyebrow>
      <Row2>
        <Field>
          Title
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
        </Field>
        <Field>
          Starting bid ({currency?.symbol ?? '…'})
          <input value={reserve} inputMode="decimal" placeholder="0.1" onChange={(e) => setReserve(e.target.value)} />
          <small>
            Paid now as a deposit. You get it back when the piece sells. If nobody bids, the deposit is lost: it goes
            to the protocol when the piece is closed.
            {erc20 && p?.ok && currency ? ` ${approveWords(p.amount, currency, 'this auction house')}` : ''}
          </small>
          <Err>{reserve && p && !p.ok ? p.error : undefined}</Err>
        </Field>
      </Row2>
      <Field>
        Artwork link
        <input value={img} placeholder="ipfs://… or ar://… or https://…" onChange={(e) => setImg(e.target.value)} />
        <Err>{img && !l.ok ? l.error : undefined}</Err>
      </Field>
      <div>
        <SmallButton
          type="button"
          disabled={busy || !isOwner || !l.ok || !n.ok || !p?.ok || !currency}
          onClick={() =>
            l.ok &&
            n.ok &&
            p?.ok &&
            currency &&
            pay('queue', {
              chainId,
              token: currency.address,
              spender: address,
              amount: p.amount,
              call: call(
                'queuePiece',
                [jsonDataUri(tokenJson({ name: n.name, description: '', image: l.uri, website: '' })), p.amount],
                { value: isEth(currency.address) ? p.amount : 0n }
              ),
            })
          }
        >
          Put it up ({p?.ok && currency ? tokenExact(p.amount, currency) : 'set a starting bid'})
        </SmallButton>
      </div>
      <TxNote tx={tx} id="queue" explorer={explorer} />
    </Stack>
  )
}

function EditionsTab({
  eds,
  run,
  busy,
  tx,
  explorer,
  address,
  chainId,
  isOwner,
  more,
  accepted,
  info,
}: Common & {
  eds: Ed[]
  address: Address
  chainId: SupportedChainId
  more: { note?: string; onMore: () => void }
  /** The tokens the collection accepts now (acceptedTokens), with what we know of each. */
  accepted: readonly PayToken[] | undefined
  info: Tokens
}) {
  const [title, setTitle] = useState('')
  const [img, setImg] = useState('')
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [copies, setCopies] = useState('')
  useEffect(() => {
    if (tx.phase === 'done' && tx.id === 'edition') {
      setTitle('')
      setImg('')
      setPrices({})
      setCopies('')
    }
  }, [tx.phase, tx.id])
  const n = parseName(title)
  const l = parseLink(img)
  const p = accepted
    ? buildPrices(prices, accepted, { required: true, allowZero: false, label: 'Price per copy' })
    : ({ ok: false, error: '' } as const)
  const typed = Object.values(prices).some((v) => !!v.trim())
  const c = parseWhole(copies, { min: 1, max: 1_000_000, label: 'Copies', blank: 0 })
  return (
    <Stack>
      <Table>
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Price</th>
            <th>Sold</th>
          </tr>
        </thead>
        <tbody>
          {eds.map((e) => (
            <tr key={e.id.toString()}>
              <td>{e.id.toString()}</td>
              <td>{e.pieceTitle}</td>
              <td>{priceListWords(e.prices, info)}</td>
              <td>{e.supply === 0n ? `${e.minted} (open)` : `${e.minted} / ${e.supply}`}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {more.note && (
        <p>
          {more.note}{' '}
          <SmallButton type="button" onClick={more.onMore}>
            Show more
          </SmallButton>
        </p>
      )}
      <Eyebrow>Add an edition</Eyebrow>
      <Row2>
        <Field>
          Title
          <input value={title} maxLength={64} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field>
          Artwork link
          <input value={img} placeholder="ipfs://… or ar://…" onChange={(e) => setImg(e.target.value)} />
          <Err>{img && !l.ok ? l.error : undefined}</Err>
        </Field>
      </Row2>
      <Row2>
        {(accepted || []).map((t) => (
          <Field key={t.address}>
            Price per copy ({t.symbol})
            <input
              value={prices[t.address.toLowerCase()] || ''}
              inputMode="decimal"
              onChange={(e) => setPrices((x) => ({ ...x, [t.address.toLowerCase()]: e.target.value }))}
            />
          </Field>
        ))}
        <Field>
          Number of copies
          <input
            value={copies}
            inputMode="numeric"
            placeholder="No limit"
            onChange={(e) => setCopies(e.target.value)}
          />
          <Err>{!c.ok ? c.error : undefined}</Err>
        </Field>
      </Row2>
      <Err>{typed && !p.ok ? p.error : !accepted ? "Couldn't read which tokens this collection takes." : undefined}</Err>
      <div>
        <SmallButton
          type="button"
          disabled={busy || !isOwner || !n.ok || !l.ok || !p.ok || !c.ok}
          onClick={() =>
            n.ok &&
            l.ok &&
            p.ok &&
            c.ok &&
            run('edition', {
              address,
              chainId,
              abi: erc1155InstanceAbi,
              functionName: 'addEdition',
              args: [
                n.name,
                p.prices,
                BigInt(c.n),
                jsonDataUri(tokenJson({ name: n.name, description: '', image: l.uri, website: '' })),
                c.n === 0 ? 0 : 1,
                0n,
                0n,
              ],
            })
          }
        >
          Add edition
        </SmallButton>
      </div>
      <TxNote tx={tx} id="edition" explorer={explorer} />
      <small style={{ color: color.inkMuted, fontFamily: font.ui }}>
        Copies can be bought in Mint, Music (for tracks) or straight from the contract.
      </small>
    </Stack>
  )
}

type Ed = { id: bigint; pieceTitle: string; supply: bigint; minted: bigint; prices: readonly Price[] }

const ROW_STYLE = { display: 'flex', gap: space[2], flexWrap: 'wrap', alignItems: 'center' } as const

const CLAIM_MODES: { mode: ClaimModeName; label: string; words: string }[] = [
  { mode: 'TOKENS', label: 'Take INFER and IMD', words: 'Both tokens go to your wallet as they are.' },
  {
    mode: 'REINVEST',
    label: 'Reinvest',
    words: 'Adds them back into the INFER/IMD pool for this collection. Nothing is sent to you.',
  },
  { mode: 'ETH', label: 'Take as ETH', words: 'Not available yet: it needs a live price quote to set a safe minimum.' },
]

/**
 * Money on a collection, per token (contracts/src/libraries/PaymentLib.sol): what withdraw(token) pays now, cuts
 * parked because the vault or treasury refused them (anyone may send them on), and the vault's fees for this
 * collection with the claim modes. Every read that fails shows "Couldn't check", never 0.
 */
function MoneyPanel({
  kind,
  address,
  chainId,
  tokens,
  tokensFailed,
  info,
  split,
  vault,
  isOwner,
  pay,
  explorer,
}: {
  kind: Exclude<LaunchKind, 'legacy' | 'unknown'>
  address: Address
  chainId: SupportedChainId
  /** knownTokens (drop, editions) or [currency] (auction); undefined while read. */
  tokens: readonly Address[] | undefined
  tokensFailed: boolean
  info: Tokens
  split: { p?: number; a?: number; vault?: Address }
  vault: { symbol?: string }
  isOwner: boolean
  pay: ReturnType<typeof usePay>
  explorer: string
}) {
  const { tx, run } = pay
  const busy = pay.busy || pay.unconfirmed
  const abi = kind === 'drop' ? dropInstanceAbi : kind === 'auction' ? auctionInstanceAbi : editionsManageAbi
  const list = tokens || []
  const perToken = ['ownerBalance', 'pendingVaultCut', 'pendingProtocolCut', ...(kind === 'auction' ? [] : ['unsplitProceeds'])]
  const reads = useReadContracts({
    allowFailure: true,
    contracts: list.flatMap((token) =>
      perToken.map((functionName) => ({ address, abi, functionName, args: [token], chainId }) as never)
    ),
    query: { enabled: list.length > 0 },
  })
  const fees = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: split.vault, abi: vaultAbi, functionName: 'claimable', args: [address], chainId },
      ...list.map((token) => ({
        address: split.vault,
        abi: vaultAbi,
        functionName: 'pendingOf' as const,
        args: [address, token] as const,
        chainId,
      })),
    ],
    query: { enabled: !!split.vault },
  })
  const [mode, setMode] = useState<ClaimModeName>('TOKENS')
  useEffect(() => {
    if (tx.phase === 'done') {
      reads.refetch()
      fees.refetch()
    }
  }, [tx.phase])

  const n = perToken.length
  const val = (i: number) => {
    const r = reads.data?.[i]
    return r?.status === 'success' ? (r.result as bigint) : undefined
  }
  const rows: TokenMoney[] = list.map((token, t) => ({
    token,
    payout: tokenPayout(val(t * n), kind === 'auction' ? 0n : val(t * n + 3), split.p, split.a),
    parkedVault: val(t * n + 1),
    parkedProtocol: val(t * n + 2),
  }))
  const any = anyPayout(rows)
  const loading = (!tokens && !tokensFailed) || reads.isLoading
  const amount = (v: bigint | undefined, token: Address) => {
    const unit = info[token.toLowerCase()]
    if (v === undefined || !unit) return loading ? '…' : "Couldn't check"
    return tokenLabel(v, unit)
  }
  const parked = rows.filter((r) => (r.parkedVault ?? 0n) > 0n || (r.parkedProtocol ?? 0n) > 0n)
  const ethAuction = kind === 'auction' && list.length === 1 && isEth(list[0] as Address)

  const claim = fees.data?.[0]
  const claimable =
    claim?.status === 'success'
      ? (() => {
          const [infer, imd, eth] = claim.result as readonly [bigint, bigint, bigint]
          return { infer, imd, eth }
        })()
      : undefined
  const queued = list
    .map((token, i) => ({ token, v: fees.data?.[i + 1]?.status === 'success' ? (fees.data[i + 1]!.result as bigint) : undefined }))
    .filter((q) => q.v !== undefined && q.v > 0n)
  const claimCall = claimArgs(mode)

  const call = (functionName: string, args: unknown[] = []) => ({ address, chainId, abi, functionName, args })

  return (
    <>
      <Eyebrow>Your money, per token</Eyebrow>
      <p>
        You collect each token exactly as buyers paid it. Nothing is converted.
        {kind !== 'auction' && split.p !== undefined && split.a !== undefined
          ? ` Withdraw first splits sales not split yet: ${pctLabel(split.a)} to the vault, ${pctLabel(
              split.p
            )} to miya, the rest to you.`
          : ''}
      </p>
      {ethAuction ? (
        <p>Each ETH sale pays out by itself when its auction is settled.</p>
      ) : tokensFailed ? (
        <p>Couldn&apos;t read which tokens this collection takes. Try again later.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Ready to withdraw</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const unit = info[r.token.toLowerCase()]
              return (
                <tr key={r.token}>
                  <td>{unit?.symbol ?? `${r.token.slice(0, 6)}…`}</td>
                  <td>{amount(r.payout, r.token)}</td>
                  <td>
                    <SmallButton
                      type="button"
                      disabled={busy || !isOwner || !r.payout}
                      onClick={() => run(`withdraw-${r.token}`, call('withdraw', [r.token]))}
                    >
                      {r.payout && unit ? `Withdraw ${tokenLabel(r.payout, unit)}` : 'Withdraw'}
                    </SmallButton>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
      {!ethAuction && list.length > 1 && (
        <div>
          <BigButton
            type="button"
            disabled={busy || !isOwner || !any}
            onClick={() => run('withdraw-all', call('withdrawAll'))}
          >
            {any === undefined ? (loading ? 'Checking sales…' : "Couldn't check sales") : any ? 'Withdraw all' : 'Nothing to withdraw yet'}
          </BigButton>
        </div>
      )}
      {rows.map((r) => (
        <TxNote key={r.token} tx={tx} id={tx.id === `withdraw-${r.token}` ? tx.id : ''} explorer={explorer} />
      ))}
      <TxNote tx={tx} id="withdraw-all" explorer={explorer} />

      {parked.length > 0 && (
        <Well style={{ padding: space[3], display: 'flex', flexDirection: 'column', gap: space[2] }}>
          <Eyebrow>Cuts waiting to be sent</Eyebrow>
          <p>
            The vault or miya&apos;s treasury turned these down (for example a vault cut below its minimum). They are
            held apart from your money and go along with the next sale in that token. Anyone can send them now; if the
            vault still turns a cut down, it stays here.
          </p>
          {parked.map((r) => (
            <div key={r.token} style={ROW_STYLE}>
              {(r.parkedVault ?? 0n) > 0n && (
                <SmallButton
                  type="button"
                  disabled={busy}
                  onClick={() => run(`flush-vault-${r.token}`, call('flushPendingVaultCut', [r.token, 0n]))}
                >
                  Send {amount(r.parkedVault, r.token)} to the vault
                </SmallButton>
              )}
              {(r.parkedProtocol ?? 0n) > 0n && (
                <SmallButton
                  type="button"
                  disabled={busy}
                  onClick={() => run(`flush-protocol-${r.token}`, call('flushPendingProtocolCut', [r.token]))}
                >
                  Send {amount(r.parkedProtocol, r.token)} to miya
                </SmallButton>
              )}
              <TxNote tx={tx} id={tx.id?.endsWith(r.token) && tx.id.startsWith('flush') ? tx.id : ''} explorer={explorer} />
            </div>
          ))}
        </Well>
      )}

      <Eyebrow>Vault fees</Eyebrow>
      <p>
        {vault.symbol
          ? `Your vault share went in as paid and becomes ${vault.symbol} liquidity, in batches. It stays in the pool for good. The pool's trading fees are paid in INFER and IMD.`
          : 'The vault pays its trading fees to collections that sent it a share.'}
      </p>
      {queued.length > 0 && (
        <p>
          Waiting for the vault&apos;s next batch:{' '}
          {queued.map((q) => amount(q.v, q.token)).join(', ')}.
        </p>
      )}
      <Stats>
        <dt>Fees ready</dt>
        <dd>
          {claimable ? feesWords(claimable) : fees.isLoading || !split.vault ? '…' : "Couldn't check"}
        </dd>
      </Stats>
      <div role="radiogroup" aria-label="How to take the fees" style={{ display: 'grid', gap: space[1] }}>
        {CLAIM_MODES.map((m) => (
          <label key={m.mode} style={{ display: 'flex', gap: space[2], alignItems: 'baseline' }}>
            <input
              type="radio"
              name={`claim-${address}`}
              checked={mode === m.mode}
              disabled={m.mode === 'ETH'}
              onChange={() => setMode(m.mode)}
            />
            <span>
              <b>{m.label}</b>. <span style={{ color: color.inkMuted }}>{m.words}</span>
            </span>
          </label>
        ))}
      </div>
      <div>
        <SmallButton
          type="button"
          disabled={busy || !isOwner || !claimCall.ok || !claimable || !hasFees(claimable)}
          onClick={() => claimCall.ok && run('fees', call('claimVaultFees', [...claimCall.args]))}
        >
          {claimable && !hasFees(claimable)
            ? 'No fees to claim yet'
            : mode === 'REINVEST'
            ? 'Reinvest my vault fees'
            : 'Claim my vault fees'}
        </SmallButton>
      </div>
      <TxNote tx={tx} id="fees" explorer={explorer} />
    </>
  )
}

/** Manage a collection made by the miyamints factories: overview + payouts, then per-kind tabs. */
export default function MiyamintsManage({
  chainId,
  address,
  kind,
  isOwner,
}: {
  chainId: SupportedChainId
  address: Address
  kind: Exclude<LaunchKind, 'legacy' | 'unknown'>
  isOwner: boolean
}) {
  const [tab, setTab] = useState('overview')
  const [limit, setLimit] = useState(PAGE)
  const explorer = explorerUrl(chainId)
  const a = miyamintsAddresses(chainId)

  const dropReads = useReadContracts({
    allowFailure: true,
    contracts: (
      [
        'totalSupply',
        'maxSupply',
        'protocolBps',
        'alignmentBps',
        'vault',
        'baseURI',
        'unrevealedURI',
        'contractURI',
        'metadataLocked',
        'phases',
        'ownerReserve',
        'ownerMinted',
        'royaltyLocked',
      ] as const
    ).map((functionName) => ({ address, abi: dropInstanceAbi, functionName, chainId })),
    query: { enabled: kind === 'drop' },
  })
  const auctionReads = useReadContracts({
    allowFailure: true,
    contracts: (['nextTokenId', 'protocolFeeBps', 'alignmentBps', 'vault', 'baseDuration', 'currency'] as const).map(
      (functionName) => ({ address, abi: auctionInstanceAbi, functionName, chainId })
    ),
    query: { enabled: kind === 'auction' },
  })
  const editionReads = useReadContracts({
    allowFailure: true,
    contracts: (['protocolFeeBps', 'alignmentBps', 'vault'] as const).map((functionName) => ({
      address,
      abi: editionsManageAbi,
      functionName,
      chainId,
    })),
    query: { enabled: kind === 'editions' },
  })
  // Every token ever accepted (a delisted one stays withdrawable), and the ones on sale now.
  const tokenReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address, abi: kind === 'drop' ? dropInstanceAbi : editionsManageAbi, functionName: 'knownTokens', chainId },
      { address, abi: kind === 'drop' ? dropInstanceAbi : editionsManageAbi, functionName: 'acceptedTokens', chainId },
    ],
    query: { enabled: kind !== 'auction' },
  })
  const editionIds = useReadContract({
    address,
    abi: erc1155InstanceAbi,
    functionName: 'getAllEditionIds',
    chainId,
    query: { enabled: kind === 'editions' },
  })
  const editions = useReadContracts({
    allowFailure: true,
    contracts: ((editionIds.data as readonly bigint[] | undefined) || []).slice(0, limit).map((id) => ({
      address,
      abi: erc1155InstanceAbi,
      functionName: 'getEdition' as const,
      args: [id] as const,
      chainId,
    })),
    query: { enabled: kind === 'editions' && !!editionIds.data },
  })
  // Every edition (up to TOTALS_CAP) for the overview's totals: the table's page is not the whole collection.
  const allEditions = useReadContracts({
    allowFailure: true,
    contracts: ((editionIds.data as readonly bigint[] | undefined) || []).slice(0, TOTALS_CAP).map((id) => ({
      address,
      abi: erc1155InstanceAbi,
      functionName: 'getEdition' as const,
      args: [id] as const,
      chainId,
    })),
    query: { enabled: kind === 'editions' && !!editionIds.data },
  })
  const pieceCount = kind === 'auction' ? Number((auctionReads.data?.[0]?.result as number | undefined) ?? 1) - 1 : 0
  const pieces = useReadContracts({
    allowFailure: true,
    contracts: Array.from({ length: Math.min(pieceCount, limit) }, (_, i) => ({
      address,
      abi: auctionInstanceAbi,
      functionName: 'getAuction' as const,
      args: [i + 1] as const,
      chainId,
    })),
    query: { enabled: kind === 'auction' && pieceCount > 0 },
  })

  const refetchAll = () => {
    dropReads.refetch()
    auctionReads.refetch()
    editionReads.refetch()
    tokenReads.refetch()
    editionIds.refetch()
    editions.refetch()
    allEditions.refetch()
    pieces.refetch()
  }

  const payer = usePay(() => refetchAll())
  const { tx, run, busy: sending, unconfirmed, reset } = payer
  // Sent, but unread: it may still land, so nothing is pressed twice until someone says to start over.
  const busy = sending || unconfirmed
  const r = <T,>(q: typeof dropReads | typeof auctionReads | typeof editionReads, i: number) =>
    q.data?.[i]?.status === 'success' ? (q.data[i]!.result as T) : undefined

  const split =
    kind === 'drop'
      ? { p: r<number>(dropReads, 2), a: r<number>(dropReads, 3), vault: r<Address>(dropReads, 4) }
      : kind === 'auction'
      ? { p: r<number>(auctionReads, 1), a: r<number>(auctionReads, 2), vault: r<Address>(auctionReads, 3) }
      : { p: r<number>(editionReads, 0), a: r<number>(editionReads, 1), vault: r<Address>(editionReads, 2) }
  const vault = useVaultInfo(chainId, a.registry, split.vault)

  const currencyAddr = kind === 'auction' ? r<Address>(auctionReads, 5) : undefined
  const read = (i: number) =>
    tokenReads.data?.[i]?.status === 'success' ? (tokenReads.data[i]!.result as readonly Address[]) : undefined
  const known = kind === 'auction' ? (currencyAddr ? [currencyAddr] : undefined) : read(0)
  const acceptedAddrs = kind === 'auction' ? known : read(1)
  const tokensFailed =
    kind === 'auction'
      ? !auctionReads.isLoading && !currencyAddr
      : !tokenReads.isLoading && (tokenReads.isError || (!!tokenReads.data && !known))
  const eds = (editions.data || []).map((e) => e.result as Ed | undefined).filter(Boolean) as Ed[]
  const allPriced = Array.from(
    new Set([
      ...(known || []),
      ...(acceptedAddrs || []),
      ...eds.flatMap((e) => e.prices.map((p) => p.token)),
      ...(((dropReads.data?.[9]?.result as { prices: readonly Price[] }[] | undefined) || []).flatMap((ph) =>
        ph.prices.map((p) => p.token)
      )),
    ])
  )
  const info = useTokenInfo(chainId, allPriced)
  const accepted = acceptedAddrs?.every((t) => info[t.toLowerCase()])
    ? (acceptedAddrs.map((t) => info[t.toLowerCase()]) as PayToken[])
    : undefined
  const currency = currencyAddr ? info[currencyAddr.toLowerCase()] : undefined

  type Piece = {
    tokenId: number
    minBid: bigint
    highBid: bigint
    highBidder: Address
    endTime: number
    startTime: number
    settled: boolean
  }
  const ps = (pieces.data || []).map((p) => p.result as Piece | undefined).filter(Boolean) as Piece[]

  const edTotals = editionTotals(
    allEditions.data?.map((e) => (e.status === 'success' ? (e.result as Ed) : undefined)),
    (editionIds.data as readonly bigint[] | undefined)?.length
  )
  const minted =
    kind === 'drop' ? r<bigint>(dropReads, 0) : kind === 'auction' ? BigInt(pieceCount) : edTotals.minted
  const supply = kind === 'drop' ? BigInt(r<number>(dropReads, 1) ?? 0) : kind === 'editions' ? edTotals.supply : undefined
  const soldFailed = kind === 'editions' && (!!editionIds.error || (!!allEditions.data && minted === undefined))

  const totalEditions = (editionIds.data as readonly bigint[] | undefined)?.length
  const editionsMore = {
    note: cappedNote(Math.min(limit, totalEditions ?? 0), totalEditions, 'editions'),
    onMore: () => setLimit((n) => n + PAGE),
  }
  const piecesMore = {
    note: cappedNote(Math.min(limit, pieceCount), pieceCount, 'pieces'),
    onMore: () => setLimit((n) => n + PAGE),
  }

  const call = (fn: string, args: unknown[] = [], extra: Record<string, unknown> = {}) => ({
    address,
    chainId,
    abi: kind === 'drop' ? dropInstanceAbi : kind === 'auction' ? auctionInstanceAbi : editionsManageAbi,
    functionName: fn,
    args,
    ...extra,
  })

  const overview = (
    <Stack>
      <Stats>
        <dt>Sold</dt>
        <dd>
          {soldFailed
            ? "Couldn't check"
            : progressLabel(kind, minted, supply)
            ? `${progressLabel(kind, minted, supply)}${kind === 'editions' && edTotals.scope ? ` (${edTotals.scope})` : ''}`
            : '…'}
        </dd>
        <dt>{kind === 'auction' ? 'Bids in' : 'Buyers pay in'}</dt>
        <dd>
          {acceptedAddrs
            ? acceptedAddrs.map((t) => info[t.toLowerCase()]?.symbol ?? `${t.slice(0, 6)}…`).join(', ')
            : tokensFailed
            ? "Couldn't check"
            : '…'}
        </dd>
        <dt>Vault</dt>
        <dd>
          {vault.symbol ? `${vault.symbol} liquidity` : 'Alignment vault'}{' '}
          {split.vault && (
            <a
              href={`${explorer}/address/${split.vault}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: color.link }}
            >
              {split.vault.slice(0, 6)}…{split.vault.slice(-4)}
            </a>
          )}
        </dd>
      </Stats>
      {split.p !== undefined && split.a !== undefined && (
        <Well style={{ padding: space[3] }}>
          <Eyebrow style={{ marginBottom: space[2] }}>Where the money goes (fixed at launch)</Eyebrow>
          <SplitMeter protocolBps={split.p} alignmentBps={split.a} vaultName={vault.symbol} />
        </Well>
      )}
      <MoneyPanel
        kind={kind}
        address={address}
        chainId={chainId}
        tokens={known}
        tokensFailed={tokensFailed}
        info={info}
        split={split}
        vault={vault}
        isOwner={isOwner}
        pay={payer}
        explorer={explorer}
      />
    </Stack>
  )

  return (
    <>
      {unconfirmed && (
        <SmallButton type="button" onClick={reset}>
          Start over
        </SmallButton>
      )}
    <Tabs
      active={tab}
      fillHeight={false}
      fillWidth
      onChange={setTab}
      tabs={[
        { title: 'Overview', id: 'overview', children: overview },
        ...(kind === 'drop'
          ? [
              {
                title: 'Metadata',
                id: 'metadata',
                children: <DropMetadata {...{ dropReads, run, busy, tx, explorer, call, isOwner }} />,
              },
              {
                title: 'Actions',
                id: 'actions',
                children: <DropActions {...{ run, busy, tx, explorer, call, isOwner, dropReads, info }} />,
              },
            ]
          : []),
        ...(kind === 'auction'
          ? [
              {
                title: 'Pieces',
                id: 'pieces',
                children: (
                  <AuctionPieces
                    {...{ ps, run, busy, tx, explorer, call, isOwner, currency, address, chainId }}
                    pay={payer.pay}
                    more={piecesMore}
                  />
                ),
              },
            ]
          : []),
        ...(kind === 'editions'
          ? [
              {
                title: 'Editions',
                id: 'editions',
                children: (
                  <EditionsTab
                    {...{ eds, run, busy, tx, explorer, address, chainId, isOwner, accepted, info }}
                    more={editionsMore}
                  />
                ),
              },
            ]
          : []),
      ]}
    />
    </>
  )
}
