/**
 * Live brickwall. Same constants as src/audio/limiter.js:
 * lookahead 5 ms, attack 1 ms, release 1.2 s, ceiling 0 dBFS.
 */
class MiyaLimiter extends AudioWorkletProcessor {
  constructor() {
    super()
    const sr = sampleRate
    this.delayN = Math.max(1, Math.round(sr * 0.005))
    this.attackCoef = Math.exp(-1 / (0.001 * sr))
    this.releaseCoef = Math.exp(-1 / (1.2 * sr))
    this.ceiling = 1
    this.bufL = new Float32Array(this.delayN)
    this.bufR = new Float32Array(this.delayN)
    this.pos = 0
    this.env = 1
    this.block = 0
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || !input[0] || !output || !output[0]) return true
    const inL = input[0]
    const inR = input[1] || input[0]
    const outL = output[0]
    const outR = output[1] || output[0]
    const n = inL.length
    let minEnv = 1
    const ceiling = this.ceiling

    for (let i = 0; i < n; i++) {
      const xL = inL[i] || 0
      const xR = inR[i] || 0
      const delayedL = this.bufL[this.pos]
      const delayedR = this.bufR[this.pos]
      this.bufL[this.pos] = xL
      this.bufR[this.pos] = xR
      this.pos += 1
      if (this.pos >= this.delayN) this.pos = 0

      const peak = Math.max(Math.abs(xL), Math.abs(xR))
      const desired = peak > ceiling ? ceiling / peak : 1
      const coef = desired < this.env ? this.attackCoef : this.releaseCoef
      this.env = desired + coef * (this.env - desired)
      if (this.env < minEnv) minEnv = this.env

      let yL = delayedL * this.env
      let yR = delayedR * this.env
      if (yL > ceiling) yL = ceiling
      else if (yL < -ceiling) yL = -ceiling
      if (yR > ceiling) yR = ceiling
      else if (yR < -ceiling) yR = -ceiling
      outL[i] = yL
      if (output[1]) output[1][i] = yR
    }

    this.block += 1
    if (this.block % 8 === 0) {
      const gr = minEnv < 0.999 ? 20 * Math.log10(Math.max(0.0001, minEnv)) : 0
      this.port.postMessage({ gr })
    }
    return true
  }
}

registerProcessor('miya-limiter', MiyaLimiter)
