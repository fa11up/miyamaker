import { useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { isAddress, parseAbi } from 'viem'
import { useBalance, useReadContract, useReadContracts } from 'wagmi'

import { Err, Field, Row2, SmallButton, SplitMeter } from '@/components/LaunchKit'
import { BigButton, Eyebrow, StatusBox, Well } from '@/components/Retro'
import Tabs from '@/components/Tabs'
import type { SupportedChainId } from '@/config/wagmi'
import { explorerUrl } from '@/config/wagmi'
import { miyamintsAddresses } from '@/constants/contracts'
import { auctionInstanceAbi, dropInstanceAbi, editionsManageAbi, erc1155InstanceAbi } from '@/miyamints/abi'
import type { LaunchKind } from '@/miyamints/collections'
import { progressLabel } from '@/miyamints/collections'
import { jsonDataUri, parseEth, parseLink, parseName, parseWhole, tokenJson } from '@/miyamints/launch'
import { ethLabel } from '@/miyamints/split'
import { useVaultInfo } from '@/miyamints/useMiyamints'
import { txWords, useTx } from '@/miyamints/useTx'
import { color, font, space, text } from '@/theme/tokens'

import { cappedNote, dropWaiting, editionsWaiting } from './payout'

/** Parked cuts ERC721DropInstance.withdraw() leaves out of the payout (not in the shared drop ABI). */
const dropPendingAbi = parseAbi([
  'function pendingVaultCut() view returns (uint256)',
  'function pendingProtocolCut() view returns (uint256)',
])

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

function TxNote({ tx, id, explorer }: { tx: ReturnType<typeof useTx>['tx']; id: string; explorer: string }) {
  if (tx.id !== id || tx.phase === 'idle') return null
  const tone = tx.phase === 'error' ? 'error' : tx.phase === 'done' ? 'ok' : 'info'
  return (
    <StatusBox tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <span>
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
  run: ReturnType<typeof useTx>['run']
  busy: boolean
  tx: ReturnType<typeof useTx>['tx']
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
}: Common & { call: CallFn; dropReads: { data?: readonly { result?: unknown }[] } }) {
  const [to, setTo] = useState('')
  const [qty, setQty] = useState('1')
  useEffect(() => {
    if (tx.phase === 'done' && tx.id === 'gift') {
      setTo('')
      setQty('1')
    }
  }, [tx.phase, tx.id])
  const q = parseWhole(qty, { min: 1, max: 500, label: 'Amount' })
  type Ph = { start: bigint; end: bigint; price: bigint; maxPerWallet: number; supplyCap: number }
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
              <td>{p.price === 0n ? 'Free' : ethLabel(p.price)}</td>
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
}: Common & {
  call: CallFn
  ps: { tokenId: number; minBid: bigint; highBid: bigint; highBidder: Address; endTime: number; settled: boolean }[]
  more: { note?: string; onMore: () => void }
}) {
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
  const p = parseEth(reserve, { label: 'Starting bid' })
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
                <td>{x.highBid > 0n ? ethLabel(x.highBid) : `from ${ethLabel(x.minBid)}`}</td>
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
          Starting bid (ETH)
          <input value={reserve} inputMode="decimal" placeholder="0.1" onChange={(e) => setReserve(e.target.value)} />
          <small>
            Paid now as a deposit. You get it back when the piece sells. If nobody bids, the deposit is lost: it goes
            to the protocol when the piece is closed.
          </small>
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
          disabled={busy || !isOwner || !l.ok || !n.ok || !p.ok}
          onClick={() =>
            l.ok &&
            n.ok &&
            p.ok &&
            run(
              'queue',
              call(
                'queuePiece',
                [jsonDataUri(tokenJson({ name: n.name, description: '', image: l.uri, website: '' }))],
                {
                  value: p.wei,
                }
              )
            )
          }
        >
          Put it up ({p.ok ? ethLabel(p.wei) : 'set a starting bid'})
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
}: Common & {
  eds: { id: bigint; pieceTitle: string; basePrice: bigint; supply: bigint; minted: bigint }[]
  address: Address
  chainId: SupportedChainId
  more: { note?: string; onMore: () => void }
}) {
  const [title, setTitle] = useState('')
  const [img, setImg] = useState('')
  const [price, setPrice] = useState('')
  const [copies, setCopies] = useState('')
  useEffect(() => {
    if (tx.phase === 'done' && tx.id === 'edition') {
      setTitle('')
      setImg('')
      setPrice('')
      setCopies('')
    }
  }, [tx.phase, tx.id])
  const n = parseName(title)
  const l = parseLink(img)
  const p = parseEth(price)
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
              <td>{ethLabel(e.basePrice)}</td>
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
        <Field>
          Price per copy (ETH)
          <input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} />
          <Err>{price && !p.ok ? p.error : undefined}</Err>
        </Field>
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
                p.wei,
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
    contracts: (['nextTokenId', 'protocolFeeBps', 'alignmentBps', 'vault', 'baseDuration'] as const).map(
      (functionName) => ({ address, abi: auctionInstanceAbi, functionName, chainId })
    ),
    query: { enabled: kind === 'auction' },
  })
  const editionReads = useReadContracts({
    allowFailure: true,
    contracts: (['protocolFeeBps', 'alignmentBps', 'vault', 'totalProceeds', 'totalWithdrawn'] as const).map(
      (functionName) => ({ address, abi: editionsManageAbi, functionName, chainId })
    ),
    query: { enabled: kind === 'editions' },
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
  const balance = useBalance({ address, chainId, query: { enabled: kind === 'drop' } })
  const dropPending = useReadContracts({
    allowFailure: true,
    contracts: (['pendingVaultCut', 'pendingProtocolCut'] as const).map((functionName) => ({
      address,
      abi: dropPendingAbi,
      functionName,
      chainId,
    })),
    query: { enabled: kind === 'drop' },
  })

  const refetchAll = () => {
    dropReads.refetch()
    auctionReads.refetch()
    editionReads.refetch()
    editionIds.refetch()
    editions.refetch()
    pieces.refetch()
    balance.refetch()
    dropPending.refetch()
  }

  const { tx, run, busy: sending, unconfirmed, reset } = useTx(() => refetchAll())
  // Sent, but unread: it may still land, so nothing is pressed twice until someone says to start over.
  const busy = sending || unconfirmed
  const r = <T,>(q: typeof dropReads | typeof auctionReads | typeof editionReads, i: number) =>
    q.data?.[i]?.result as T | undefined

  const split =
    kind === 'drop'
      ? { p: r<number>(dropReads, 2), a: r<number>(dropReads, 3), vault: r<Address>(dropReads, 4) }
      : kind === 'auction'
      ? { p: r<number>(auctionReads, 1), a: r<number>(auctionReads, 2), vault: r<Address>(auctionReads, 3) }
      : { p: r<number>(editionReads, 0), a: r<number>(editionReads, 1), vault: r<Address>(editionReads, 2) }
  const vault = useVaultInfo(chainId, a.registry, split.vault)

  type Ed = { id: bigint; pieceTitle: string; basePrice: bigint; supply: bigint; minted: bigint }
  const eds = (editions.data || []).map((e) => e.result as Ed | undefined).filter(Boolean) as Ed[]
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

  const minted =
    kind === 'drop'
      ? r<bigint>(dropReads, 0)
      : kind === 'auction'
      ? BigInt(pieceCount)
      : eds.reduce((s, e) => s + e.minted, 0n)
  const supply =
    kind === 'drop'
      ? BigInt(r<number>(dropReads, 1) ?? 0)
      : kind === 'editions' && eds.length && !eds.some((e) => e.supply === 0n)
      ? eds.reduce((s, e) => s + e.supply, 0n)
      : undefined

  // What withdraw() would really pay; undefined when any read behind it failed.
  const waiting =
    kind === 'editions'
      ? editionsWaiting(r<bigint>(editionReads, 3), r<bigint>(editionReads, 4))
      : kind === 'drop'
      ? dropWaiting(
          balance.data?.value,
          dropPending.data?.[0]?.result as bigint | undefined,
          dropPending.data?.[1]?.result as bigint | undefined
        )
      : 0n
  const waitingLoading =
    kind === 'editions' ? editionReads.isLoading : kind === 'drop' ? balance.isLoading || dropPending.isLoading : false
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
        <dd>{progressLabel(kind, minted, supply) || '…'}</dd>
        {kind !== 'auction' && (
          <>
            <dt>Sales waiting</dt>
            <dd>{waiting !== undefined ? ethLabel(waiting) : waitingLoading ? '…' : "Couldn't check"}</dd>
          </>
        )}
        <dt>Vault</dt>
        <dd>
          {vault.symbol ? `Buys ${vault.symbol}` : 'Alignment vault'}{' '}
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
      {kind !== 'auction' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}>
          <BigButton
            type="button"
            disabled={busy || waiting === undefined || waiting === 0n || !isOwner}
            onClick={() => waiting && run('withdraw', call('withdraw', kind === 'editions' ? [waiting] : []))}
          >
            {waiting === undefined
              ? waitingLoading
                ? 'Checking sales…'
                : "Couldn't check sales. Try again later."
              : waiting === 0n
              ? 'Nothing to pay out yet'
              : `Pay out ${ethLabel(waiting)}`}
          </BigButton>
          <small style={{ color: color.inkMuted }}>Splits the sales as shown above and sends your part to you.</small>
          <TxNote tx={tx} id="withdraw" explorer={explorer} />
        </div>
      )}
      {kind === 'auction' && <p>Each sale pays out by itself when its auction is settled.</p>}
      <div>
        <SmallButton type="button" disabled={busy || !isOwner} onClick={() => run('fees', call('claimVaultFees'))}>
          Claim my vault trading fees
        </SmallButton>
      </div>
      <TxNote tx={tx} id="fees" explorer={explorer} />
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
                children: <DropActions {...{ run, busy, tx, explorer, call, isOwner, dropReads }} />,
              },
            ]
          : []),
        ...(kind === 'auction'
          ? [
              {
                title: 'Pieces',
                id: 'pieces',
                children: <AuctionPieces {...{ ps, run, busy, tx, explorer, call, isOwner }} more={piecesMore} />,
              },
            ]
          : []),
        ...(kind === 'editions'
          ? [
              {
                title: 'Editions',
                id: 'editions',
                children: <EditionsTab {...{ eds, run, busy, tx, explorer, address, chainId, isOwner }} more={editionsMore} />,
              },
            ]
          : []),
      ]}
    />
    </>
  )
}
