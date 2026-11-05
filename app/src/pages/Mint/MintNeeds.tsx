import styled from 'styled-components/macro'

import { bevel, color, space, text } from '@/theme/tokens'

const Box = styled.div`
  padding: ${space[2]} ${space[3]};
  background: ${color.faceLight};
  box-shadow: ${bevel.sunken};
  font-size: ${text.sm};
  line-height: 1.45;
  text-align: left;
  strong {
    display: block;
    margin-bottom: ${space[1]};
  }
  ol {
    margin: 0;
    padding-left: 1.4em;
  }
`

/** What a first-time collector needs before the mint button means anything. Shown until a wallet is connected. */
export default function MintNeeds({ chainName = 'Ethereum' }: { chainName?: string }) {
  return (
    <Box>
      <strong>What you need</strong>
      <ol>
        <li>A crypto wallet, like MetaMask or Rabby. Your NFT is kept there.</li>
        <li>
          ETH on {chainName} for the price, plus a little extra for gas: the small fee the network charges to record
          your mint.
        </li>
      </ol>
    </Box>
  )
}
