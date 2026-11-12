/**
 * What a first-time collector needs before the mint button means anything. Shown until a wallet is connected.
 * `paySymbol` is the token the price is paid in (ETH when unset); `free` drops the price, leaving only gas.
 */
export default function MintNeeds({
  chainName = 'Ethereum',
  paySymbol = 'ETH',
  free = false,
}: {
  chainName?: string
  paySymbol?: string
  free?: boolean
}) {
  const gas = 'the small fee the network charges to record your mint'
  return (
    <div>
      <strong>What you need</strong>
      <ol>
        <li>A crypto wallet, like MetaMask or Rabby. Your NFT is kept there.</li>
        {free ? (
          <li>
            A little ETH on {chainName} for gas: {gas}. The piece itself is free.
          </li>
        ) : paySymbol === 'ETH' ? (
          <li>
            ETH on {chainName} for the price, plus a little extra for gas: {gas}.
          </li>
        ) : (
          <li>
            {paySymbol} on {chainName} for the price, and a little ETH for gas: {gas}.
          </li>
        )}
      </ol>
    </div>
  )
}
