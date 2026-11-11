/**
 * Tells a contract read that got an answer ("no", a revert, nothing there) from one that never got one (RPC down,
 * timeout, rate limit). Only the first is a fact the screen may act on; the second is "couldn't check".
 * No runtime imports, so `node --test` can load it (tests/read-failure.test.mts).
 */

/** viem error names that mean the chain answered: the call reverted, or there is no such function or contract. */
const ANSWERED = new Set([
  'ContractFunctionRevertedError',
  'ContractFunctionZeroDataError',
  'AbiDecodingZeroDataError',
  'AbiDecodingDataSizeTooSmallError',
  'ExecutionRevertedError',
  'RawContractError',
])

/** True when the read failed because the chain said no (revert, no code, no such function), not for lack of a reply. */
export function isRevert(error: unknown): boolean {
  let e: unknown = error
  for (let depth = 0; depth < 10 && e && typeof e === 'object'; depth += 1) {
    const { name, cause } = e as { name?: unknown; cause?: unknown }
    if (typeof name === 'string' && ANSWERED.has(name)) return true
    e = cause
  }
  return false
}

/** One allowFailure read: the value, `null` when the chain answered "no" (revert), `undefined` when unknown. */
export function readOutcome<T>(
  r: { status: string; result?: unknown; error?: unknown } | undefined
): T | null | undefined {
  if (!r) return undefined
  if (r.status === 'success') return r.result as T
  return isRevert(r.error) ? null : undefined
}
