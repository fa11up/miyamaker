/**
 * Activity the desktop can't see for itself. Keys and pointer events inside a framed app (miyakeys's sandboxed page)
 * stay in its frame, so the frame reports them by postMessage and its window passes them on here. The screensaver's
 * idle timer counts them like activity on the desktop, and a screensaver already showing closes.
 */

export const ACTIVITY_EVENT = 'miyaos:activity'

export type FrameActivity = 'pointerdown' | 'drag' | 'key' | 'wheel'
export type ActivityDetail = { kind: FrameActivity; frame: HTMLIFrameElement | null } | undefined

/**
 * Someone is using the desktop (in a frame the desktop can't see into). A press in a frame also brings its window
 * to the front and closes open menus, like a press anywhere else (a frame click may not blur this window).
 */
export function reportActivity(detail?: ActivityDetail) {
  window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, { detail }))
}

/** The frame a press was reported from, when the event is one. */
export function pressedFrame(e: Event): HTMLIFrameElement | null {
  const { detail } = e as CustomEvent<ActivityDetail>
  return detail?.kind === 'pointerdown' ? detail.frame : null
}

const KINDS: readonly string[] = ['pointerdown', 'drag', 'key', 'wheel']

/**
 * The kind of activity in a message, when it comes from this frame's own window and has this type; null otherwise.
 * The frame's origin is opaque ("null"), so the source window is what tells it apart from any other page.
 */
export function frameActivity(
  e: { source: unknown; data: unknown },
  frame: Window | null | undefined,
  type: string
): FrameActivity | null {
  if (!frame || e.source !== frame) return null
  const d = e.data as { type?: unknown; kind?: unknown } | null
  if (!d || typeof d !== 'object' || d.type !== type) return null
  return typeof d.kind === 'string' && KINDS.includes(d.kind) ? (d.kind as FrameActivity) : null
}
