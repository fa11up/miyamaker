import logoSrc from 'assets/134321870.png'
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

import { rightEdge } from './look'
import { release } from './release'

/**
 * The handheld as a real 3D object, lazily loaded so only Mint pays for three.js. One unit is one CSS pixel, and the
 * camera matches the page's CSS perspective, so the live screen and buttons in the DOM stay locked on to the model.
 * Thick, deeply rounded edges are what make it feel like it sits in the hand.
 */
export const PERSPECTIVE = 1100
export const MARGIN = 70
const DEPTH = 22
const BEVEL = 10
/** The model's front sits this far back, so the live screen on top of it is pixel for pixel at rest, not scaled. */
const FRONT = BEVEL + 5

export type Rect = { x: number; y: number; w: number; h: number }
export type Layout = {
  w: number
  h: number
  bezel?: Rect
  pad?: Rect
  a?: Rect
  b?: Rect
  select?: Rect
  start?: Rect
  save?: Rect
  power?: Rect
  brand?: Rect
}
export type Part = 'a' | 'b' | 'select' | 'start' | 'up' | 'down' | 'left' | 'right' | 'save' | 'power'

const K = 0.5523

/** The body's SVG outline as a shape centred on the origin, y up. */
function bodyShape(path: string, w: number, h: number) {
  const s = new Shape()
  const tokens = path.match(/[MHVLCZ]|-?\d+(?:\.\d+)?/g) ?? []
  const X = (v: number) => v - w / 2
  const Y = (v: number) => h / 2 - v
  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    if (/[MHVLCZ]/.test(tokens[i]!)) cmd = tokens[i++]!
    if (cmd === 'M') {
      x = num()
      y = num()
      s.moveTo(X(x), Y(y))
    } else if (cmd === 'L') {
      x = num()
      y = num()
      s.lineTo(X(x), Y(y))
    } else if (cmd === 'H') {
      x = num()
      s.lineTo(X(x), Y(y))
    } else if (cmd === 'V') {
      y = num()
      s.lineTo(X(x), Y(y))
    } else if (cmd === 'C') {
      const [a, b, c, d, e, f] = [num(), num(), num(), num(), num(), num()]
      s.bezierCurveTo(X(a), Y(b), X(c), Y(d), X(e), Y(f))
      x = e
      y = f
    }
  }
  return s
}

function roundRect(w: number, h: number, r: number) {
  const l = -w / 2
  const t = h / 2
  const s = new Shape()
  s.moveTo(l + r, t)
  s.lineTo(-l - r, t)
  s.bezierCurveTo(-l - r + r * K, t, -l, t - r + r * K, -l, t - r)
  s.lineTo(-l, -t + r)
  s.bezierCurveTo(-l, -t + r - r * K, -l - r + r * K, -t, -l - r, -t)
  s.lineTo(l + r, -t)
  s.bezierCurveTo(l + r - r * K, -t, l, -t + r - r * K, l, -t + r)
  s.lineTo(l, t - r)
  s.bezierCurveTo(l, t - r + r * K, l + r - r * K, t, l + r, t)
  return s
}

const capsule = (L: number, R: number) => {
  const s = new Shape()
  s.moveTo(-L / 2 + R, R)
  s.lineTo(L / 2 - R, R)
  s.absarc(L / 2 - R, 0, R, Math.PI / 2, -Math.PI / 2, true)
  s.lineTo(-L / 2 + R, -R)
  s.absarc(-L / 2 + R, 0, R, -Math.PI / 2, Math.PI / 2, true)
  return s
}

const box = (rect: Rect, layout: Layout) => ({
  x: rect.x + rect.w / 2 - layout.w / 2,
  y: layout.h / 2 - rect.y - rect.h / 2,
})

/**
 * An early circuit board: green solder mask with a little unevenness, tinned traces in parallel runs that bend at 45
 * degrees, through-hole pads, chip footprints with white silkscreen and reference marks, and gold edge contacts.
 */
