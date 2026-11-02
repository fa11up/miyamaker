import { BaseError, ContractFunctionRevertedError } from 'viem'

const FRIENDLY: Record<string, string> = {
  InvalidVault: 'That vault is not registered with miya. Pick the default vault or another registered one.',
  InvalidAlignment: 'The alignment share is below the minimum or too high.',
  InvalidParams: 'Some settings were rejected. Check supply, dates and the ticker.',
  InvalidName: 'The collection needs a name.',
  InvalidSymbol: 'The collection needs a ticker.',
  NotCreator: 'The connected wallet must be the creator.',
  DepositRequired: 'The starting bid must be more than 0.',
  InvalidPrice: 'The edition price must be more than 0.',
  Unauthorized: 'Only the collection owner can do that.',
  NotFactory: 'This factory is not registered with miya on this network.',
  // MiyaPool / MiyaPoolFactory (Trade → NFTs)
  NotHeld: 'That NFT is no longer in the pool. Someone may have just taken it. Pick another.',
  InsufficientHeld: 'The pool does not have that many NFTs free right now.',
  InsufficientBalance: 'Not enough pool tokens in this wallet.',
  TooEarly: 'Too early: wait one more block, then reveal.',
  UnknownCommit: 'That draw was already revealed.',
  WrongMode: 'This pool does not work that way. Reload the pool.',
  TransferNotReceived: 'The NFT did not arrive in the pool.',
  PoolExists: 'A pool for this collection and mode already exists.',
  UnsupportedCollection: 'That address is not an ERC-721 or ERC-1155 collection.',
  RandomRequiresERC721: 'Random pools work only for ERC-721 collections.',
}

/** A wallet / contract error as one plain sentence. */
export function describeError(error: unknown): string {
  if (!error) return ''
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null
    const name = revert?.data?.errorName
    if (name && FRIENDLY[name]) return FRIENDLY[name] as string
    if (/reject|denied|cancel/i.test(`${error.details} ${error.shortMessage}`)) return 'You cancelled in your wallet.'
    if (/insufficient funds/i.test(`${error.details} ${error.shortMessage}`)) {
      return 'Not enough ETH in this wallet to pay for the network fee.'
    }

    return name ? `The contract said no (${name}).` : error.shortMessage
  }

  return (error as Error)?.message || 'Something went wrong.'
}
