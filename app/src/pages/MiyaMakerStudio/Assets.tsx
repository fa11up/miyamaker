import { useEffect, useRef, useState, type ReactNode } from 'react'
import styled, { css } from 'styled-components/macro'

import { font, space } from '@/theme/tokens'

import blankUrl from './blank.png'
import { gelButton, pink, raisedButton, whiteOutline, Chevron } from './chrome'
import { byTraitName, sidebarLayers, type Layer, type Trait } from './model'
import { fetchLayerBlob } from './remote'

async function shrinkThumb(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob, { resizeWidth: 72, resizeHeight: 72, resizeQuality: 'low' }).catch(() => createImageBitmap(blob))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 72
    canvas.height = 72
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.drawImage(bitmap, 0, 0, 72, 72)
    const small = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), 'image/png'))
    return small ?? blob
  } finally {
    bitmap.close()
  }
}

const Column = styled.aside`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: ${pink.mist};
  color: ${pink.ink};
  box-shadow: inset 1px 1px ${pink.deep}, inset -1px -1px #fff;
  font-family: ${font.ui};
  font-size: 13px;
`

const Head = styled.div`
  display: flex;
  gap: ${space[1]};
  padding: ${space[1]};
  background: ${pink.soft};

  button,
  label {
    flex: 1 1 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    font: inherit;
    ${raisedButton}
  }

  button:disabled,
  label[aria-disabled='true'] {
    opacity: 0.5;
    cursor: default;
  }
`

const List = styled.div`
  min-height: 0;
  overflow: auto;
  flex: 1 1 auto;
`

/** Width of the arrows that sit on top of a layer name. The name is padded by the same amount. */
const SLICE_ARROW = 42

const Slice = styled.div<{ $open: boolean }>`
  position: relative;
  min-height: 44px;
  margin: 3px 4px;
  border-radius: 6px;
  background: ${(p) => (p.$open ? pink.blush : pink.soft)};
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 1px 0 rgba(74, 52, 120, 0.22);
`

const NameButton = styled.button`
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  min-height: 40px;
  padding: 6px 0;
  border: none;
  background: transparent;
  color: ${pink.ink};
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;

  .worn {
    margin-left: 8px;
    color: ${pink.inkMuted};
    font-weight: 400;
  }
`

const Edge = styled.button<{ $side: 'left' | 'right' }>`
  ${gelButton}
  position: absolute;
  top: 3px;
  bottom: 3px;
  ${(p) => p.$side}: 3px;
  z-index: 2;
  width: 34px;
  min-height: 0;
`

const Row = styled.div<{ $on: boolean }>`
  display: grid;
  grid-template-columns: 36px 22px 1fr auto;
  gap: 4px;
  align-items: center;
  width: 100%;
  padding: 3px ${space[1]};
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;

  img,
  .empty {
    width: 36px;
    height: 36px;
    object-fit: contain;
    background: ${pink.mist};
    image-rendering: auto;
  }

  .name {
    min-width: 0;
    overflow: hidden;
  }

  .group {
    display: block;
    color: ${pink.inkMuted};
    font-size: 11px;
    font-weight: 400;
  }

  .weight {
    color: ${pink.inkMuted};
    font-variant-numeric: tabular-nums;
  }

  ${(p) =>
    p.$on
      ? css`
          background: linear-gradient(180deg, ${pink.deep} 0%, ${pink.hot} 100%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), inset 3px 0 0 #000;
          ${whiteOutline}
          .group,
          .weight,
          button {
            color: #fff;
            text-shadow: inherit;
          }
        `
      : ''}
`

const Eye = styled.button<{ $off: boolean }>`
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: ${(p) => (p.$off ? pink.mid : pink.ink)};
  cursor: pointer;
`

const Clip = styled.span<{ $inset: number }>`
  display: block;
  overflow: hidden;
  white-space: nowrap;

  > span {
    display: inline-block;
    padding: 0 ${(p) => p.$inset}px;
    white-space: nowrap;
  }
`

type ClipApi = { play: () => void; stop: () => void }

