import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import type { PageKey } from '@/store/windows/reducer'
import { font, space } from '@/theme/tokens'

import { Chevron, gelButton, pink, raisedButton } from './chrome'

import Assets from './Assets'
import { DEFAULT_BRUSH, type Brush, type Pixels } from './brush'
import Canvas, { type CanvasHandle, type Tool } from './Canvas'
import { forgetDraft, rememberDraft } from './drafts'
import { canPickFolder, firstWorn, loadFolder, pickFolder, writeTrait } from './files'
import Inspector from './Inspector'
import Knob from './Knob'
import Loading, { type Gate } from './Loading'
import {
  aroundActive,
  blankTrait,
  ensureEmptyOptions,
  isEmptyOption,
  CANVAS,
  cycleTrait,
  EMPTY_LAYERS,
  nameError,
  orderLayers,
  placeKey,
  previewStack,
  randomWorn,
  traitClash,
  traitsInOrder,
  type StudioDoc,
  type Trait,
} from './model'
import { blankPixels, blobToPixels, pixelsToPng } from './pixels'
import { preparePlate } from './plates'
import Preview from './Preview'
import { loadPublishedLayers, traitImage } from './remote'

const pageId = 'traits' as PageKey

const Desk = styled.div`
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(120% 70% at 8% -10%, rgba(255, 255, 255, 0.75), transparent 46%),
    linear-gradient(180deg, ${pink.mist}, ${pink.blush});
  color: ${pink.ink};
  font-family: ${font.ui};
`

const Commands = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[1]};
  align-items: center;
  padding: ${space[1]};
  background: ${pink.soft};
  color: ${pink.ink};

  button,
  label > span {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: 0 10px;
    font: inherit;
    ${raisedButton}
  }

  > span {
    margin-left: auto;
  }
`

const Panes = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow: auto;
`

const Gutter = styled.div`
  flex: 0 0 6px;
  cursor: col-resize;
  background: linear-gradient(180deg, #fff, ${pink.deep} 40%, ${pink.hot});
  box-shadow: inset 1px 0 0 rgba(255, 255, 255, 0.7);
`

const Center = styled.div`
  flex: 1 1 auto;
  min-width: 280px;
  min-height: 0;
  display: flex;
  flex-direction: column;
`

const StageBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[1]};
  align-items: center;
  padding: ${space[1]} ${space[2]};
  background: ${pink.soft};
  color: ${pink.ink};
  font-size: 13px;
  font-weight: 600;

  button.nav {
    ${gelButton}
    width: 52px;
    height: 40px;
    flex: 0 0 auto;
  }

  span {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const BrushBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-end;
  padding: ${space[1]};
  background: ${pink.blush};
  color: ${pink.ink};
  font-size: 12px;

  > button {
    min-height: 28px;
    padding: 0 8px;
    font: inherit;
    ${raisedButton}
  }

  label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 28px;
  }
`

const Welcome = styled.div`
  margin: auto;
  max-width: 46ch;
  padding: ${space[4]};
  background: ${pink.mist};
  color: ${pink.ink};
  box-shadow:
    inset 1px 1px 0 #fff,
    inset -1px -1px 0 ${pink.deep},
    0 8px 18px rgba(74, 52, 120, 0.28);

  h2 {
    margin: 0 0 ${space[2]};
    font-family: ${font.display};
    font-weight: 400;
    font-size: 28px;
  }

  p {
    margin: 0 0 ${space[2]};
  }
`

const Status = styled.div`
  padding: 2px ${space[2]} 4px;
  font-size: 12px;
  color: ${pink.inkMuted};
