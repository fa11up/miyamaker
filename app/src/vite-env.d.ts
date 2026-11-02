/// <reference types="vite-plugin-svgr/client" />
/// <reference types="vite/client" />

declare module '*.svg' {
  import type { FunctionComponent, SVGProps } from 'react'

  export const ReactComponent: FunctionComponent<SVGProps<SVGSVGElement> & { title?: string }>

  const src: string
  export default src
}

declare module '*.json' {
  const value: any
  export default value
}

declare module '*.gif' {
  const value: any
  export default value
}

interface Window {
  ethereum?: any
  toggleDevtools: undefined | (() => void)
}

type ResizedImage = {
  class: string
  srcset: string
  loading: string
  src: string
  type: string
}

declare module '*&resize=true' {
  // this is added for typescript to recognize the images that have been modified by vite-plugin-image-presets
  const preset: ResizedImage[]
  export default preset
}

declare module 'filereader-stream'

interface ImportMetaEnv {
  readonly VITE_WC_PROJECT_ID?: string
  readonly VITE_GRAPHQL_URL?: string
  readonly VITE_ANALYTICS_ID?: string
  readonly VITE_RPC_URL_1?: string
  readonly VITE_RPC_URL_11155111?: string
  readonly VITE_RPC_URL_4663?: string
}