function drawBoard(w: number, h: number) {
  const K2 = 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * K2)
  canvas.height = Math.ceil(h * K2)
  const g = canvas.getContext('2d')!
  g.scale(K2, K2)
  let seed = 1987
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  g.fillStyle = '#1c5a3a'
  g.fillRect(0, 0, w, h)
  // Mask that was poured, not printed.
  for (let i = 0; i < 900; i += 1) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,220' : '0,20,10'}, ${0.012 + rnd() * 0.022})`
    const r = 4 + rnd() * 26
    g.beginPath()
    g.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2)
    g.fill()
  }

  const TIN = '#c9cbc2'
  const TIN_DARK = '#7f8a7f'
  const pad = (x: number, y: number, r = 3.2) => {
    g.fillStyle = TIN
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#0c1a12'
    g.beginPath()
    g.arc(x, y, r * 0.42, 0, Math.PI * 2)
    g.fill()
  }
  /** A run of parallel traces that goes across, down a 45 degree bend, and across again. */
  const bus = (x: number, y: number, len: number, drop: number, lines: number, flip: number) => {
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (let i = 0; i < lines; i += 1) {
      const o = i * 6
      const pts: [number, number][] = [
        [x, y + o],
        [x + len * flip, y + o],
        [x + (len + drop) * flip, y + o + drop],
        [x + (len + drop + len * 0.7) * flip, y + o + drop],
      ]
      ;[TIN_DARK, TIN].forEach((c, n) => {
        g.strokeStyle = c
        g.lineWidth = n === 0 ? 2.3 : 1.4
        g.beginPath()
        pts.forEach(([a, b], k) => (k ? g.lineTo(a, b) : g.moveTo(a, b)))
        g.stroke()
      })
      pad(pts[0]![0], pts[0]![1], 2.6)
      pad(pts[3]![0], pts[3]![1], 2.6)
    }
  }
  /** A chip's footprint: two rows of pads and its white outline, without the chip. */
  const dip = (x: number, y: number, pins: number, name: string) => {
    const gap = 7.4
    const wide = 30
    for (let i = 0; i < pins; i += 1) {
      pad(x, y + i * gap)
      pad(x + wide, y + i * gap)
    }
    g.strokeStyle = 'rgba(240, 240, 225, 0.85)'
    g.lineWidth = 1
    g.strokeRect(x + 6, y - 5, wide - 12, (pins - 1) * gap + 10)
    g.beginPath()
    g.arc(x + wide / 2, y - 5, 3, 0, Math.PI)
    g.stroke()
    silk(name, x + wide + 8, y + 4)
  }
  const silk = (text: string, x: number, y: number) => {
    g.font = '700 7px "Courier New", Courier, monospace'
    g.fillStyle = 'rgba(240, 240, 225, 0.88)'
    g.fillText(text, x, y)
  }
  /** A resistor or capacitor footprint: two pads, a white body, its mark. */
  const part = (x: number, y: number, name: string, up: boolean) => {
    const dx = up ? 0 : 22
    const dy = up ? 22 : 0
    pad(x, y, 2.6)
    pad(x + dx, y + dy, 2.6)
    g.strokeStyle = 'rgba(240, 240, 225, 0.8)'
    g.lineWidth = 1
    if (up) g.strokeRect(x - 3.5, y + 5, 7, 12)
    else g.strokeRect(x + 5, y - 3.5, 12, 7)
    silk(name, x + (up ? 6 : 2), y + (up ? 14 : -6))
  }

  for (let i = 0; i < 16; i += 1) {
    const flip = rnd() > 0.5 ? 1 : -1
    const x = flip > 0 ? rnd() * w * 0.5 : w * 0.5 + rnd() * w * 0.5
    bus(x, rnd() * h * 0.92, 18 + rnd() * 50, 12 + rnd() * 34, 2 + Math.floor(rnd() * 4), flip)
  }
  const chips: [number, number, number][] = [
    [0.1, 0.72, 10],
    [0.36, 0.8, 8],
    [0.62, 0.72, 12],
    [0.82, 0.8, 7],
    [0.08, 0.2, 14],
    [0.82, 0.3, 14],
  ]
  chips.forEach(([fx, fy, pins], i) => dip(fx * w, fy * h, pins, `U${i + 1}`))
  for (let i = 0; i < 24; i += 1) {
    part(rnd() * w * 0.94, rnd() * h * 0.92, `${rnd() > 0.5 ? 'R' : 'C'}${i + 1}`, rnd() > 0.5)
  }
  for (let i = 0; i < 70; i += 1) pad(rnd() * w, rnd() * h, 1.8)
  silk('MIYA-01  REV B', w * 0.36, h * 0.975)
  g.fillStyle = '#d7ad47'
  for (let i = 0; i < 26; i += 1) g.fillRect(w * 0.2 + (i * (w * 0.6)) / 26, h * 0.985, 7, 16)

  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}

