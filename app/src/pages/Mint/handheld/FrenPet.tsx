import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import styled from 'styled-components/macro'
import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'

import { PAINTED } from './Carousel'
import Device, { Lcd } from './Device'
import type { PetView } from './petData'
import {
  fedWords,
  FIRST_PET,
  FRENPET_DIAMOND,
  FRENPET_NFT,
  FRENPET_SITE,
  frenpetAbi,
  frenpetNftAbi,
  parsePet,
  petImage,
} from './petData'

/**
 * Fren Pet on the device: watch any pet, live from Base. ◀▶ go through pets, ▲▼ jump by a hundred, and the one you leave
 * on stays for next time. It only reads: playing happens on Fren Pet's own site for now, because pets belong to the smart
 * accounts it makes, which a wallet here cannot sign for.
 */
const KEY = 'miyaos.frenpet.pet.v1'
const client = createPublicClient({ chain: base, transport: http() })

const remembered = () => {
  try {
    const n = Number(window.localStorage.getItem(KEY))
    return Number.isInteger(n) && n > 0 ? n : FIRST_PET
  } catch {
    return FIRST_PET
  }
}

const Stage = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  /* It lives on a light field of its own, so the pixels read clearly. */
  background: #dff3ff;
  img {
    display: block;
    width: 100%;
    height: 100%;
    max-width: none;
    margin: 0;
    border: none;
    image-rendering: pixelated;
  }
`

const Note = styled.div`
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  padding: 7px 10px;
  border-radius: 4px;
  color: #fff;
  font-size: 15px;
  line-height: 1.3;
  background: rgba(12, 10, 24, 0.93);
`

const Info = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  color: #f1eeff;
  font-size: 15px;
  line-height: 1.35;
  background: linear-gradient(rgba(14, 8, 34, 0.72), rgba(14, 8, 34, 0.72)), ${PAINTED};
  h2 {
    margin: 0;
    font-size: 21px;
    font-weight: 400;
  }
  p {
    margin: 0;
  }
  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 3px 12px;
    margin: 0;
  }
  dt {
    color: #cfcbdf;
  }
  dd {
    margin: 0;
    text-align: right;
  }
  a {
    color: #9fe8ff;
  }
`

async function readPet(id: number): Promise<{ pet: PetView; image?: string }> {
  const [info, stats, uri] = await Promise.all([
    client.readContract({ address: FRENPET_DIAMOND, abi: frenpetAbi, functionName: 'getPetInfo', args: [BigInt(id)] }),
    client.readContract({
      address: FRENPET_DIAMOND,
      abi: frenpetAbi,
      functionName: 'getPetAttackDefense',
      args: [BigInt(id)],
    }),
    client.readContract({ address: FRENPET_NFT, abi: frenpetNftAbi, functionName: 'tokenURI', args: [BigInt(id)] }),
  ])
  return { pet: parsePet(id, info, stats, Math.floor(Date.now() / 1000)), image: petImage(uri) }
}

export default function FrenPet({ onBack }: { onBack: () => void }) {
  const [id, setId] = useState(remembered)
  const [info, setInfo] = useState(false)
  const query = useQuery({ queryKey: ['frenpet', id], queryFn: () => readPet(id), staleTime: 30_000, retry: 1 })
  const pet = query.data?.pet

  const go = (next: number) => {
    const to = Math.max(1, next)
    setId(to)
    try {
      window.localStorage.setItem(KEY, String(to))
    } catch {
      // ignore
    }
  }
  const toggleInfo = { label: info ? 'Close info' : 'Pet info', onClick: () => setInfo((v) => !v) }

  return (
    <Device
      title="Fren Pet"
      lamp={{ color: query.isError ? '#ffc400' : '#3dff7a', label: 'Fren Pet' }}
      screen={
        <Stage>
          {query.data?.image && pet?.alive && <img src={query.data.image} alt={pet.name} />}
          {query.isLoading && <Note role="status">Looking for pet #{id}…</Note>}
          {query.isError && <Note role="alert">Could not reach Base. Try again in a minute.</Note>}
          {pet && !pet.alive && <Note role="status">Pet #{id} is gone, or was never born. Try another number.</Note>}
          {info && (
            <Info aria-label="About this pet">
              <h2>{pet?.name ?? `Pet #${id}`}</h2>
              {pet?.alive && (
                <dl>
                  <dt>Pet</dt>
                  <dd>#{id}</dd>
                  <dt>Level</dt>
                  <dd>{pet.level.toLocaleString()}</dd>
                  <dt>Points</dt>
                  <dd>{pet.points.toLocaleString()}</dd>
                  <dt>Attack / Defense</dt>
                  <dd>
                    {pet.attack} / {pet.defense}
                  </dd>
                  <dt>Food</dt>
                  <dd>{fedWords(pet.fedFor)}</dd>
                </dl>
              )}
              <p>You are watching this pet. To raise your own, play on Fren Pet.</p>
              <a href={FRENPET_SITE} target="_blank" rel="noreferrer">
                frenpet.xyz ↗
              </a>
            </Info>
          )}
        </Stage>
      }
      lcd={
        <Lcd>
          <div>
            <span>{pet?.name ?? 'Fren Pet'}</span>
            <span>#{id}</span>
          </div>
          <div>
            <span>{pet?.alive ? `LV ${pet.level} · ${fedWords(pet.fedFor)}` : '◀▶ Other pets'}</span>
            {pet?.alive && (
              <span>
                ATK {pet.attack} DEF {pet.defense}
              </span>
            )}
          </div>
          <div>
            <span>Ⓐ {toggleInfo.label}</span>
          </div>
        </Lcd>
      }
      a={toggleInfo}
      b={{ label: 'Games', onClick: onBack }}
      select={{ label: 'Games', onClick: onBack }}
      start={toggleInfo}
      dpad={{
        left: () => go(id - 1),
        right: () => go(id + 1),
        up: () => go(id + 100),
        down: () => go(id - 100),
      }}
    />
  )
}
