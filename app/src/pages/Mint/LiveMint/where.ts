/**
 * Where a finished mint went, in plain words. No imports, so `node --test` can load it (tests/live-mint-where.test.mts).
 * `sentTo` is the address the signed mintTo call named (undefined for a plain mint, which goes to the minter).
 */
export function mintedWhere(sentTo: string | undefined, account: string | undefined): string {
  if (!sentTo || (account && sentTo.toLowerCase() === account.toLowerCase())) return 'It is in your wallet.'
  return `It went to ${sentTo.slice(0, 6)}…${sentTo.slice(-4)}.`
}
