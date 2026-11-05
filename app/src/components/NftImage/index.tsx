import type { CSSProperties } from 'react'
import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components/macro'

import { color } from '@/theme/tokens'
import { thumbFor } from '@/utils/artThumbs'
import { gatewayUrls, ipfsPath } from '@/utils/ipfsGateways'
import { IPFS_GATEWAYS } from '@/utils/nftMetadata'
import { resolveUri } from '@/utils/resolveUri'

/**
 * An NFT image that loads fast and never shows a broken icon:
 * - fixed aspect box, so nothing jumps while it loads;
 * - a bundled thumbnail (if we have one) or a dithered placeholder underneath, blurred until the real image lands;
 * - `variant="thumb"` shows only the bundled thumbnail when there is one (lists: no multi-MB download at all);
 * - lazy + async decoding; IPFS images retry on the next gateway when one fails;
 * - IPFS images load with CORS so the service worker can cache them (opaque responses are not cached).
 */
const Box = styled.div<{ $fit: 'cover' | 'contain' }>`
  position: relative;
  overflow: hidden;
  width: 100%;
  background-color: ${color.light};
  background-image: linear-gradient(
      45deg,
      ${color.faceLight} 25%,
      transparent 25%,
      transparent 75%,
      ${color.faceLight} 75%
    ),
    linear-gradient(45deg, ${color.faceLight} 25%, transparent 25%, transparent 75%, ${color.faceLight} 75%);
  background-size: 8px 8px;
  background-position: 0 0, 4px 4px;

  /* Once the picture is in, drop the dither so letterboxed (contain) images sit on their frame's own colour. */
  &[data-ready='true'] {
    background: none;
  }

  > img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    margin: 0;
    border: none;
    object-fit: ${({ $fit }) => $fit};
    image-rendering: auto;
  }
  > img:hover {
    border: none;
  }
  > img.placeholder {
    filter: blur(6px);
    transform: scale(1.04);
  }
  > img.main {
    opacity: 0;
    transition: opacity 240ms ease-out;
  }
  > img.main.ready {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    > img.main {
      transition: none;
    }
  }
`

const Missing = styled.span`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  text-align: center;
  font-size: 12px;
  color: ${color.inkMuted};
`

export function imageCandidates(src: string | undefined): string[] {
  if (!src) return []
  if (/^data:image\//i.test(src.trim())) return [src.trim()]
  if (/^ar:\/\//i.test(src.trim())) return [resolveUri(src)]
  return gatewayUrls(src, IPFS_GATEWAYS)
}

export default function NftImage({
  src,
  alt,
  variant = 'full',
  aspect = '1 / 1',
  fit = 'cover',
  eager = false,
  fallback,
  className,
  style,
}: {
  src: string | undefined
  alt: string
  /** 'thumb' = bundled thumbnail only when we have one; 'full' = thumbnail as placeholder, then the original. */
  variant?: 'thumb' | 'full'
  /** CSS aspect-ratio of the box; pass 'auto' with an explicit height in style to size it yourself. */
  aspect?: string
  fit?: 'cover' | 'contain'
  eager?: boolean
  /** Shown when there is no image or every source failed. */
  fallback?: string
  className?: string
  style?: CSSProperties
}) {
  const thumb = thumbFor(src)
  const candidates = useMemo(() => imageCandidates(src), [src])
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setAttempt(0)
    setReady(false)
  }, [src])

  const thumbOnly = variant === 'thumb' && !!thumb
  const current = thumbOnly ? thumb : candidates[attempt]
  const failed = !current && attempt >= candidates.length
  const isIpfs = !!ipfsPath(current)

  return (
    <Box $fit={fit} className={className} data-ready={ready} style={{ aspectRatio: aspect, ...style }}>
      {!thumbOnly && thumb && !ready && <img className="placeholder" src={thumb} alt="" aria-hidden decoding="async" />}
      {current ? (
        <img
          key={current}
          className={`main${ready || thumbOnly ? ' ready' : ''}`}
          src={current}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          crossOrigin={isIpfs ? 'anonymous' : undefined}
          onLoad={() => setReady(true)}
          onError={() => {
            setReady(false)
            setAttempt((a) => a + 1)
          }}
        />
      ) : failed && fallback ? (
        <img className="main ready" src={fallback} alt={alt} style={{ opacity: 0.6 }} />
      ) : failed ? (
        <Missing>{src ? 'Image unavailable' : 'No image yet'}</Missing>
      ) : null}
    </Box>
  )
}

/** Warms the browser (and service worker) cache for images the viewer is likely to show next. */
export function prefetchImages(srcs: (string | undefined)[]) {
  srcs.forEach((s) => {
    const url = imageCandidates(s)[0]
    if (!url) return
    const img = new Image()
    if (ipfsPath(url)) img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.src = url
  })
}
