import { memo } from 'react'

/**
 * PfpEngine window: embeds the Miya PFP Engine as an iframe.
 * The pfp engine is a self-contained HTML app served from the public assets.
 */
export default memo(function PfpEngine() {
  return (
    <iframe
      src="/apps/pfp-engine/"
      title="Miya PFP Engine"
      style={{
        width: '100%',
        height: '100%',
        border: 0,
        overflow: 'hidden',
      }}
      sandbox=""
    />
  )
})
