import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components/macro'

import { Chip } from '@/components/Retro'
import { LINKS } from '@/constants/miyanet'
import { buildPath, STARTERS } from '@/pages/Build/starters'
import { bevel, color, space, text } from '@/theme/tokens'

import { PushButton } from './y2k'

/**
 * The way into the swarm from miyanet. Searching (or one of the three starters) opens the Build window on this site,
 * where INFER BOX checks the idea, prices it and takes the payment. The health line reads INFER BOX's public swarm
 * state (CORS-open, no sign-in).
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

const Meta = styled.div`
  display: flex;
  gap: ${space[2]} ${space[3]};
  flex-wrap: wrap;
  align-items: center;
  font-size: ${text.sm};
  line-height: 1.5;
  color: ${color.highlight};
`

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

export default function SwarmSearch() {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const swarm = useSwarm()
  const h = swarm.data?.health

  return (
    <Engine aria-label="Search the swarm">
      <SearchForm
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          if (input.trim()) navigate(buildPath(input.trim()))
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
        {STARTERS.map((s) => (
          <button key={s.label} type="button" onClick={() => navigate(buildPath(s.idea, s.type))}>
            {s.label}
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

      {h && (
        <Meta style={{ fontSize: text.xs, opacity: 0.85 }}>
          The swarm finished {h.jobsDoneLastDay} jobs in the last day, across {swarm.data?.skills.length} skills.
        </Meta>
      )}
    </Engine>
  )
}
