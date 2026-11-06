import { WAVE_VS, waveFs } from './shader'

/**
 * Minimal WebGL 1 renderer for the wave. Replaces shadertoy-react, which (a) threw when
 * getContext() returned null, taking the whole desktop down on browsers with WebGL off (Safari
 * Lockdown Mode, Firefox with webgl.disabled / resistFingerprinting, blocklisted GPUs), (b) never
 * checked shader/program status, (c) ignored context loss (iOS drops GL contexts under memory
 * pressure; the wave then stayed blank until reload), and (d) assumed WEBGL_lose_context on unmount.
 *
 * Every failure returns `null` / reports `lost`, and the caller falls back to the CSS wave.
 */
export interface WaveRenderer {
  highp: boolean
  /** set drawing-buffer size from CSS size; returns the px-per-CSS-px scale in use */
  resize(cssW: number, cssH: number): number
  draw(t: number, gain: number): void
  dispose(): void
}

/** Drawing-buffer scale. The shader is ~150 ALU ops x 15 steps per pixel: half resolution, like before. */
const SCALE = 0.5
const MAX_SIDE = 2048

export function createWaveRenderer(canvas: HTMLCanvasElement): WaveRenderer | null {
  let gl: WebGLRenderingContext | null = null
  try {
    const attrs: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    }
    gl = (canvas.getContext('webgl', attrs) ||
      canvas.getContext('experimental-webgl', attrs)) as WebGLRenderingContext | null
  } catch {
    gl = null
  }

  if (!gl || gl.isContextLost()) return null

  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)
  const highp = !!hp && hp.precision > 0

  const compile = (type: number, src: string) => {
    const sh = gl!.createShader(type)
    if (!sh) return null
    gl!.shaderSource(sh, src)
    gl!.compileShader(sh)
    if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS) && !gl!.isContextLost()) {
      console.warn('[wave] shader compile failed:', gl!.getShaderInfoLog(sh))
      gl!.deleteShader(sh)
      return null
    }

    return sh
  }

  const vs = compile(gl.VERTEX_SHADER, WAVE_VS)
  const fs = compile(gl.FRAGMENT_SHADER, waveFs(highp ? 'highp' : 'mediump'))
  const program = gl.createProgram()
  if (!vs || !fs || !program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[wave] program link failed:', gl.getProgramInfoLog(program))
    return null
  }

  gl.useProgram(program)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(program, 'aPos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  const u = {
    time: gl.getUniformLocation(program, 'uTime'),
    res: gl.getUniformLocation(program, 'uResolution'),
    scale: gl.getUniformLocation(program, 'uScale'),
    gain: gl.getUniformLocation(program, 'uGain'),
  }

  const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null
  const maxSide = Math.min(MAX_SIDE, dims?.[0] || MAX_SIDE, dims?.[1] || MAX_SIDE)
  let scale = SCALE

  return {
    highp,
    resize(cssW, cssH) {
      // keep the buffer inside the GPU's limits on huge / ultra-wide screens
      scale = Math.min(SCALE, maxSide / Math.max(1, cssW), maxSide / Math.max(1, cssH))
      const w = Math.max(1, Math.round(cssW * scale))
      const h = Math.max(1, Math.round(cssH * scale))
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      return scale
    },
    draw(t, gain) {
      const g = gl!
      if (g.isContextLost()) return
      g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight)
      g.uniform1f(u.time, t)
      g.uniform2f(u.res, g.drawingBufferWidth, g.drawingBufferHeight)
      // drawingBuffer may be smaller than asked for: derive the real scale from it
      g.uniform1f(u.scale, g.drawingBufferWidth / Math.max(1, canvas.clientWidth || g.drawingBufferWidth / scale))
      g.uniform1f(u.gain, gain)
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
    },
    dispose() {
      const g = gl!
      try {
        g.deleteBuffer(buffer)
        g.deleteProgram(program)
        g.deleteShader(vs)
        g.deleteShader(fs)
        // free the context now instead of waiting for GC (browsers cap live contexts at ~16)
        g.getExtension('WEBGL_lose_context')?.loseContext()
      } catch {
        /* already gone */
      }
    },
  }
}
