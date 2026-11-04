/**
 * miya radio skins. Each skin is a set of CSS custom properties applied to the player root; every part of the
 * player (and the canvas visualizer, which reads them back with getComputedStyle) draws from these.
 */
export type SkinId = 'classic' | 'lilac' | 'noir' | 'angel'

type Skin = { id: SkinId; label: string; vars: Record<string, string> }

export const SKINS: readonly Skin[] = [
  {
    // Chrome shell, pale grey-green LCD glass with dark ink, and a hot pink glass orb.
    id: 'classic',
    label: 'Chrome',
    vars: {
      '--rk-frame': '#38304f',
      '--rk-frame-2': '#1c1730',
      '--rk-frame-hi': '#8d86b4',
      '--rk-frame-lo': '#0a0814',
      '--rk-frame-ink': '#dfe2ef',
      '--rk-etch': '#d9ddec',
      '--rk-seam': '#10101d',
      '--rk-strip-a': '#6a2bb0',
      '--rk-strip-b': '#1f1f6e',
      '--rk-strip-ink': '#ffffff',
      '--rk-strip-rule': 'rgba(255, 255, 255, 0.55)',
      '--rk-lcd': '#a9b5a1',
      '--rk-lcd-2': '#a9b5a1',
      '--rk-lcd-ink': '#141d17',
      '--rk-lcd-soft': '#4c5a4e',
      '--rk-lcd-dim': 'rgba(20, 29, 23, 0.11)',
      '--rk-lcd-glow': 'rgba(20, 29, 23, 0)',
      '--rk-viz-lo': '#26342a',
      '--rk-viz-mid': '#1c281f',
      '--rk-viz-hi': '#0d130f',
      '--rk-peak': '#0d130f',
      '--rk-btn': '#c4cada',
      '--rk-btn-2': '#8f97ae',
      '--rk-btn-ink': '#14142a',
      '--rk-btn-off': '#50566c',
      '--rk-lamp-off': 'rgba(20, 29, 23, 0.22)',
      '--rk-key-hi': '#f2f5ff',
      '--rk-key-lo': '#474d66',
      '--rk-btn-on': '#1c6b23',
      '--rk-groove': '#7f8b78',
      '--rk-fill-a': '#26342a',
      '--rk-fill-b': '#26342a',
      '--rk-pl': '#a9b5a1',
      '--rk-pl-ink': '#141d17',
      '--rk-pl-cur': '#000000',
      '--rk-pl-sel': '#dbe5d0',
      '--rk-pl-cur-bg': '#2c3930',
      '--rk-pl-hover': 'rgba(20, 29, 23, 0.14)',
      '--rk-pl-num': '#4c5a4e',
    },
  },
  {
    id: 'lilac',
    label: 'Lilac (miyaOS)',
    vars: {
      '--rk-frame': '#b7b1d8',
      '--rk-frame-2': '#9a93c2',
      '--rk-frame-hi': '#ece9ff',
      '--rk-frame-lo': '#4d4672',
      '--rk-frame-ink': '#231b3d',
      '--rk-seam': '#2b2342',
      '--rk-strip-a': '#d97ada',
      '--rk-strip-b': '#8f5fd0',
      '--rk-strip-ink': '#ffffff',
      '--rk-strip-rule': 'rgba(255, 255, 255, 0.45)',
      '--rk-lcd': '#0e0a18',
      '--rk-lcd-2': '#1b1330',
      '--rk-lcd-ink': '#ff9cf2',
      '--rk-lcd-soft': '#b9a8e8',
      '--rk-lcd-dim': 'rgba(255, 156, 242, 0.1)',
      '--rk-lcd-glow': 'rgba(255, 120, 238, 0.55)',
      '--rk-viz-lo': '#7a3cc4',
      '--rk-viz-mid': '#d97ada',
      '--rk-viz-hi': '#ffe0fb',
      '--rk-peak': '#ffffff',
      '--rk-btn': '#cfcae9',
      '--rk-btn-ink': '#2a2147',
      '--rk-btn-on': '#ff7ae6',
      '--rk-groove': '#2a2147',
      '--rk-fill-a': '#8f5fd0',
      '--rk-fill-b': '#ff7ae6',
      '--rk-pl': '#0e0a18',
      '--rk-pl-ink': '#b9b2dc',
      '--rk-pl-cur': '#ffffff',
      '--rk-pl-cur-bg': '#47286d',
      '--rk-pl-hover': '#21183a',
      '--rk-pl-num': '#6f6894',
    },
  },
  {
    id: 'noir',
    label: 'Noir wings',
    vars: {
      '--rk-frame': '#2b2733',
      '--rk-frame-2': '#1a1720',
      '--rk-frame-hi': '#6d6779',
      '--rk-frame-lo': '#050407',
      '--rk-frame-ink': '#cfc8dc',
      '--rk-seam': '#000000',
      '--rk-strip-a': '#3a3445',
      '--rk-strip-b': '#5b2a86',
      '--rk-strip-ink': '#e9e2f5',
      '--rk-strip-rule': 'rgba(185, 140, 255, 0.4)',
      '--rk-lcd': '#050307',
      '--rk-lcd-2': '#120a1c',
      '--rk-lcd-ink': '#c48dff',
      '--rk-lcd-soft': '#9a90ad',
      '--rk-lcd-dim': 'rgba(196, 141, 255, 0.09)',
      '--rk-lcd-glow': 'rgba(160, 90, 255, 0.6)',
      '--rk-viz-lo': '#3b1d63',
      '--rk-viz-mid': '#8a3fe0',
      '--rk-viz-hi': '#e3cbff',
      '--rk-peak': '#c9c3d6',
      '--rk-btn': '#3d3747',
      '--rk-btn-ink': '#ddd5ea',
      '--rk-btn-on': '#b67cff',
      '--rk-groove': '#050307',
      '--rk-fill-a': '#4b2380',
      '--rk-fill-b': '#c48dff',
      '--rk-pl': '#050307',
      '--rk-pl-ink': '#a59cb6',
      '--rk-pl-cur': '#f1e6ff',
      '--rk-pl-cur-bg': '#33184f',
      '--rk-pl-hover': '#17111f',
      '--rk-pl-num': '#5d5569',
    },
  },
  {
    id: 'angel',
    label: 'Cyber angel',
    vars: {
      '--rk-frame': '#dfe9f7',
      '--rk-frame-2': '#b4c6e2',
      '--rk-frame-hi': '#ffffff',
      '--rk-frame-lo': '#5b6f93',
      '--rk-frame-ink': '#1d2846',
      '--rk-seam': '#24304f',
      '--rk-strip-a': '#7fd8ff',
      '--rk-strip-b': '#f59bd5',
      '--rk-strip-ink': '#14203f',
      '--rk-strip-rule': 'rgba(255, 255, 255, 0.7)',
      '--rk-lcd': '#07142a',
      '--rk-lcd-2': '#0d2244',
      '--rk-lcd-ink': '#7ff6ff',
      '--rk-lcd-soft': '#a4bde6',
      '--rk-lcd-dim': 'rgba(127, 246, 255, 0.09)',
      '--rk-lcd-glow': 'rgba(90, 230, 255, 0.55)',
      '--rk-viz-lo': '#2f6bff',
      '--rk-viz-mid': '#5ff0ff',
      '--rk-viz-hi': '#ffc4ee',
      '--rk-peak': '#ff8fd8',
      '--rk-btn': '#eef4ff',
      '--rk-btn-ink': '#1d2846',
      '--rk-btn-on': '#ff6fc9',
      '--rk-groove': '#16244a',
      '--rk-fill-a': '#43c6ff',
      '--rk-fill-b': '#ff8fd8',
      '--rk-pl': '#07142a',
      '--rk-pl-ink': '#a4bde6',
      '--rk-pl-cur': '#ffffff',
      '--rk-pl-cur-bg': '#1f4a7d',
      '--rk-pl-hover': '#10213d',
      '--rk-pl-num': '#5873a3',
    },
  },
]