/** Text as if pressed into the plastic: a dark upper lip and a lit lower one. */
function pressedText(words: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const g = canvas.getContext('2d')!
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `italic 700 34px 'Arial Narrow', Arial, sans-serif`
  g.fillStyle = 'rgba(255, 255, 255, 0.6)'
  g.fillText(words, 128, 35)
  g.fillStyle = 'rgba(8, 4, 20, 0.92)'
  g.fillText(words, 128, 32)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  const bump = document.createElement('canvas')
  bump.width = 256
  bump.height = 64
  const bg = bump.getContext('2d')!
  bg.fillStyle = '#fff'
  bg.fillRect(0, 0, 256, 64)
  bg.textAlign = 'center'
  bg.textBaseline = 'middle'
  bg.font = g.font
  bg.filter = 'blur(1px)'
  bg.fillStyle = '#000'
  bg.fillText(words, 128, 32)
  return { map: tex, bump: new CanvasTexture(bump) }
}

function letterTexture(letter: string, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const g = canvas.getContext('2d')!
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `italic 800 74px Arial, sans-serif`
  g.fillStyle = 'rgba(255, 255, 255, 0.4)'
  g.fillText(letter, 64, 70)
  g.fillStyle = color
  g.fillText(letter, 64, 67)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}

/** A rubber dome: flat skirt, rounded shoulder, slightly dished top. */
function domeGeometry(radius: number, height: number) {
  // From the skirt up: lathe faces point outward when the profile climbs.
  const points = [
    new Vector2(radius, 0),
    new Vector2(radius, height - 4.5),
    new Vector2(radius * 0.97, height - 2.6),
    new Vector2(radius * 0.9, height - 1.1),
    new Vector2(radius * 0.8, height - 0.4),
    new Vector2(radius * 0.6, height - 0.9),
    new Vector2(radius * 0.3, height - 1.4),
    new Vector2(0, height - 1.6),
  ]
  return new LatheGeometry(points, 48)
}

export type DeviceScene = ReturnType<typeof createDeviceScene>

