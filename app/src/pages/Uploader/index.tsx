import styled from 'styled-components/macro'

import ProgressBarUploader from '@/components/ProgressUploader'
import { Panel } from '@/components/Retro'
import { pinstripe, y2kSkin } from '@/components/Retro/y2k'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, deleteUploadOrder, finalizeUploadOrder, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen, useLastUploadRequest } from '@/store/windows/hooks'
import type { PageKey } from '@/store/windows/reducer'
import { space } from '@/theme/tokens'

import { gel } from '../DropMusic/y2k'

/** Infinite Upload's own material: the rainbow sheen of a blank CD on a night-blue burner. */
const Layout = styled.div`
  display: flex;
  flex-direction: column;
  padding: 0.5rem;
  gap: 1rem;
  height: 100%;
  overflow: auto;
  ${y2kSkin({
    ink: '#07184a',
    inkSoft: '#2a3f80',
    material: `${pinstripe(0.06)}, linear-gradient(170deg, #1b3fb0 0%, #0a1f6e 55%, #040c34 100%)`,
    head: '#ffffff',
    headShadow: '#040c34',
    frost: 'rgba(240, 248, 255, 0.92)',
    edge: '#07184a',
    glow: 'rgba(90, 190, 255, 0.3)',
    gelTop: '#c8f6ff',
    gelBottom: '#27b8ff',
    gelInk: '#04123a',
    smallTop: '#ffe2f5',
    smallBottom: '#ff8fd6',
    link: '#0b3fd1',
  })}
  position: relative;
  overflow-x: hidden;

  /* A blank disc, half out of the window. */
  &::before {
    content: '';
    position: absolute;
    right: -90px;
    bottom: -110px;
    width: 340px;
    height: 340px;
    border-radius: 50%;
    pointer-events: none;
    background: radial-gradient(
        circle,
        #0a1f6e 0 11%,
        rgba(255, 255, 255, 0.8) 11.5% 15%,
        rgba(255, 255, 255, 0.15) 15.5% 17%,
        transparent 17.5%
      ),
      conic-gradient(#ff8fd6, #ffe27a, #8dffc9, #6ac8ff, #c49bff, #ff8fd6, #ffe27a, #8dffc9, #6ac8ff, #c49bff, #ff8fd6);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7), 0 0 40px rgba(106, 200, 255, 0.5);
  }
  ${Panel} {
    position: relative;
    z-index: 1;
    flex: 0 0 auto;
    max-width: 92%;
    color: #07184a;
    button {
      ${gel('#c8f6ff', '#27b8ff', '#04123a')}
      min-height: 28px;
      padding: 0 ${space[3]};
      cursor: pointer;
    }
  }
`

const page = Pages.uploader
const pageId = page?.id as PageKey

export default function MintPage() {
  const uploadRequest = useLastUploadRequest()

  const [fullscreen, toggleFullscreen] = useFullscreen(pageId)
  const dispatch = useAppDispatch()
  const close = () => {
    if (uploadRequest) {
      dispatch(deleteUploadOrder({ requestFrom: uploadRequest.requestFrom }))
    }

    dispatch(closeWindow({ value: pageId }))
  }

  const minimize = () => dispatch(minimizeWindow({ value: pageId }))

  const finalize = (result: string) =>
    dispatch(finalizeUploadOrder({ requestFrom: uploadRequest?.requestFrom || '', result }))

  return (
    <WindowWrapper skin="upload">
      <TitleBar
        skin="upload"
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          close()
        }}
        fullscreen={fullscreen}
        fullscreenBtn
        onFullscreen={() => toggleFullscreen()}
        minimizeBtn
        onMinimize={(e) => {
          if (e.cancelable) e.stopPropagation()
          minimize()
        }}
      >
        {page?.label}
      </TitleBar>
      <Layout>
        <Panel>
          <ProgressBarUploader request={uploadRequest} onRequest={(value) => finalize(value)} />
        </Panel>
      </Layout>
    </WindowWrapper>
  )
}
