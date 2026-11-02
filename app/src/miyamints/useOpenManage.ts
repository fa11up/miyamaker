import { useCallback, useSyncExternalStore } from 'react'
import type { Address } from 'viem'

import { useOpenApp } from '@/music/useOpenApp'
import { updateManagedCollection } from '@/store/experience/actions'
import { useAppDispatch } from '@/store/hooks'

import type { LaunchKind } from './collections'

/**
 * Which collection Manage is focused on, with its chain and kind. The address also goes to the persisted
 * redux `managedCollection` (the legacy Manage flow reads it); chain and kind live here for the session.
 */
export type ManageTarget = { chainId: number; address: Address; kind: LaunchKind }

let current: ManageTarget | undefined
const listeners = new Set<() => void>()

export function setManageTarget(t: ManageTarget | undefined) {
  current = t
  listeners.forEach((l) => l())
}

export function useManageTarget(): ManageTarget | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current
  )
}

/** Focus Manage on a collection and open (or raise) the Manage window. */
export function useOpenManage() {
  const dispatch = useAppDispatch()
  const openApp = useOpenApp()
  return useCallback(
    (t?: ManageTarget) => {
      setManageTarget(t)
      dispatch(updateManagedCollection({ value: t?.address }))
      openApp('manager')
    },
    [dispatch, openApp]
  )
}
