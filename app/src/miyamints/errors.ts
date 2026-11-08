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
  SoldOut: 'There are not enough pieces left to mint that many.',
  PhaseSoldOut: 'This sale phase does not have that many pieces left.',
  ReserveExceeded: 'That is more than the pieces you have left from what you kept back at launch.',
  NotFactory: 'This factory is not registered with miya on this network.',
  // Multi-token sales (PaymentLib)
  ExceedsMaxCost: 'The price went up since this screen read it. Look at the new price and try again.',
  TokenNotPriced: 'This sale does not take that token. Pick another one.',
  TokenNotAccepted: 'This collection does not take that token. Pick another one.',
  TokenNotAllowed: 'miya does not accept that token right now. Pick another one.',
  WrongPayment: 'The amount sent did not match the price. Nothing was charged. Try again.',
  WrongValue: 'The amount sent did not match. Nothing was charged. Try again.',
  ShortTransfer: 'Less of the token arrived than was sent, so the contract refused it.',
  NothingParked: 'There is nothing waiting to be sent for that token.',
  NothingToWithdraw: 'There is nothing to withdraw yet.',
  NoFeesToClaim: 'There are no vault fees to claim yet.',
  NothingToRefund: 'There is no refund waiting for this wallet.',
  NoTokens: 'Pick at least one token buyers can pay with.',
  TooManyTokens: 'Too many tokens: a collection can take at most 8.',
  DuplicateToken: 'The same token is listed twice.',
  // MiyaPool / MiyaPoolFactory (Trade → NFTs)
  NotHeld: 'That NFT is no longer in the pool. Someone may have just taken it. Pick another.',
  InsufficientHeld: 'The pool does not have that many NFTs free right now.',
  // Raised by MiyaPool (pool tokens) and by ERC1155Instance.withdraw (nothing owed in that token).
  InsufficientBalance: 'Not enough balance for that: no pool tokens to spend, or nothing to withdraw in that token.',
  TooEarly: 'Too early: wait one more block, then reveal.',
  UnknownCommit: 'That draw was already revealed.',
  NotNextCommit: 'Draws settle in order, and an earlier draw is still open.',
  CommitTooLarge: 'A draw can take at most 50 NFTs.',
  InvalidRecipient: 'That wallet address cannot receive this draw.',
  NotEscrowed: 'That NFT is not being held for this wallet.',
  AlreadyHeld: 'The pool already holds that NFT.',
  RevealGasTooLow: 'The wallet set the network fee limit too low for this reveal. Raise it and try again.',
  SettlementGasTooLow: 'The wallet set the network fee limit too low to settle this auction. Raise it and try again.',
  WrongMode: 'This pool does not work that way. Reload the pool.',
  TransferNotReceived: 'The NFT did not arrive in the pool.',
  PoolExists: 'A pool for this collection and mode already exists.',
  UnsupportedCollection: 'That address is not an ERC-721 or ERC-1155 collection.',
  RandomRequiresERC721: 'Random pools work only for ERC-721 collections.',
}

/** The contract's own error name in a viem error (`ExceedsMaxCost`), or undefined. */
export function revertName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null
  return revert?.data?.errorName
}

/**
 * A wallet / contract error as one plain sentence. One we can't read may come after the transaction was sent, so it
 * can't promise nothing moved: only the wallet's activity can say.
 */
const TX_GENERIC_WORDS = "That did not go through. Check your wallet's activity, then try again."

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

    // Anything else viem says is for developers: it can name functions and quote calldata.
    return TX_GENERIC_WORDS
  }

  return (error as Error)?.message || 'Something went wrong.'
}

/** For a step that may already have spent something, where only the wallet's activity can say what went through. */
export const TX_RETRY_WORDS = TX_GENERIC_WORDS
/** For a dry run: nothing was sent. */
export const TX_CHECK_WORDS = 'That did not go through. Nothing was charged for this step. Try again.'

const REJECTED = /user rejected|user denied|rejected the request|denied transaction/i
const DEVELOPER_TEXT = /0x[0-9a-f]{8}|revert|viem|contract function|execution|rpc|version:|failed to fetch|\n/i

/**
 * describeError for the creator windows, where real money moves: a sentence written for people when there is one, and
 * `fallback` in place of anything a library or contract wrote for developers.
 */
export function plainTxError(error: unknown, fallback: string = TX_RETRY_WORDS): string {
  if (!error) return ''
  const words = describeError(error)
  if (error instanceof BaseError) {
    // Not the generic line: here a step may already have spent something, so "nothing moved" could be untrue.
    return words === TX_GENERIC_WORDS || words === error.shortMessage || words.startsWith('The contract said no')
      ? fallback
      : words
  }

  if (REJECTED.test(words)) return 'You cancelled in your wallet.'
  return DEVELOPER_TEXT.test(words) || words.length > 200 ? fallback : words
}
