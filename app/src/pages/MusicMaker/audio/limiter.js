/**
 * Linked-stereo brickwall limiter.
 * Lookahead 5 ms, attack 1 ms, release 1.2 s, ceiling 0 dBFS.
 * A final hard clamp is the guarantee that nothing exceeds 0 dB.
 * The live AudioWorklet in public/worklets/limiter.js uses the same constants.
 */

export const LIMITER = {
  lookahead: 0.005,
  attack: 0.001,
  release: 1.2,
  ceiling: 1,
}

export function limitStereo(left, right, sampleRate, opts = {}) {
  const lookahead = opts.lookahead ?? LIMITER.lookahead
  const attack = opts.attack ?? LIMITER.attack
  const release = opts.release ?? LIMITER.release
  const ceiling = opts.ceiling ?? LIMITER.ceiling
  const n = left.length
  const delayN = Math.max(1, Math.round(sampleRate * lookahead))
  const attackCoef = Math.exp(-1 / (attack * sampleRate))
  const releaseCoef = Math.exp(-1 / (release * sampleRate))
  const bufL = new Float32Array(delayN)
  const bufR = new Float32Array(delayN)
  const outL = new Float32Array(n)
  const outR = new Float32Array(n)
  let pos = 0
  let env = 1
  let minEnv = 1
  let max = 0

  for (let i = 0; i < n; i++) {
    const xL = left[i] || 0
    const xR = right ? right[i] || 0 : xL
    const delayedL = bufL[pos]
    const delayedR = bufR[pos]
    bufL[pos] = xL
    bufR[pos] = xR
    pos += 1
    if (pos >= delayN) pos = 0

    const peak = Math.max(Math.abs(xL), Math.abs(xR))
    const desired = peak > ceiling ? ceiling / peak : 1
    const coef = desired < env ? attackCoef : releaseCoef
    env = desired + coef * (env - desired)
    if (env < minEnv) minEnv = env

    let yL = delayedL * env
    let yR = delayedR * env
    if (yL > ceiling) yL = ceiling
    else if (yL < -ceiling) yL = -ceiling
    if (yR > ceiling) yR = ceiling
    else if (yR < -ceiling) yR = -ceiling
    outL[i] = yL
    outR[i] = yR
    const a = Math.max(Math.abs(yL), Math.abs(yR))
    if (a > max) max = a
  }

  return { left: outL, right: outR, max, minEnv }
}

export function limitMono(input, sampleRate, opts) {
  return limitStereo(input, input, sampleRate, opts)
}
