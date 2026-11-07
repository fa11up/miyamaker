/**
 * Which windows are open, in what order, and which are put away. Pure, so `node --test` can run it
 * (tests/windows-stack.test.mts); the reducer does the navigating.
 */
export type WindowLists = { active: string[]; zIndex: string[]; fullScreen: string[]; minimized: string[] }

const without = (list: string[], id: string) => list.filter((other) => other !== id)

export function closed(lists: WindowLists, id: string): WindowLists {
  return {
    active: without(lists.active, id),
    zIndex: without(lists.zIndex, id),
    fullScreen: without(lists.fullScreen, id),
    minimized: without(lists.minimized, id),
  }
}

/** Puts a window away. Bringing one back is `raised`: this never toggles. */
export function minimized(lists: WindowLists, id: string): WindowLists {
  if (!lists.active.includes(id) || lists.minimized.includes(id)) return lists
  return { ...lists, zIndex: without(lists.zIndex, id), minimized: [...lists.minimized, id] }
}

/** Brings an open window to the top, back from minimized if need be. A window that isn't open stays that way. */
export function raised(lists: WindowLists, id: string): WindowLists {
  if (!lists.active.includes(id)) return lists
  return { ...lists, zIndex: [...without(lists.zIndex, id), id], minimized: without(lists.minimized, id) }
}

/**
 * A saved session can hold what older builds left behind: a closed window still marked minimized (it would reopen
 * hidden), or a showing window missing from the stack (it would have no place in it).
 */
export function repaired(lists: Partial<WindowLists>): WindowLists {
  const active = lists.active ?? []
  const away = (lists.minimized ?? []).filter((id) => active.includes(id))
  const stack = (lists.zIndex ?? []).filter((id) => active.includes(id) && !away.includes(id))
  return {
    active,
    zIndex: [...stack, ...active.filter((id) => !away.includes(id) && !stack.includes(id))],
    fullScreen: (lists.fullScreen ?? []).filter((id) => active.includes(id)),
    minimized: away,
  }
}
