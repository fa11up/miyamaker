import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { Address } from 'viem'
import styled from 'styled-components/macro'

import { refLink, refRewardWords, refStatsWords } from '@/miyamints/referral'
import type { RefStats } from '@/miyamints/referral'
import { knownToken, tokenLabel } from '@/miyamints/tokens'
import { LCD_FONT } from '@/pages/Mint/handheld/Device'
import { Field, Note, OptionGroup } from '@/pages/Mint/handheld/Options'

const Row = styled.div`
  display: flex;
  gap: 6px;
`

const Copy = styled.button`
  && {
    flex: none;
    min-height: 40px;
    padding: 0 12px;
    border: 1px solid rgba(190, 240, 255, 0.6);
    border-radius: 5px;
    background: rgba(4, 12, 28, 0.85);
    color: #f1eeff;
    font-family: ${LCD_FONT};
    font-size: 15px;
    cursor: pointer;
  }
  &:focus-visible {
    outline: 2px dashed #fff35c;
    outline-offset: 2px;
  }
`

/** This mint's ref link for the connected wallet, and what a referrer earns (the owner's rates in referral.ts). */
export default function ShareLink({ wallet, drop, chainId }: { wallet: Address; drop: Address; chainId: number }) {
  const [copied, setCopied] = useState(false)
  // What the link has brought so far (api/_lib/referrals.ts). A drop the stats don't follow (404) shows nothing; a
  // failed read says so, never "no mints yet".
  const stats = useQuery({
    queryKey: ['ref-stats', chainId, drop.toLowerCase(), wallet.toLowerCase()],
    queryFn: async (): Promise<RefStats | null> => {
      const res = await fetch(`/api/referrals?drop=${drop}&ref=${wallet}`)
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`stats ${res.status}`)
      return (await res.json()) as RefStats
    },
    refetchInterval: 5 * 60_000,
    retry: 1,
  })
  const amount = (token: string, v: bigint) => {
    const t = knownToken(chainId, token)
    return t ? tokenLabel(v, t) : `${v} of ${token.slice(0, 6)}…${token.slice(-4)}`
  }
  const link = refLink(window.location.origin, window.location.pathname, wallet)
  return (
    <OptionGroup legend="Your link">
      <Row>
        <Field
          aria-label="Your ref link for this mint"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
        />
        <Copy
          type="button"
          onClick={() =>
            navigator.clipboard?.writeText(link).then(
              () => setCopied(true),
              () => setCopied(false)
            )
          }
        >
          {copied ? 'Copied' : 'Copy'}
        </Copy>
      </Row>
      <Note>{refRewardWords(Date.now() / 1000)}</Note>
      {stats.isError && <Note>Couldn’t load your link’s stats. Try again later.</Note>}
      {stats.data && <Note>{refStatsWords(stats.data, amount)}</Note>}
    </OptionGroup>
  )
}