`

function countLabel(count: number): string {
  return `${count} ${count === 1 ? 'trait' : 'traits'}`
}

export default function MiyaMakerStudioPage() {
  const dispatch = useAppDispatch()
  const [fullscreen, toggleFullscreen] = useFullscreen(pageId)
  const [doc, setDoc] = useState<StudioDoc | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [openLayer, setOpenLayer] = useState<string | null>(null)
  const [worn, setWorn] = useState<Record<string, string>>({})
  const [brush, setBrush] = useState<Brush>(DEFAULT_BRUSH)
  const [tool, setTool] = useState<Tool>('pen')
  const [ink, setInk] = useState('#14101f')
  const [status, setStatus] = useState('Open the layers folder, or start an empty set.')
  const [busy, setBusy] = useState(false)
  const [gate, setGate] = useState<Gate | null>({ label: 'Reading the published layers…', done: 0, total: 0 })
  const [leftW, setLeftW] = useState(280)
  const [rightW, setRightW] = useState(280)
  const docRef = useRef<StudioDoc | null>(null)
  const activeRef = useRef<string | null>(null)
  const dirs = useRef(new Map<string, FileSystemDirectoryHandle>())
  const canvasRef = useRef<CanvasHandle>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const loadToken = useRef(0)
  const wornRef = useRef<Record<string, string>>({})
  const pendingPixels = useRef<Pixels | null>(null)

  const update = (next: StudioDoc | null) => {
    docRef.current = next
    setDoc(next)
  }

  const choose = (id: string | null) => {
    activeRef.current = id
    setActiveId(id)
  }

  const commitLive = async () => {
    const id = activeRef.current
    const current = docRef.current
    const canvas = canvasRef.current
    if (!id || !current || !canvas?.isPaintDirty()) return
    const png = await canvas.toPng()
    canvas.markSaved()
    const traits = current.traits.map((trait) => (trait.id === id ? { ...trait, draft: png, dirty: true } : trait))
    const next = { ...current, traits }
    update(next)
    const trait = traits.find((item) => item.id === id)
    if (trait) await rememberDraft(next.rootName, trait).catch(() => undefined)
  }

  useEffect(() => {
    const id = activeId
    const trait = docRef.current?.traits.find((item) => item.id === id)
    if (!id || !trait) {
      canvasRef.current?.load(blankPixels(CANVAS, CANVAS))
      return
    }
    let cancel = false
    ;(async () => {
      try {
        const source = await traitImage(trait)
        const pixels = source ? await blobToPixels(source, 'letterbox') : blankPixels(CANVAS, CANVAS)
        if (!cancel && activeRef.current === id) canvasRef.current?.load(pixels)
      } catch {
        if (!cancel) setStatus('Could not open that picture.')
      }
    })()
    return () => {
      cancel = true
    }
  }, [activeId])

  useLayoutEffect(() => {
    const pixels = pendingPixels.current
    if (!pixels || !canvasRef.current) return
    canvasRef.current.load(pixels)
    pendingPixels.current = null
  })

  const showCharacter = (next: StudioDoc, wornNext: Record<string, string>, prefer: string | null) => {
    wornRef.current = wornNext
    setWorn(wornNext)
    const layerId =
      prefer && next.layers.some((layer) => layer.id === prefer)
        ? prefer
        : next.layers.find((layer) => wornNext[layer.id])?.id ?? next.layers[0]?.id ?? null
    setOpenLayer(layerId)
    choose(layerId ? wornNext[layerId] ?? null : null)
  }

  const paintStack = async (token: number) => {
    const next = docRef.current
    if (!next) return
    const stack = previewStack(next.layers, next.traits, wornRef.current)
    const focusId = activeRef.current
    const focus = next.traits.find((trait) => trait.id === focusId)
    if (focus && isEmptyOption(focus)) pendingPixels.current = blankPixels(CANVAS, CANVAS)
    const total = stack.length
    if (!total) {
      pendingPixels.current = blankPixels(CANVAS, CANVAS)
      return
    }
    for (let index = 0; index < stack.length; index += 1) {
      if (token !== loadToken.current) return
      const trait = stack[index]
      if (!trait) continue
      setGate({ label: `${trait.layer} · ${trait.name}`, done: index, total })
      if (trait.id === focusId) {
        const source = await traitImage(trait).catch(() => null)
        if (token !== loadToken.current) return
        pendingPixels.current = source ? await blobToPixels(source, 'letterbox') : blankPixels(CANVAS, CANVAS)
      } else {
        await preparePlate(trait).catch(() => undefined)
      }
      if (token !== loadToken.current) return
      setGate({ label: `${trait.layer} · ${trait.name}`, done: index + 1, total })
    }
  }

  const replaceDoc = (next: StudioDoc, folder?: Map<string, FileSystemDirectoryHandle>, selectFirst = true) => {
    dirs.current = folder ?? new Map()
    update(next)
    if (!selectFirst) {
      wornRef.current = {}
      setWorn({})
      setOpenLayer(null)
      choose(null)
      return
    }
    showCharacter(next, firstWorn(next.layers, next.traits), next.layers[0]?.id ?? null)
  }

  const dirtyGuard = () => {
    const current = docRef.current
    if (!current?.traits.some((trait) => trait.dirty)) return true
    return window.confirm('Discard unsaved traits?')
  }

  const openPublished = async () => {
    if (!dirtyGuard()) return
    const mine = ++loadToken.current
    setBusy(true)
    setGate({ label: 'Reading the published layers…', done: 0, total: 0 })
    setStatus('Reading the published layers…')
    try {
      const next = await loadPublishedLayers()
      if (mine !== loadToken.current) return
      dirs.current = new Map()
      update(next)
      showCharacter(next, randomWorn(next.layers, next.traits), 'Body')
      await paintStack(mine)
      if (mine !== loadToken.current) return
      setStatus(`${countLabel(next.traits.length)} from koolskull.com/miyamaker/layers. Arrows step through a layer. Random builds another.`)
    } catch {
      if (mine === loadToken.current) setStatus('Could not read the published layers.')
    } finally {
      if (mine === loadToken.current) {
        setBusy(false)
        setGate(null)
      }
    }
  }

  const openFolder = async () => {
    if (!dirtyGuard()) return
    const mine = ++loadToken.current
    setBusy(true)
    setGate({ label: 'Reading layers…', done: 0, total: 0 })
    setStatus('Reading layers…')
    try {
      const loaded = await loadFolder(await pickFolder())
      if (mine !== loadToken.current) return
      replaceDoc(loaded.doc, loaded.dirs)
      await paintStack(mine)
      if (mine !== loadToken.current) return
      setStatus(`${countLabel(loaded.doc.traits.length)} in ${loaded.doc.rootName}.`)
    } catch (error) {
      if (mine !== loadToken.current) return
      if (error instanceof DOMException && error.name === 'AbortError') setStatus('Open cancelled.')
      else setStatus('Could not open that folder.')
    } finally {
      if (mine === loadToken.current) {
        setBusy(false)
        setGate(null)
      }
    }
  }

  const startEmpty = () => {
    if (!dirtyGuard()) return
    loadToken.current += 1
    setGate(null)
    const layers = orderLayers(EMPTY_LAYERS)
    replaceDoc({ rootName: 'Untitled', layers, traits: ensureEmptyOptions(layers, []) })
    setStatus('Empty set. New traits stay in this browser. Export image saves the picture you are wearing.')
  }

  const cycleLayer = async (layerId: string, direction: -1 | 1) => {
    await commitLive()
    const current = docRef.current
    if (!current) return
    const wearingId = wornRef.current[layerId] ?? null
    const next = cycleTrait(current.traits, layerId, wearingId, direction)
    if (!next || next.id === wearingId) return
    const wornNext = { ...wornRef.current, [layerId]: next.id }
    wornRef.current = wornNext
    setWorn(wornNext)
    if (activeRef.current === wearingId || !activeRef.current) {
      choose(next.id)
      setStatus(`Opening ${next.name}.`)
    }
  }

  const roll = async () => {
    const current = docRef.current
    if (!current || gate) return
    if (!dirtyGuard()) return
    await commitLive()
    const mine = ++loadToken.current
    setBusy(true)
    setGate({ label: 'Building a random character…', done: 0, total: 0 })
    try {
      showCharacter(current, randomWorn(current.layers, current.traits), openLayer ?? 'Body')
      await paintStack(mine)
      if (mine === loadToken.current) setStatus('New random character.')
    } catch {
      if (mine === loadToken.current) setStatus('Could not build that character.')
    } finally {
      if (mine === loadToken.current) {
        setBusy(false)
        setGate(null)
      }
    }
  }

  const clearLayer = async (layerId: string) => {
    await commitLive()
    const wornNext = { ...wornRef.current }
    delete wornNext[layerId]
    wornRef.current = wornNext
    setWorn(wornNext)
    const active = docRef.current?.traits.find((item) => item.id === activeRef.current)
    if (active?.layer === layerId) choose(null)
    const name = docRef.current?.layers.find((item) => item.id === layerId)?.name ?? 'Layer'
    setStatus(`${name} is empty.`)
  }

  const select = async (id: string) => {
    if (id === activeRef.current) return
    await commitLive()
    const trait = docRef.current?.traits.find((item) => item.id === id)
    if (!trait) return
    setOpenLayer(trait.layer)
    const wornNext = { ...wornRef.current, [trait.layer]: id }
    wornRef.current = wornNext
    setWorn(wornNext)
    choose(id)
  }

  const addTrait = async () => {
    const current = docRef.current
    const layer = openLayer ?? current?.layers[0]?.id
    if (!current || !layer) return
    await commitLive()
    const trait = blankTrait(layer, docRef.current?.traits ?? [])
    const next = { ...docRef.current!, traits: [...(docRef.current?.traits ?? []), trait] }
    update(next)
    const wornNext = { ...wornRef.current, [layer]: trait.id }
    wornRef.current = wornNext
    setWorn(wornNext)
    setOpenLayer(layer)
    choose(trait.id)
    setStatus(`Blank ${trait.name} on ${layer}. It sits in that layer's place.`)
    void rememberDraft(next.rootName, trait).catch(() => undefined)
  }

  const patchTrait = (patch: Partial<Trait>) => {
    const id = activeRef.current
    const current = docRef.current
    if (!id || !current) return
    const traits = current.traits.map((trait) => (trait.id === id ? { ...trait, ...patch, dirty: true } : trait))
    const next = { ...current, traits }
    update(next)
    const trait = traits.find((item) => item.id === id)
    if (trait) void rememberDraft(next.rootName, trait).catch(() => undefined)
  }

  const save = async () => {
    await commitLive()
    const id = activeRef.current
    const current = docRef.current
    const trait = current?.traits.find((item) => item.id === id)
    if (!current || !trait) {
      setStatus('Select a trait to save.')
      return
    }
    const problem = nameError(trait.name)
    if (problem) {
      setStatus(problem)
      return
    }
    if (traitClash(current.traits, trait)) {
      setStatus('Another trait in this folder already uses that name and weight.')
      return
    }
    setBusy(true)
    try {
      let png = await traitImage(trait)
      if (!png) png = await pixelsToPng(blankPixels(CANVAS, CANVAS))
      const dir = dirs.current.get(placeKey(trait.layer, trait.group))
      if (!dir) {
        const traits = current.traits.map((item) => (item.id === trait.id ? { ...item, draft: png, dirty: false } : item))
        update({ ...current, traits })
        await rememberDraft(current.rootName, { ...trait, draft: png, dirty: false })
        setStatus(
          trait.sourceUrl
            ? 'Kept in this browser. The picture on koolskull.com is unchanged.'
            : 'Kept in this browser. Export image saves the picture you are wearing.'
        )
        return
      }
      const diskName = await writeTrait(dir, trait, png)
      await forgetDraft(current.rootName, trait).catch(() => undefined)
      const file = new File([png], diskName, { type: 'image/png' })
      const traits = current.traits.map((item) =>
        item.id === trait.id ? { ...item, draft: png, file, diskName, dirty: false } : item
      )
      update({ ...current, traits })
      setStatus(`Saved ${diskName}.`)
    } catch {
      setStatus('Could not save.')
    } finally {
      setBusy(false)
    }
  }

  const exportImage = async () => {
    const current = docRef.current
    if (!current) return
    setBusy(true)
    try {
      const blob = await canvasRef.current?.flattenPng()
      if (!blob) {
        setStatus('Nothing to export yet.')
        return
      }
      const wornBody = current.traits.find((trait) => trait.id === wornRef.current.Body)
      const label = wornBody && !isEmptyOption(wornBody) ? wornBody.name : 'picture'
      const slug = label.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'picture'
      const fileName = `miyamaker-${slug}.png`
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
      setStatus(`Saved ${fileName}.`)
    } catch {
      setStatus('Could not export that picture.')
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const tag = (event.target as HTMLElement).tagName
    const typing = tag === 'INPUT' || tag === 'TEXTAREA'
    const command = event.metaKey || event.ctrlKey
    if (command && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void save()
      return
    }
    if (typing) return
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) canvasRef.current?.redo()
      else canvasRef.current?.undo()
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const layer = docRef.current?.traits.find((trait) => trait.id === activeRef.current)?.layer ?? openLayer
      if (!layer || gate) return
      event.preventDefault()
      void cycleLayer(layer, event.key === 'ArrowLeft' ? -1 : 1)
      return
    }
    if (event.key.toLowerCase() === 'b') setTool('pen')
    if (event.key.toLowerCase() === 'e') setTool('erase')
    if (event.key.toLowerCase() === 's') setTool('smudge')
    if (event.key.toLowerCase() === 'i') setTool('pick')
  }

  const dragSize = (which: 'left' | 'right', start: number) => (event: React.PointerEvent) => {
    const origin = event.clientX
    const move = (next: PointerEvent) => {
      const delta = next.clientX - origin
      if (which === 'left') setLeftW(Math.max(200, Math.min(480, start + delta)))
      else setRightW(Math.max(200, Math.min(420, start - delta)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  useEffect(() => {
    void openPublished()
  }, [])

  const active = doc?.traits.find((trait) => trait.id === activeId) ?? null
  const wearing = doc ? previewStack(doc.layers, doc.traits, worn) : []
  const split = aroundActive(wearing, activeId)
  const ordered = active && doc ? traitsInOrder(doc.traits, active.layer) : []
  const place = active ? ordered.findIndex((trait) => trait.id === active.id) : -1
  const folderOk = canPickFolder()

  return (
    <WindowWrapper skin="traits">
      <TitleBar
        skin="traits"
        closeBtn
        minimizeBtn
        fullscreenBtn
        fullscreen={fullscreen}
        onClose={() => dispatch(closeWindow({ value: pageId }))}
        onMinimize={() => dispatch(minimizeWindow({ value: pageId }))}
        onFullscreen={toggleFullscreen}
      >
        MiyaMaker Studio
      </TitleBar>
      <Desk ref={rootRef} data-testid="trait-studio" tabIndex={-1} onKeyDown={onKeyDown}>
        <Commands>
          <button type="button" onClick={() => void openPublished()} disabled={busy} data-testid="trait-published">
            Published layers
          </button>
          <button type="button" onClick={() => void openFolder()} disabled={!folderOk || busy} data-testid="trait-open">
            Open folder
          </button>
          <button type="button" onClick={startEmpty} disabled={busy} data-testid="trait-empty">
            Empty set
          </button>
          <button type="button" onClick={() => void exportImage()} disabled={!doc || busy} data-testid="trait-export-image">
            Export image
          </button>
          <button type="button" onClick={() => void save()} disabled={!active || busy} data-testid="trait-save">
            Save
          </button>
          <button type="button" onClick={() => void roll()} disabled={!doc || busy} data-testid="trait-random">
            Random
          </button>
          <span>{doc ? countLabel(doc.traits.length) : ''}</span>
        </Commands>
        {doc ? (
          <Panes>
            <div style={{ width: leftW, flex: '0 0 auto', minHeight: 0, display: 'flex' }}>
              <Assets
                layers={doc.layers}
                traits={doc.traits}
                worn={worn}
                activeId={activeId}
                openLayer={openLayer}
                live={!gate}
                onOpenLayer={(id) => setOpenLayer((current) => (current === id ? null : id))}
                onSelect={(id) => void select(id)}
                onCycle={(layer, direction) => void cycleLayer(layer, direction)}
                onClear={(layer) => void clearLayer(layer)}
                onToggleHide={(id) => {
                  const current = docRef.current
                  if (!current) return
                  const traits = current.traits.map((trait) => (trait.id === id ? { ...trait, hidden: !trait.hidden } : trait))
                  update({ ...current, traits })
                }}
                onNew={() => void addTrait()}
              />
            </div>
            <Gutter onPointerDown={dragSize('left', leftW)} />
            <Center>
              <BrushBar data-testid="trait-brush">
                {(
                  [
                    ['pen', 'Pen', 'Pen. B'],
                    ['erase', 'Eraser', 'Eraser. E'],
                    ['smudge', 'Smudge', 'Smudge. S. Drags the ink already on the trait. A pen smudges harder as it presses.'],
                    ['pick', 'Pick', 'Pick. I'],
                  ] as const
                ).map(([id, name, title]) => (
                  <button key={id} type="button" title={title} aria-pressed={tool === id} onClick={() => setTool(id)}>
                    {name}
                  </button>
                ))}
                <input type="color" aria-label="Ink" value={ink} onChange={(event) => setInk(event.target.value)} />
                <Knob label="Size" min={1} max={128} unit="px" value={brush.size} onChange={(size) => setBrush({ ...brush, size })} />
                <Knob label="Opacity" min={0} max={1} value={brush.opacity} onChange={(opacity) => setBrush({ ...brush, opacity })} />
                <Knob
                  label="Softness"
                  min={0}
                  max={1}
                  value={brush.softness}
                  hint="0 is a hard circle. With Pixel on, the rim dithers instead of blurring."
                  onChange={(softness) => setBrush({ ...brush, softness })}
                />
                <label title="Hard pixels. Softness still changes which pixels are ink.">
                  <input
                    type="checkbox"
                    checked={brush.pixel}
                    onChange={(event) => setBrush({ ...brush, pixel: event.target.checked })}
                  />
                  Pixel
                </label>
                <Knob
                  label="Spray"
                  min={0}
                  max={1}
                  value={brush.spray}
                  hint="0 is one dab. Higher scatters extra dots. A pen sprays fewer, closer dots as it lifts."
                  onChange={(spray) => setBrush({ ...brush, spray })}
                />
                <Knob
                  label="Scatter"
                  min={0}
                  max={80}
                  unit="px"
                  value={brush.scatter}
                  hint="How far spray dots may land."
                  onChange={(scatter) => setBrush({ ...brush, scatter })}
                />
                <Knob
                  label="Noise"
                  min={0}
                  max={1}
                  value={brush.noise}
                  hint="Grain on each dab. The same stroke repeats the same noise."
                  onChange={(noise) => setBrush({ ...brush, noise })}
                />
                <label title="A pen changes the size. A mouse stays at the knob.">
                  <input
                    type="checkbox"
                    checked={brush.pressureSize}
                    onChange={(event) => setBrush({ ...brush, pressureSize: event.target.checked })}
                  />
                  Pressure size
                </label>
                <label title="A pen changes opacity. A mouse stays at the knob.">
                  <input
                    type="checkbox"
                    checked={brush.pressureOpacity}
                    onChange={(event) => setBrush({ ...brush, pressureOpacity: event.target.checked })}
                  />
                  Pressure opacity
                </label>
              </BrushBar>
              <StageBar>
                <button
                  className="nav"
                  type="button"
                  aria-label="Previous trait"
                  data-testid="trait-prev"
                  disabled={!active}
                  onClick={() => active && void cycleLayer(active.layer, -1)}
                >
                  <Chevron dir="left" />
                </button>
                <span>{active ? `${active.layer} · ${active.name}${place >= 0 ? ` · ${place + 1} of ${ordered.length}` : ''}` : 'Pick a trait'}</span>
                <button
                  className="nav"
                  type="button"
                  aria-label="Next trait"
                  data-testid="trait-next"
                  disabled={!active}
                  onClick={() => active && void cycleLayer(active.layer, 1)}
                >
                  <Chevron dir="right" />
                </button>
              </StageBar>
              <Canvas
                ref={canvasRef}
                brush={brush}
                tool={tool}
                color={ink}
                onPick={setInk}
                behind={split.behind}
                ahead={split.ahead}
              />
              <Preview traits={wearing} />
            </Center>
            <Gutter onPointerDown={dragSize('right', rightW)} />
            <div style={{ width: rightW, flex: '0 0 auto', minHeight: 0, display: 'flex' }}>
              <Inspector trait={active} traits={doc.traits} onChange={patchTrait} />
            </div>
          </Panes>
        ) : (
          <Welcome>
            <h2>MiyaMaker Studio</h2>
            <p>
              The window opens the layers published at <b>koolskull.com/miyamaker/layers</b>. A random character stacks every layer, in the same
              order as koolskull.com/miyamaker. Arrows step through one layer from A to Z. Export image saves the picture you built.
            </p>
            <p>Pressure size and opacity are on. They follow a pen. A mouse paints at the size on the knob. Spray and smudge follow a pen the same way.</p>
            {!folderOk ? <p>This browser cannot open a folder. The published layers still open on their own.</p> : null}
          </Welcome>
        )}
        <Status role="status">
          {busy && !gate ? 'Working… ' : ''}
          {status}
        </Status>
        {gate ? <Loading label={gate.label} done={gate.done} total={gate.total} /> : null}
      </Desk>
    </WindowWrapper>
  )
}
