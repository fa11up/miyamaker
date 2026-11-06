/** A lot's button: Bid while its auction is running, otherwise Open lot. Until the chain answers, `endTime` is 0: Open lot. */
export function lotAction(endTime: number, settled: boolean, nowMs: number): 'Bid' | 'Open lot' {
  return !settled && endTime * 1000 > nowMs ? 'Bid' : 'Open lot'
}
