import type { ReactNode } from 'react'

import type { TitleSkin } from '@/components/TitleBar'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'

export default function ErrorWindow({
  errorLabel,
  handleClose,
  skin,
  children,
}: {
  errorLabel: string
  handleClose: () => void
  /** The look of the app it pops up in. */
  skin?: TitleSkin
  children: ReactNode
}) {
  return (
    <WindowWrapper skin={skin}>
      <TitleBar
        skin={skin}
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          handleClose()
        }}
      >
        {errorLabel}
      </TitleBar>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '0.5rem',
          gap: '1rem',
          height: 'calc(100% - 1.5rem)',
        }}
      >
        {children}
      </div>
    </WindowWrapper>
  )
}
