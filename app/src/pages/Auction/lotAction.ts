/** A lot's button: Bid while its auction is running, otherwise View. Until the chain answers, `endTime` is 0: View. */
export function lotAction(endTime: number, settled: boolean, nowMs: number): 'Bid' | 'View' {
  return !settled && endTime * 1000 > nowMs ? 'Bid' : 'View'
}
