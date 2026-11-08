import type { Material, Mesh, Object3D } from 'three'
import { Texture } from 'three'

/**
 * Frees what a built part of the scene holds on the GPU: every geometry, and every material not in `keep` along with each
 * texture it uses. Shared materials are reused by the next build, so a rebuild keeps them.
 */
export function release(root: Object3D, keep: ReadonlySet<Material> = new Set()) {
  const done = new Set<Material>()
  root.traverse((o) => {
    const m = o as Mesh
    if (m.geometry) m.geometry.dispose()
    if (!m.material) return
    ;(Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => {
      if (keep.has(mat) || done.has(mat)) return
      done.add(mat)
      Object.values(mat).forEach((v) => {
        if (v instanceof Texture) v.dispose()
      })
      mat.dispose()
    })
  })
}