/** Scroll a clipped line until both ends have cleared the window. Returns false when it has not been measured yet. */
function runClip(node: HTMLElement): boolean {
  const inner = node.firstElementChild as HTMLElement | null
  if (!inner || node.clientWidth < 8) return false
  inner.getAnimations().forEach((anim) => anim.cancel())
  inner.style.transform = ''
  const need = Math.ceil(inner.scrollWidth - node.clientWidth)
  if (need <= 1) return true
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
  const duration = Math.min(14000, Math.max(2200, need * 28))
  inner.animate(
    [
      { transform: 'translateX(0)', offset: 0 },
      { transform: 'translateX(0)', offset: 0.12 },
      { transform: `translateX(${-need}px)`, offset: 0.88 },
      { transform: `translateX(${-need}px)`, offset: 1 },
    ],
    { duration, easing: 'ease-in-out' },
  )
  return true
}

function resetClip(node: HTMLElement | null) {
  const inner = node?.firstElementChild as HTMLElement | null
  if (!inner) return
  inner.getAnimations().forEach((anim) => anim.cancel())
  inner.style.transform = ''
}

/** Scrolls a line that runs under the side controls. Once when it is actually on screen, and again while the pointer is on it. */
function NameClip({
  text,
  worn,
  inset = 0,
  live = true,
  api,
}: {
  text: string
  worn?: string
  inset?: number
  live?: boolean
  api?: { current: ClipApi | null }
}) {
  const box = useRef<HTMLSpanElement>(null)

  const play = () => {
    const node = box.current
    if (node) runClip(node)
  }
  const stop = () => resetClip(box.current)

  useEffect(() => {
    if (!api) return
    api.current = { play, stop }
    return () => {
      if (api.current?.play === play) api.current = null
    }
  })

  useEffect(() => {
    const node = box.current
    if (!node || !live) return
    let played = false
    const kick = () => {
      if (played) return
      if (!runClip(node)) return
      played = true
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) kick()
    }, { threshold: 0.6 })
    observer.observe(node)
    return () => {
      observer.disconnect()
      resetClip(node)
    }
  }, [text, worn, inset, live])

  return (
    <Clip
      className="marquee"
      $inset={inset}
      ref={box}
      title={worn ? `${text} ${worn}` : text}
      onMouseEnter={api ? undefined : play}
      onMouseLeave={api ? undefined : stop}
    >
      <span>
        {text}
        {worn ? <span className="worn"> {worn}</span> : null}
      </span>
    </Clip>
  )
}

function Thumb({ trait }: { trait: Trait }) {
  const [url, setUrl] = useState<string>()
  const hold = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const local = trait.draft ?? trait.file
    if (local && local.size > 0) {
      const next = URL.createObjectURL(local)
      setUrl(next)
      return () => URL.revokeObjectURL(next)
    }
    setUrl(undefined)
    const remote = trait.sourceUrl
    const node = hold.current
    if (!remote || !node) return
    let objectUrl = ''
    let started = false
    const controller = new AbortController()
    const observer = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((entry) => entry.isIntersecting)) return
        started = true
        observer.disconnect()
        void fetchLayerBlob(remote, 'later', controller.signal)
          .then((blob) => (controller.signal.aborted ? null : shrinkThumb(blob)))
          .then((small) => {
            if (!small || controller.signal.aborted) return
            objectUrl = URL.createObjectURL(small)
            setUrl(objectUrl)
          })
          .catch(() => undefined)
      },
      { rootMargin: '120px' },
    )
    observer.observe(node)
    return () => {
      controller.abort()
      observer.disconnect()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [trait.draft, trait.file, trait.sourceUrl])
  if (!url) return <span className="empty" ref={hold} />
  return <img src={url} alt="" />
}