export function createDeviceScene(canvas: HTMLCanvasElement, cheap: boolean) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.outputColorSpace = SRGBColorSpace
  renderer.useLegacyLights = false

  const scene = new Scene()
  const pmrem = new PMREMGenerator(renderer)
  const env = pmrem.fromScene(new RoomEnvironment(), 0.08)
  scene.environment = env.texture

  const camera = new PerspectiveCamera(30, 1, 10, 4000)
  camera.position.set(0, 0, PERSPECTIVE)

  // Soft and from the front: enough to shape the plastic without burning a white patch on it.
  const key = new DirectionalLight(0xfff4e6, 0.55)
  key.position.set(-160, 260, 900)
  scene.add(key)
  const rim = new DirectionalLight(0xb7c9ff, 0.7)
  rim.position.set(420, -200, 260)
  scene.add(rim)

  const device = new Group()
  scene.add(device)
  let built = new Group()
  device.add(built)

  const parts: Partial<Record<Part, Group>> = {}
  const pressed: Partial<Record<Part, number>> = {}
  const pressGoal: Partial<Record<Part, number>> = {}
  let padGroup: Group | undefined
  let knob: Group | undefined
  let saveKey: Group | undefined
  let switchGoal = 0
  let switchAt = 0
  let saveGoal = 0
  let saveAt = 0
  const POWER_TRAVEL = 26

  const shellMat = new MeshPhysicalMaterial(
    cheap
      ? {
          transparent: true,
          opacity: 0.74,
          roughness: 0.36,
          clearcoat: 0.08,
          clearcoatRoughness: 0.5,
          envMapIntensity: 0.2,
          specularIntensity: 0.3,
        }
      : {
          transmission: 0.94,
          thickness: 6,
          ior: 1.46,
          roughness: 0.1,
          attenuationDistance: 130,
          clearcoat: 0.08,
          clearcoatRoughness: 0.5,
          envMapIntensity: 0.2,
          specularIntensity: 0.3,
        },
  )
  const backMat = new MeshStandardMaterial({ roughness: 0.7 })
  const sidePlastic = new MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25 })
  const rubber = new MeshPhysicalMaterial({
    color: 0x1d1c23,
    roughness: 0.55,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
  })
  const dark = new MeshStandardMaterial({ color: 0x08080c, roughness: 0.7, envMapIntensity: 0.12 })
  const well = new MeshStandardMaterial({ color: 0x08070c, roughness: 0.85 })
  // The logo as paint on white, and as a height map where the black ink stands a little proud.
  const printCanvas = document.createElement('canvas')
  const reliefCanvas = document.createElement('canvas')
  printCanvas.width = 512
  printCanvas.height = 512
  reliefCanvas.width = 512
  reliefCanvas.height = 512
  const printMap = new CanvasTexture(printCanvas)
  printMap.colorSpace = SRGBColorSpace
  printMap.anisotropy = renderer.capabilities.getMaxAnisotropy()
  const reliefMap = new CanvasTexture(reliefCanvas)
  const logoImage = new Image()
  logoImage.onload = () => {
    const paint = printCanvas.getContext('2d')!
    paint.fillStyle = '#f4f1ea'
    paint.fillRect(0, 0, 512, 512)
    paint.drawImage(logoImage, 0, 0, 512, 512)
    const relief = reliefCanvas.getContext('2d')!
    relief.filter = 'invert(1) blur(1.5px)'
    relief.drawImage(printCanvas, 0, 0)
    printMap.needsUpdate = true
    reliefMap.needsUpdate = true
  }
  logoImage.src = logoSrc
  // Lit partly by its own print, so the paint reads black and white under the shell's soft light, not grey.
  const badgeMat = new MeshPhysicalMaterial({
    map: printMap,
    bumpMap: reliefMap,
    bumpScale: 4,
    emissive: 0xffffff,
    emissiveMap: printMap,
    emissiveIntensity: 0.55,
    roughness: 0.5,
    clearcoat: 0.2,
    clearcoatRoughness: 0.45,
    envMapIntensity: 0.25,
  })

  /** Made once and reused by every build, so a rebuild must leave them be. */
  const shared = new Set<Material>([shellMat, backMat, sidePlastic, rubber, dark, well, badgeMat])

  let path = ''
  let tintHex = '#9a6cf0'
  let inkHex = '#ffffff'
  let lastLayout: Layout | undefined

  const build = (layout: Layout) => {
    if (!path) return
    device.remove(built)
    release(built, shared)
    built = new Group()
    built.position.z = -FRONT
    device.add(built)
    padGroup = undefined
    knob = undefined
    saveKey = undefined
    const { w, h } = layout
    const outline = bodyShape(path, w, h)

    const shell = new Mesh(
      new ExtrudeGeometry(outline, {
        depth: DEPTH,
        bevelEnabled: true,
        bevelSize: BEVEL,
        bevelOffset: -BEVEL,
        bevelThickness: BEVEL,
        bevelSegments: 10,
        curveSegments: 28,
      }),
      shellMat,
    )
    shell.position.z = -DEPTH
    built.add(shell)

    const boardGeo = new ShapeGeometry(outline, 16)
    const uv = boardGeo.attributes.uv!
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, (uv.getX(i) + w / 2) / w, (uv.getY(i) + h / 2) / h)
    boardGeo.scale(0.93, 0.95, 1)
    const board = new Mesh(
      boardGeo,
      new MeshStandardMaterial({ map: drawBoard(w, h), roughness: 0.55, metalness: 0.15 }),
    )
    board.position.z = -DEPTH + 10
    built.add(board)

    const backGeo = new ShapeGeometry(outline, 16)
    backGeo.scale(0.97, 0.98, 1)
    const back = new Mesh(backGeo, backMat)
    back.position.z = -DEPTH - 2
    built.add(back)

    if (layout.bezel) {
      const at = box(layout.bezel, layout)
      const plate = new Mesh(
        new ExtrudeGeometry(roundRect(layout.bezel.w - 4, layout.bezel.h - 4, 20), {
          depth: 3,
          bevelEnabled: true,
          bevelSize: 2,
          bevelThickness: 1.6,
          bevelSegments: 4,
          curveSegments: 16,
        }),
        dark,
      )
      plate.position.set(at.x, at.y, BEVEL)
      built.add(plate)
    }

    if (layout.brand) {
      // A moulded badge standing proud of the shell, with the logo printed on its domed face and the ink raised on it.
      const at = box(layout.brand, layout)
      const r = layout.brand.w / 2
      const shadow = new Mesh(
        new CircleGeometry(r + 1.8, 48),
        new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false }),
      )
      shadow.position.set(at.x + 0.5, at.y - 0.9, BEVEL + 0.05)
      built.add(shadow)
      const geo = new LatheGeometry(
        [
          new Vector2(r + 0.7, 0),
          new Vector2(r + 0.5, 1.1),
          new Vector2(r, 2),
          new Vector2(r * 0.94, 2.5),
          new Vector2(r * 0.75, 2.85),
          new Vector2(r * 0.4, 3),
          new Vector2(0, 3),
        ],
        64,
      )
      // The lathe's own texture wraps round it: lay the print flat across the face instead.
      const pos = geo.attributes.position!
      const uv = geo.attributes.uv!
      for (let i = 0; i < pos.count; i += 1) {
        uv.setXY(i, (pos.getX(i) / r + 1) / 2, (-pos.getZ(i) / r + 1) / 2)
      }
      const badge = new Mesh(geo, badgeMat)
      badge.rotation.x = Math.PI / 2
      badge.position.set(at.x, at.y, BEVEL)
      built.add(badge)
    }

    if (layout.pad) {
      const at = box(layout.pad, layout)
      const cell = layout.pad.w / 3
      const half = (cell * 0.92) / 2
      const reach = cell * 1.5 - 1
      const s = new Shape()
      s.moveTo(-half, reach)
      s.lineTo(half, reach)
      s.lineTo(half, half)
      s.lineTo(reach, half)
      s.lineTo(reach, -half)
      s.lineTo(half, -half)
      s.lineTo(half, -reach)
      s.lineTo(-half, -reach)
      s.lineTo(-half, -half)
      s.lineTo(-reach, -half)
      s.lineTo(-reach, half)
      s.lineTo(-half, half)
      s.closePath()
      padGroup = new Group()
      padGroup.position.set(at.x, at.y, BEVEL + 1)
      padGroup.add(
        new Mesh(
          new ExtrudeGeometry(s, {
            depth: 7,
            bevelEnabled: true,
            bevelSize: 2.2,
            bevelThickness: 2.2,
            bevelSegments: 5,
            curveSegments: 8,
          }),
          rubber,
        ),
      )
      const dish = new Mesh(
        new CircleGeometry(half * 0.84, 32),
        new MeshPhysicalMaterial({ color: 0x101016, roughness: 0.32 }),
      )
      dish.position.z = 9.4
      padGroup.add(dish)
      const arrow = new Shape()
      arrow.moveTo(0, 4.5)
      arrow.lineTo(4.5, -2.5)
      arrow.lineTo(-4.5, -2.5)
      arrow.closePath()
      const arrowMat = new MeshStandardMaterial({ color: 0x8a8793, roughness: 0.5 })
      ;[0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach((turn) => {
        const m = new Mesh(new ShapeGeometry(arrow), arrowMat)
        m.rotation.z = turn
        const d = reach * 0.68
        m.position.set(-Math.sin(turn) * d, Math.cos(turn) * d, 9.45)
        padGroup!.add(m)
      })
      built.add(padGroup)
    }

    const round = (id: 'a' | 'b', rect: Rect | undefined, color: number, letter: string, ink: string) => {
      if (!rect) return
      const at = box(rect, layout)
      const r = rect.w / 2 - 3
      const group = new Group()
      group.position.set(at.x, at.y, BEVEL)
      // Faces lean a little toward the thumb.
      group.rotation.y = -0.07
      group.rotation.x = 0.05
      const seam = new Mesh(new TorusGeometry(r + 1.5, 1, 10, 56), well)
      seam.position.set(at.x, at.y, BEVEL + 0.2)
      built.add(seam)
      const dome = new Mesh(
        domeGeometry(r, 15),
        new MeshPhysicalMaterial({
          color,
          roughness: 0.32,
          clearcoat: 1,
          clearcoatRoughness: 0.15,
          envMapIntensity: 1.1,
        }),
      )
      dome.rotation.x = Math.PI / 2
      group.add(dome)
      const label = new Mesh(
        new CircleGeometry(r * 0.72, 32),
        new MeshStandardMaterial({
          map: letterTexture(letter, ink),
          transparent: true,
          roughness: 0.3,
          depthWrite: false,
        }),
      )
      label.position.z = 14.9
      group.add(label)
      built.add(group)
      parts[id] = group
    }
    round('a', layout.a, 0xff7a10, 'A', '#4a1d00')
    round('b', layout.b, 0x35323e, 'B', '#e6e3f0')

    const pill = (id: 'select' | 'start', rect: Rect | undefined, words: string) => {
      if (!rect) return
      const at = box(rect, layout)
      const group = new Group()
      group.position.set(at.x, at.y + 5, BEVEL)
      group.rotation.z = 0.33
      const L = rect.w - 6
      const slot = new Mesh(new ShapeGeometry(capsule(L + 5, 8.5), 16), well)
      slot.position.z = 0.25
      group.add(slot)
      const press = new Group()
      press.add(
        new Mesh(
          new ExtrudeGeometry(capsule(L, 6), {
            depth: 2.4,
            bevelEnabled: true,
            bevelSize: 1.2,
            bevelThickness: 1.4,
            bevelSegments: 4,
            curveSegments: 12,
          }),
          rubber,
        ),
      )
      group.add(press)
      parts[id] = press
      built.add(group)
      const text = pressedText(words)
      const decal = new Mesh(
        new PlaneGeometry(76, 19),
        new MeshStandardMaterial({
          map: text.map,
          bumpMap: text.bump,
          bumpScale: 2,
          transparent: true,
          depthWrite: false,
          roughness: 0.35,
        }),
      )
      decal.position.set(at.x - 7, at.y - 18, BEVEL + 0.15)
      decal.rotation.z = 0.33
      built.add(decal)
    }
    pill('select', layout.select, 'SELECT')
    pill('start', layout.start, 'START')

    // Speaker: a small field of real holes beside Start.
    if (layout.start) {
      const at = box(layout.start, layout)
      const holes = new InstancedMesh(new CylinderGeometry(1.7, 1.7, 1, 12), well, 24)
      const m = new Matrix4()
      const rot = new Matrix4().makeRotationX(Math.PI / 2)
      let n = 0
      for (let row = 0; row < 4; row += 1) {
        for (let col = 0; col < 6; col += 1) {
          m.makeTranslation(at.x + 62 + col * 6.6 + (row % 2) * 3.3, at.y - 9 + row * 5.8, BEVEL + 0.08)
          m.multiply(rot)
          holes.setMatrixAt(n, m)
          n += 1
        }
      }
      built.add(holes)
    }

    // Side controls: moulded in the shell's own plastic, each sitting in a dark seam cut through the wall.
    const sideZ = -DEPTH / 2
    const mountAt = (rect: Rect) => {
      const cy = rect.y + rect.h / 2
      const edge = rightEdge(path, cy) - w / 2
      const lean = Math.atan2(rightEdge(path, cy - 14) - rightEdge(path, cy + 14), 28)
      return { y: h / 2 - cy, edge, lean }
    }
    if (layout.save) {
      const { y, edge, lean } = mountAt(layout.save)
      const seat = new Group()
      seat.position.set(edge, y, sideZ)
      seat.rotation.z = lean
      const seam = new Mesh(
        new ExtrudeGeometry(capsule(layout.save.h + 5, 8), { depth: 2, bevelEnabled: false, curveSegments: 12 }),
        well,
      )
      seam.rotation.y = Math.PI / 2
      seam.rotation.z = Math.PI / 2
      seam.position.x = -0.6
      seat.add(seam)
      saveKey = new Group()
      const cap = new Mesh(
        new ExtrudeGeometry(capsule(layout.save.h, 6), {
          depth: 2,
          bevelEnabled: true,
          bevelSize: 1.4,
          bevelThickness: 2,
          bevelSegments: 6,
          curveSegments: 14,
        }),
        sidePlastic,
      )
      cap.rotation.y = Math.PI / 2
      cap.rotation.z = Math.PI / 2
      saveKey.add(cap)
      seat.add(saveKey)
      built.add(seat)
    }
    if (layout.power) {
      const { y, edge, lean } = mountAt(layout.power)
      const seat = new Group()
      seat.position.set(edge, y, sideZ)
      seat.rotation.z = lean
      const track = new Mesh(
        new ExtrudeGeometry(capsule(layout.power.h + 4, 7.5), { depth: 2, bevelEnabled: false, curveSegments: 12 }),
        well,
      )
      track.rotation.y = Math.PI / 2
      track.rotation.z = Math.PI / 2
      track.position.x = -0.6
      seat.add(track)
      knob = new Group()
      const cap = new Mesh(
        new ExtrudeGeometry(capsule(24, 5.5), {
          depth: 2.2,
          bevelEnabled: true,
          bevelSize: 1.2,
          bevelThickness: 1.6,
          bevelSegments: 5,
          curveSegments: 12,
        }),
        rubber,
      )
      cap.rotation.y = Math.PI / 2
      cap.rotation.z = Math.PI / 2
      knob.add(cap)
      const ribMat = new MeshPhysicalMaterial({ color: 0x4a4854, roughness: 0.45, clearcoat: 0.3 })
      for (let i = -2; i <= 2; i += 1) {
        const rib = new Mesh(new CylinderGeometry(0.85, 0.85, 9.5, 10), ribMat)
        rib.rotation.x = Math.PI / 2
        rib.position.set(4.3, i * 3.6, 0)
        knob.add(rib)
      }
      knob.position.y = POWER_TRAVEL / 2
      seat.add(knob)
      built.add(seat)
    }
  }

  const applyTint = () => {
    const c = new Color(tintHex)
    shellMat.color = c
    if (!cheap) shellMat.attenuationColor = c
    backMat.color = c.clone().multiplyScalar(0.28)
    sidePlastic.color = c.clone().multiplyScalar(0.72)
    shellMat.needsUpdate = true
  }

  return {
    /** The space the canvas covers, device plus margin, in CSS pixels. */
    resize(w: number, h: number, pixelRatio: number) {
      const width = w + MARGIN * 2
      const height = h + MARGIN * 2
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.fov = (2 * Math.atan(height / 2 / PERSPECTIVE) * 180) / Math.PI
      camera.updateProjectionMatrix()
    },
    setLook(next: { path: string; tintHex: string; inkHex: string }) {
      const rebuild = next.path !== path || next.inkHex !== inkHex
      path = next.path
      tintHex = next.tintHex
      inkHex = next.inkHex
      applyTint()
      if (rebuild && lastLayout) build(lastLayout)
    },
    setLayout(layout: Layout) {
      lastLayout = layout
      build(layout)
    },
    press(part: Part, down: boolean) {
      pressGoal[part] = down ? 1 : 0
    },
    setSwitch(off: boolean) {
      switchGoal = off ? 1 : 0
    },
    setSave(inward: boolean) {
      saveGoal = inward ? 1 : 0
    },
    /** One frame: `rx` and `ry` are the same angles the DOM layer has, in degrees. */
    render(rx: number, ry: number, lightX: number, lightY: number) {
      device.rotation.x = (-rx * Math.PI) / 180
      device.rotation.y = (ry * Math.PI) / 180
      key.position.x = -160 + lightX * 120
      key.position.y = 260 + lightY * 80

      ;(['a', 'b', 'select', 'start'] as Part[]).forEach((p) => {
        const g = parts[p]
        if (!g) return
        const at = (pressed[p] ?? 0) + ((pressGoal[p] ?? 0) - (pressed[p] ?? 0)) * 0.4
        pressed[p] = at
        const dome = p === 'a' || p === 'b'
        g.position.z = (dome ? BEVEL : 0) - at * (dome ? 4 : 1.6)
      })
      if (padGroup) {
        const axis = (a: Part, b: Part) => ((pressGoal[a] ?? 0) - (pressGoal[b] ?? 0)) * 0.09
        padGroup.rotation.x += (-axis('up', 'down') - padGroup.rotation.x) * 0.35
        padGroup.rotation.y += (axis('right', 'left') - padGroup.rotation.y) * 0.35
      }
      switchAt += (switchGoal - switchAt) * 0.28
      if (knob) knob.position.y = POWER_TRAVEL / 2 - switchAt * POWER_TRAVEL
      saveAt += (saveGoal - saveAt) * 0.35
      if (saveKey) saveKey.position.x = -saveAt * 3

      renderer.render(scene, camera)
    },
    dispose() {
      logoImage.onload = null
      release(built)
      shared.forEach((mat) => mat.dispose())
      printMap.dispose()
      reliefMap.dispose()
      scene.environment = null
      env.dispose()
      pmrem.dispose()
      renderer.dispose()
      // Hand the context back now, rather than whenever the canvas is collected.
      renderer.forceContextLoss()
    },
  }
}
