import { useEffect, useState } from 'react'
import { subscribe } from './model.js'

export function useModel() {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribe(setVersion), [])
  return version
}