function LayerSlice({
  layer,
  visible,
  wearing,
  open,
  live,
  onOpenLayer,
  onCycle,
  children,
}: {
  layer: Layer
  visible: number
  wearing: string
  open: boolean
  live: boolean
  onOpenLayer: (id: string) => void
  onCycle: (layer: string, direction: -1 | 1) => void
  children?: ReactNode
}) {
  const api = useRef<ClipApi | null>(null)
  return (
    <div>
      <Slice $open={open} onMouseEnter={() => api.current?.play()} onMouseLeave={() => api.current?.stop()}>
        <NameButton type="button" aria-expanded={open} data-testid="trait-layer" data-layer={layer.id} onClick={() => onOpenLayer(layer.id)}>
          <NameClip text={layer.name} worn={wearing} inset={SLICE_ARROW} live={live} api={api} />
        </NameButton>
        <Edge
          type="button"
          $side="left"
          aria-label={`Previous ${layer.name} trait`}
          data-testid="trait-layer-prev"
          disabled={visible < 2}
          onClick={(event) => {
            event.stopPropagation()
            onCycle(layer.id, -1)
          }}
        >
          <Chevron dir="left" />
        </Edge>
        <Edge
          type="button"
          $side="right"
          aria-label={`Next ${layer.name} trait`}
          data-testid="trait-layer-next"
          disabled={visible < 2}
          onClick={(event) => {
            event.stopPropagation()
            onCycle(layer.id, 1)
          }}
        >
          <Chevron dir="right" />
        </Edge>
      </Slice>
      {children}
    </div>
  )
}

export default function Assets({
  layers,
  traits,
  worn,
  activeId,
  openLayer,
  live = true,
  onOpenLayer,
  onSelect,
  onCycle,
  onClear,
  onToggleHide,
  onNew,
}: {
  layers: Layer[]
  traits: Trait[]
  worn: Record<string, string>
  activeId: string | null
  openLayer: string | null
  /** False while the loading veil covers the desk, so the intro scroll waits until the names are visible. */
  live?: boolean
  onOpenLayer: (id: string) => void
  onSelect: (id: string) => void
  onCycle: (layer: string, direction: -1 | 1) => void
  onClear: (layer: string) => void
  onToggleHide: (id: string) => void
  onNew: () => void
}) {
  const sidebar = sidebarLayers(layers)
  return (
    <Column>
      <Head>
        <button
          type="button"
          onClick={onNew}
          disabled={!openLayer}
          data-testid="trait-new"
          title="Blank trait on this layer. It sits in that layer's place in the stack."
        >
          New trait
        </button>
      </Head>
      <List>
        {sidebar.map((layer) => {
          const rows = traits.filter((trait) => trait.layer === layer.id).slice().sort(byTraitName)
          const visible = rows.filter((trait) => !trait.hidden).length
          const wearing = rows.find((trait) => trait.id === worn[layer.id])
          const open = openLayer === layer.id
          return (
            <LayerSlice
              key={layer.id}
              layer={layer}
              visible={visible}
              wearing={wearing?.name ?? 'Blank'}
              open={open}
              live={live}
              onOpenLayer={onOpenLayer}
              onCycle={onCycle}
            >
              {open && (
                <Row
                  $on={!wearing}
                  data-testid="trait-blank"
                  role="button"
                  tabIndex={0}
                  onClick={() => onClear(layer.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onClear(layer.id)
                    }
                  }}
                >
                  <img src={blankUrl} alt="" />
                  <span />
                  <span className="name">Blank</span>
                </Row>
              )}
              {open &&
                rows.map((trait) => (
                  <Row
                    key={trait.id}
                    $on={trait.id === activeId}
                    onClick={() => onSelect(trait.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelect(trait.id)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <Thumb trait={trait} />
                    <Eye
                      type="button"
                      $off={trait.hidden}
                      title={trait.hidden ? 'Show in the wearing preview' : 'Hide from the wearing preview'}
                      aria-label={trait.hidden ? 'Show in preview' : 'Hide from preview'}
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleHide(trait.id)
                      }}
                    >
                      {trait.hidden ? '○' : '●'}
                    </Eye>
                    <span className="name">
                      <NameClip text={`${trait.name}${trait.dirty ? ' *' : ''}`} live={live} />
                      {trait.group ? <span className="group">{trait.group}</span> : null}
                    </span>
                    <span className="weight">#{trait.weight}</span>
                  </Row>
                ))}
            </LayerSlice>
          )
        })}
      </List>
    </Column>
  )
}
