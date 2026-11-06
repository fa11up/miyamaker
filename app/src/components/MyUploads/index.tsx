import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useAccount } from 'wagmi'

import { SmallButton } from '@/components/LaunchKit'
import { Well } from '@/components/Retro'
import Pages from '@/constants/pages'
import { fetchStation } from '@/music/community'
import { useOpenApp } from '@/music/useOpenApp'
import { space, text } from '@/theme/tokens'
import type { FolderFile, Upload, UploadKind } from '@/utils/myUploads'
import { fetchUploads, parseManifest } from '@/utils/myUploads'
import { resolveUri } from '@/utils/resolveUri'

const NODE = import.meta.env.VITE_IRYS_NODE || 'https://uploader.irys.xyz'
const FOLDER_ICON = Pages.files?.icon?.src

const Box = styled(Well)`
  margin-top: ${space[1]};
  /* A set height: the list scrolls inside it, so the form below stays put while it loads and fills. */
  height: 130px;
  box-sizing: border-box;
  overflow-y: auto;
  padding: ${space[1]};
  font-size: ${text.xs};
`

const Note = styled.p`
  margin: 0;
  padding: ${space[2]};
`

const Row = styled.div<{ $chosen?: boolean; $indent?: boolean }>`
  display: flex;
  align-items: center;
  gap: ${space[2]};
  min-height: 44px;
  padding: 2px ${space[1]};
  padding-left: ${({ $indent }) => ($indent ? space[4] : space[1])};
  background: ${({ $chosen }) => ($chosen ? 'rgba(179, 154, 94, 0.25)' : 'transparent')};
  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .glyph {
    flex: 0 0 40px;
    display: grid;
    place-items: center;
    height: 40px;
  }
  img {
    width: 40px;
    height: 40px;
    max-width: none;
    margin: 0;
    border: none;
    object-fit: cover;
  }
  img:hover {
    border: none;
  }
`

export type Picked = { uri: string; mime?: string }

const when = (at?: number) => (at ? new Date(at).toLocaleDateString() : '')

/** One play button's worth of preview; the browser fetches the file only when it is pressed. */
function PlayButton({ src, name }: { src: string; name: string }) {
  const audio = useRef<HTMLAudioElement>()
  const [playing, setPlaying] = useState(false)
  useEffect(() => () => audio.current?.pause(), [])
  const toggle = () => {
    if (!audio.current) {
      audio.current = new Audio(src)
      audio.current.onended = () => setPlaying(false)
    }
    if (playing) audio.current.pause()
    else audio.current.play().catch(() => setPlaying(false))
    setPlaying(!playing)
  }
  return (
    <SmallButton type="button" aria-label={`${playing ? 'Pause' : 'Play'} ${name}`} onClick={toggle}>
      {playing ? '❚❚' : '▶'}
    </SmallButton>
  )
}

function FileRow({
  id,
  kind,
  name,
  mime,
  value,
  indent,
  onPick,
}: {
  id: string
  kind: 'image' | 'audio'
  name: string
  mime?: string
  value: string
  indent?: boolean
  onPick: (p: Picked) => void
}) {
  const uri = `ar://${id}`
  const src = resolveUri(uri)
  const chosen = value === uri
  return (
    <Row $chosen={chosen} $indent={indent}>
      <span className="glyph">
        {kind === 'image' ? <img src={src} alt="" loading="lazy" /> : <PlayButton src={src} name={name} />}
      </span>
      <span className="name" title={name}>
        {name}
      </span>
      <SmallButton type="button" aria-pressed={chosen} onClick={() => onPick({ uri, mime })}>
        {chosen ? 'Chosen' : 'Use this'}
      </SmallButton>
    </Row>
  )
}

