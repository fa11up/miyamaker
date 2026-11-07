/** What a first-time collector needs before the mint button means anything. Shown until a wallet is connected. */
export default function MintNeeds({ chainName = 'Ethereum' }: { chainName?: string }) {
  return (
    <div>
      <strong>What you need</strong>
      <ol>
        <li>A crypto wallet, like MetaMask or Rabby. Your NFT is kept there.</li>
        <li>
          ETH on {chainName} for the price, plus a little extra for gas: the small fee the network charges to record
          your mint.
        </li>
      </ol>
    </div>
  )
}
