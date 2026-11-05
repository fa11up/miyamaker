import WarningIcon from 'assets/icon/warning.png'
import { useEffect, useRef } from 'react'
import styled from 'styled-components/macro'

import { NormalButton } from '@/components/Button/NormalButton'
import { ErrorButtonWrapper, ErrorContent, ErrorMessage, ErrorWindow } from '@/components/Errors'

const Popup = styled.div`
  position: absolute;
  z-index: 200000;
  top: 50%;
  left: 50%;
  width: min(420px, calc(100% - 32px));
  transform: translate(-50%, -50%);
`

/** Shown when a link points at a path no window owns, e.g. a typo in a shared URL. */
export default function NotFound({ path, onClose }: { path: string; onClose: () => void }) {
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => ok.current?.focus({ preventScroll: true }), [])

  return (
    <Popup role="alertdialog" aria-label="Page not found" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <ErrorWindow errorLabel="Not found" handleClose={onClose}>
        <ErrorContent>
          <ErrorMessage>
            <img src={WarningIcon} alt="" />
            <div>
              C:\{path.replace(/^\//, '').replace(/\//g, '\\')} was not found. Open an app from the desktop instead.
            </div>
          </ErrorMessage>
          <ErrorButtonWrapper>
            <NormalButton ref={ok} style={{ width: '30%' }} onClick={onClose}>
              OK
            </NormalButton>
          </ErrorButtonWrapper>
        </ErrorContent>
      </ErrorWindow>
    </Popup>
  )
}
