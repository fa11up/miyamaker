import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import styled from 'styled-components/macro'

import { Chip, Eyebrow, Panel, Skeleton, Well } from '@/components/Retro'
import { LINKS } from '@/constants/miyanet'
import { bevel, color, font, space, text } from '@/theme/tokens'

/**
 * Search the IdentityMD swarm from inside miyanet. Matching runs locally over INFER BOX's public skill list
 * (CORS-open, no sign-in). Evaluating and paying for a request needs a BOX sign-in on box.imdusd.com, which
 * refuses to be framed, so the last step hands the query over in a new tab as ?q= (BOX prefills its idea box after sign-in; also copied
 * to the clipboard as a fallback).
 */
type Skill = { id: string; role: string; description: string; accepted: number; attempts: number }
type SwarmHealth = { agentsOnline: number; seatsEnrolled: number; acceptedLastDay: number; jobsDoneLastDay: number }
type SwarmResponse = { health: SwarmHealth; skills: Skill[] }

const SWARM_URL = `${LINKS.box}api/public/swarm`
const MAX_RESULTS = 6

const SearchForm = styled.form`
  display: grid;
  grid-template-columns: 1fr auto;
  height: 44px;
  input {
    min-width: 0;
    border: none;
    border-radius: 0;
    background: ${color.well};
    box-shadow: ${bevel.field};
    padding: 0 ${space[3]};
    font-size: ${text.lg};
  }
  button {
    border: none;
    padding: 0 ${space[4]};
    background: ${color.accent};
    color: ${color.highlight};
    font-family: ${font.display};
    text-shadow: 1px 1px 0 ${color.accentDark};
    box-shadow: inset -2px -2px ${color.accentDark}, inset 2px 2px #f5c6f6;
    cursor: pointer;
  }
`

const Results = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
`

const Result = styled(Well).attrs({ as: 'li' })`
  padding: ${space[2]} ${space[3]};
  display: flex;
  flex-direction: column;
  gap: 2px;
  strong {
    font-family: ${font.mono};
    font-size: ${text.xs};
    color: ${color.link};
  }
  span {
    font-family: ${font.body};
    font-size: ${text.xs};
    line-height: 1.5;
    color: ${color.ink};
  }
`

const Meta = styled.div`
  display: flex;
  gap: ${space[2]};
  flex-wrap: wrap;
  align-items: center;
  font-size: ${text.xs};
  color: ${color.inkMuted};
  a {
    color: ${color.link};
  }
`

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) || []

/** Rank skills by how many query words hit the id/description, ties broken by how often the swarm accepts them. */
export function rankSkills(skills: Skill[], query: string): Skill[] {
  const q = words(query).filter((w) => w.length > 2)
  if (!q.length) return []
  return skills
    .map((s) => {
      const hay = `${s.id.replace(/-/g, ' ')} ${s.description}`.toLowerCase()
      const score = q.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0)
      return { s, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.s.accepted - a.s.accepted)
    .slice(0, MAX_RESULTS)
    .map((r) => r.s)
}

export default function SwarmSearch() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const swarm = useQuery({
    queryKey: ['box-swarm'],
    queryFn: async () => {
      const res = await fetch(SWARM_URL)
      if (!res.ok) throw new Error(`BOX ${res.status}`)
      return (await res.json()) as SwarmResponse
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  const results = useMemo(() => rankSkills(swarm.data?.skills || [], query), [swarm.data, query])
  const h = swarm.data?.health

  const openBox = async () => {
    try {
      if (query) await navigator.clipboard.writeText(query)
      setCopied(!!query)
    } catch {
      setCopied(false)
    }

    window.open(query ? `${LINKS.box}?q=${encodeURIComponent(query)}#box` : LINKS.box, '_blank', 'noopener,noreferrer')
  }

  return (
    <Panel style={{ gridArea: 'search' }} aria-label="Search the swarm">
      <Meta style={{ justifyContent: 'space-between' }}>
        <Eyebrow>INFER BOX · ask the swarm</Eyebrow>
        {swarm.isLoading ? (
          <Chip tone="off">Connecting</Chip>
        ) : swarm.isError ? (
          <Chip tone="warn">BOX unreachable</Chip>
        ) : (
          <Chip tone="ok">{h?.agentsOnline.toLocaleString('en-US')} agents online</Chip>
        )}
      </Meta>
      <SearchForm
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          setQuery(input.trim())
          setCopied(false)
        }}
      >
        <input
          aria-label="What do you want built, answered or checked?"
          placeholder="build a mint site, audit my contract, make a token logo…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit">Search</button>
      </SearchForm>

      {swarm.isLoading && query && <Skeleton h="48px" />}
      {query && !swarm.isLoading && (
        <>
          {results.length ? (
            <Results>
              {results.map((s) => (
                <Result key={s.id}>
                  <strong>{s.id}</strong>
                  <span>{s.description}</span>
                  <Meta>
                    {s.role} · accepted {s.attempts ? Math.round((s.accepted / s.attempts) * 100) : 0}% of{' '}
                    {s.attempts.toLocaleString('en-US')} tries
                  </Meta>
                </Result>
              ))}
            </Results>
          ) : (
            <Meta>No skill matches those words. INFER BOX can still sharpen the idea with you.</Meta>
          )}
          <Meta>
            <button type="button" onClick={openBox}>
              Send to INFER BOX ↗
            </button>
            <span>
              {copied
                ? 'Your idea is waiting in BOX (and copied). Sign in, evaluate, and pay in imdUSD if it passes.'
                : 'BOX checks your idea, quotes it, and the swarm runs it once you pay in imdUSD.'}
            </span>
          </Meta>
        </>
      )}
      {h && !query && (
        <Meta>
          {h.jobsDoneLastDay} jobs done and {h.acceptedLastDay.toLocaleString('en-US')} answers accepted in the last day
          across {swarm.data?.skills.length} skills.
        </Meta>
      )}
    </Panel>
  )
}
