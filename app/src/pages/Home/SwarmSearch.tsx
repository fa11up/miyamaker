import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import styled from 'styled-components/macro'

import { Chip, Skeleton } from '@/components/Retro'
import { LINKS } from '@/constants/miyanet'
import { bevel, color, font, space, text } from '@/theme/tokens'

import { PushButton, y2k } from './y2k'

/**
 * Search the IdentityMD swarm from inside miyanet. Matching runs locally over INFER BOX's public skill list
 * (CORS-open, no sign-in). Evaluating and paying for a request needs a BOX sign-in on box.imdusd.com, which
 * refuses to be framed, so the last step hands the query over in a new tab as ?q= (BOX prefills its idea box after sign-in; also copied
 * to the clipboard as a fallback).
 */
type Skill = { id: string; role: string; description: string; accepted: number; attempts: number }
export type SwarmHealth = {
  agentsOnline: number
  seatsEnrolled: number
  acceptedLastDay: number
  jobsDoneLastDay: number
}
type SwarmResponse = { health: SwarmHealth; skills: Skill[] }

const SWARM_URL = `${LINKS.box}api/public/swarm`
const MAX_RESULTS = 6
const EXAMPLES = ['build a mint site', 'audit my contract', 'make a token logo']

/** INFER BOX's public swarm health and skill list (shared by the search box and the ticker). */
export function useSwarm() {
  return useQuery({
    queryKey: ['box-swarm'],
    queryFn: async () => {
      const res = await fetch(SWARM_URL)
      if (!res.ok) throw new Error(`BOX ${res.status}`)
      return (await res.json()) as SwarmResponse
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

const Engine = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  text-align: left;
`

const SearchForm = styled.form`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: ${space[2]};
  padding: ${space[2]};
  background: ${color.face};
  box-shadow: ${bevel.raised};
  input {
    min-width: 0;
    height: 44px;
    border: none;
    border-radius: 0;
    background: #fff;
    box-shadow: ${bevel.field};
    padding: 0 ${space[3]};
    font-size: ${text.lg};
  }
  button {
    min-height: 44px;
    padding: 0 ${space[4]};
    font-weight: 700;
  }
  .narrow & {
    grid-template-columns: minmax(0, 1fr);
    input {
      font-size: ${text.sm};
    }
  }
`

const Hints = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[1]} ${space[3]};
  font-size: ${text.sm};
  color: ${color.highlight};
  button {
    border: none;
    padding: 4px 0;
    background: none;
    color: #c9d4ff;
    text-decoration: underline;
    font-size: ${text.sm};
    cursor: pointer;
    .narrow & {
      min-height: 44px;
    }
  }
`

const Results = styled.ol`
  list-style: none;
  margin: 0;
  padding: ${space[3]};
  background: ${y2k.paper};
  box-shadow: ${bevel.sunken};
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  counter-reset: hit;
`

const Result = styled.li`
  counter-increment: hit;
  display: grid;
  grid-template-columns: 2.2em minmax(0, 1fr);
  font-family: ${font.body};
  &::before {
    content: counter(hit) '.';
    font-weight: 700;
    color: ${color.inkMuted};
  }
  strong {
    display: block;
    font-family: ${font.ui};
    font-size: ${text.sm};
    color: ${color.link};
    text-decoration: underline;
    word-break: break-word;
  }
  p {
    margin: 2px 0;
    font-size: ${text.sm};
    line-height: 1.5;
    color: ${color.ink};
  }
  small {
    font-size: ${text.xs};
    color: ${color.success};
  }
`

const Meta = styled.div`
  display: flex;
  gap: ${space[2]} ${space[3]};
  flex-wrap: wrap;
  align-items: center;
  font-size: ${text.sm};
  line-height: 1.5;
  color: ${color.highlight};
`

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[3]};
  background: ${y2k.paper};
  box-shadow: ${bevel.raised};
  ${Meta} {
    color: ${color.ink};
  }
`

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) || []

/** Rank skills by how many query words hit the id/description, ties broken by how often the swarm accepts them. */
/**
 * The plane sometimes reports agentsOnline as 0 while work is plainly flowing (seats enrolled, answers accepted), so
 * a bare "0 agents online" would misstate the swarm. Fall back to the enrolled seat count in that case.
 */
export function swarmSize(h: SwarmHealth | undefined): string | undefined {
  if (!h) return undefined
  if (h.agentsOnline > 0) return `${h.agentsOnline.toLocaleString('en-US')} agents online`
  if (h.seatsEnrolled > 0) return `${h.seatsEnrolled.toLocaleString('en-US')} seats in the swarm`
  return undefined
}

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
  const swarm = useSwarm()

  const results = useMemo(() => rankSkills(swarm.data?.skills || [], query), [swarm.data, query])
  const h = swarm.data?.health

  const search = (q: string) => {
    setInput(q)
    setQuery(q.trim())
    setCopied(false)
  }

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
    <Engine aria-label="Search the swarm">
      <SearchForm
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          search(input)
        }}
      >
        <input
          aria-label="What do you want built, answered or checked?"
          placeholder="What should the swarm build?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <PushButton type="submit">Search the swarm</PushButton>
      </SearchForm>

      <Hints>
        <span>Try:</span>
        {EXAMPLES.map((q) => (
          <button key={q} type="button" onClick={() => search(q)}>
            {q}
          </button>
        ))}
        <span style={{ marginLeft: 'auto' }}>
          {swarm.isLoading ? (
            <Chip tone="off">Connecting</Chip>
          ) : swarm.isError ? (
            <Chip tone="warn">BOX unreachable</Chip>
          ) : (
            <Chip tone="ok">{swarmSize(h) ?? 'swarm'}</Chip>
          )}
        </span>
      </Hints>

      {swarm.isLoading && query && <Skeleton h="48px" />}
      {query && !swarm.isLoading && (
        <Panel>
          {results.length ? (
            <>
              <Meta>
                <span>
                  Skills that match <strong>&ldquo;{query}&rdquo;</strong>:
                </span>
              </Meta>
              <Results>
                {results.map((s) => (
                  <Result key={s.id}>
                    <div>
                      <strong>{s.id}</strong>
                      <p>{s.description}</p>
                      <small>
                        {s.role}, the swarm accepted {s.attempts ? Math.round((s.accepted / s.attempts) * 100) : 0}% of{' '}
                        {s.attempts.toLocaleString('en-US')} tries
                      </small>
                    </div>
                  </Result>
                ))}
              </Results>
            </>
          ) : (
            <Meta>No skill matches those words. INFER BOX can still sharpen the idea with you.</Meta>
          )}
          <Meta>
            <PushButton type="button" onClick={openBox}>
              Send to INFER BOX ↗
            </PushButton>
            <span style={{ flex: '1 1 240px' }}>
              {copied
                ? 'Your idea is waiting in BOX (and copied). Sign in, check it, and pay in imdUSD if it passes.'
                : 'BOX checks your idea and gives you a price. Pay in imdUSD and the swarm builds it.'}
            </span>
          </Meta>
        </Panel>
      )}
      {h && !query && (
        <Meta style={{ fontSize: text.xs, opacity: 0.85 }}>
          The swarm finished {h.jobsDoneLastDay} jobs in the last day, across {swarm.data?.skills.length} skills.
        </Meta>
      )}
    </Engine>
  )
}