/** A folder opens to show its files of the kind being picked. */
function FolderRow({
  upload,
  kind,
  value,
  onPick,
}: {
  upload: Upload
  kind: 'image' | 'audio'
  value: string
  onPick: (p: Picked) => void
}) {
  const [open, setOpen] = useState(false)
  const files = useQuery<FolderFile[]>({
    queryKey: ['upload-folder', upload.id],
    enabled: open,
    retry: 1,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(`${NODE.replace(/\/$/, '')}/tx/${upload.id}/data`)
      if (!res.ok) throw new Error(String(res.status))
      return parseManifest(await res.json())
    },
  })
  const matching = (files.data || []).filter((f) => f.kind === kind)
  return (
    <>
      <Row>
        <span className="glyph">
          <img src={FOLDER_ICON} alt="" style={{ objectFit: 'contain' }} />
        </span>
        <span className="name">
          {upload.name || 'Folder'}
          {upload.files ? ` · ${upload.files} files` : ''}
        </span>
        <SmallButton type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Open'}
        </SmallButton>
      </Row>
      {open && files.isLoading && <Note>Opening the folder…</Note>}
      {open && files.isError && <Note>Could not open this folder. It can take a few minutes after uploading.</Note>}
      {open && files.isSuccess && !matching.length && <Note>No {kind} files in this folder.</Note>}
      {open &&
        matching.map((f) => (
          <FileRow
            key={f.id}
            indent
            id={f.id}
            kind={kind}
            name={f.path}
            mime={f.mime}
            value={value}
            onPick={onPick}
          />
        ))}
    </>
  )
}

/**
 * What the connected wallet has stored through MiyaOS, to reuse in place of uploading (and paying) again. `kind`
 * 'folder' picks a whole folder, for a link that token numbers are added to.
 */
export default function MyUploads({
  kind,
  value,
  onPick,
}: {
  kind: UploadKind
  value: string
  onPick: (picked: Picked) => void
}) {
  const { address } = useAccount()
  const openApp = useOpenApp()
  const uploads = useQuery({
    queryKey: ['my-uploads', address],
    enabled: !!address,
    retry: 1,
    staleTime: 30_000,
    queryFn: () => fetchUploads(NODE, address as string),
  })
  // A song put on the radio has a real title, even from before uploads saved their names.
  const station = useQuery({ queryKey: ['station'], queryFn: fetchStation, retry: 1 })
  const title = (u: Upload) => {
    if (u.name) return u.name
    const track = station.data?.tracks.find((t) => t.txId === u.id)
    if (track) return `${track.artist} - ${track.title}`
    return `${u.mime || u.kind}${u.at ? `, ${when(u.at)}` : ''}`
  }

  if (!address)
    return (
      <Box aria-label="Your uploads">
        <Note>Connect your wallet to see what you have uploaded.</Note>
      </Box>
    )

  const rows = (uploads.data || []).filter((u) => u.kind === kind || u.kind === 'folder')
  return (
    <Box aria-label="Your uploads">
      {uploads.isLoading && <Note>Looking up your uploads…</Note>}
      {uploads.isError && (
        <Note>
          Could not reach Irys.{' '}
          <SmallButton type="button" onClick={() => uploads.refetch()}>
            Try again
          </SmallButton>
        </Note>
      )}
      {uploads.isSuccess && !rows.length && (
        <Note>
          Nothing here from this wallet yet.{' '}
          <SmallButton type="button" onClick={() => openApp('uploader')}>
            Open Infinite Upload
          </SmallButton>
        </Note>
      )}
      {rows.map((u) => {
        if (u.kind !== 'folder')
          return (
            <FileRow
              key={u.id}
              id={u.id}
              kind={u.kind}
              name={title(u)}
              mime={u.mime}
              value={value}
              onPick={onPick}
            />
          )
        if (kind !== 'folder') return <FolderRow key={u.id} upload={u} kind={kind} value={value} onPick={onPick} />
        const uri = `ar://${u.id}/`
        return (
          <Row key={u.id} $chosen={value === uri}>
            <span className="glyph">
              <img src={FOLDER_ICON} alt="" style={{ objectFit: 'contain' }} />
            </span>
            <span className="name">
              {u.name || 'Folder'}
              {u.files ? ` · ${u.files} files` : ''}
            </span>
            <SmallButton type="button" aria-pressed={value === uri} onClick={() => onPick({ uri })}>
              {value === uri ? 'Chosen' : 'Use this'}
            </SmallButton>
          </Row>
        )
      })}
    </Box>
  )
}