export const skinById = (id: string | undefined): Skin => SKINS.find((s) => s.id === id) || (SKINS[0] as Skin)

export const nextSkin = (id: SkinId): SkinId => {
  const i = SKINS.findIndex((s) => s.id === id)
  return (SKINS[(i + 1) % SKINS.length] as Skin).id
}

// ── layout prefs (per-viewer convenience; storage may be blocked) ─────────────

export type PanelState = 'open' | 'shade' | 'hidden'
export type RadioLayout = {
  skin: SkinId
  main: 'open' | 'shade'
  eq: PanelState
  pl: PanelState
  onTop: boolean
}

const LAYOUT_KEY = 'miya-radio:layout:v1'
const PANEL: readonly PanelState[] = ['open', 'shade', 'hidden']

export const DEFAULT_LAYOUT: RadioLayout = {
  skin: 'lilac',
  main: 'open',
  eq: 'shade',
  pl: 'open',
  onTop: false,
}

export function loadLayout(): RadioLayout {
  try {
    const v = JSON.parse(window.localStorage.getItem(LAYOUT_KEY) || 'null') as Partial<RadioLayout> | null
    if (!v || typeof v !== 'object') return DEFAULT_LAYOUT
    return {
      skin: skinById(v.skin).id,
      main: v.main === 'shade' ? 'shade' : 'open',
      eq: PANEL.includes(v.eq as PanelState) ? (v.eq as PanelState) : DEFAULT_LAYOUT.eq,
      pl: PANEL.includes(v.pl as PanelState) ? (v.pl as PanelState) : DEFAULT_LAYOUT.pl,
      onTop: v.onTop === true,
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

export function saveLayout(layout: RadioLayout) {
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // ignore
  }
}
