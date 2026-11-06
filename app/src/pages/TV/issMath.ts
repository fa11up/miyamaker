/**
 * The sums behind the Space Station map, on a sphere and in map degrees (x = longitude, y = -latitude). Pure and free of
 * imports, so `node --test` can load it.
 */
const EARTH_KM = 6371
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180

export type Point = { lat: number; lon: number }

/** Compass bearing from one point to another, 0 to 360, 0 being north. */
export function bearing(from: Point, to: Point): number {
  const dLon = rad(to.lon - from.lon)
  const y = Math.sin(dLon) * Math.cos(rad(to.lat))
  const x =
    Math.cos(rad(from.lat)) * Math.sin(rad(to.lat)) - Math.sin(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.cos(dLon)
  return (deg(Math.atan2(y, x)) + 360) % 360
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
export const compass = (degrees: number) => COMPASS[Math.round(((degrees % 360) + 360) / 45) % 8]!

/** "Southeast · 134°" */
export function headingLabel(degrees: number): string {
  const word = compass(degrees)
  return `${word[0]!.toUpperCase()}${word.slice(1)} · ${Math.round(((degrees % 360) + 360) % 360)}°`
}

/** Where you end up going `km` along a bearing. */
export function destination(from: Point, heading: number, km: number): Point {
  const d = km / EARTH_KM
  const lat1 = rad(from.lat)
  const b = rad(heading)
  const lat = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b))
  const lon =
    rad(from.lon) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat))
  return { lat: deg(lat), lon: wrap(deg(lon)) }
}

/** A line of points as map segments, broken where it crosses the edge of the map instead of streaking across it. */
export function mapSegments(points: Point[]): string[] {
  const segments: string[][] = []
  let current: string[] = []
  points.forEach((p, i) => {
    const before = points[i - 1]
    if (before && Math.abs(p.lon - before.lon) > 180) {
      segments.push(current)
      current = []
    }
    current.push(`${p.lon.toFixed(1)},${(-p.lat).toFixed(1)}`)
  })
  segments.push(current)
  return segments.filter((s) => s.length > 1).map((s) => s.join(' '))
}

/** The circle of ground within sight of a point, as map segments. */
export function viewRing(centre: Point, radiusKm: number): string[] {
  const points = Array.from({ length: 73 }, (_, i) => destination(centre, i * 5, radiusKm))
  return mapSegments(points)
}

/** A fan from the point along its heading, out to the horizon. Unsplit, so it is left out when it crosses the map's edge. */
export function viewFan(centre: Point, heading: number, radiusKm: number, spread = 40): string | undefined {
  const edge = Array.from({ length: 9 }, (_, i) => destination(centre, heading - spread + (i * spread) / 4, radiusKm))
  if (edge.some((p) => Math.abs(p.lon - centre.lon) > 180)) return undefined
  return [centre, ...edge].map((p) => `${p.lon.toFixed(1)},${(-p.lat).toFixed(1)}`).join(' ')
}

/** The part of the map in darkness, from where the sun is overhead. */
export function nightSide(sun: Point): string {
  // Right at the equinox the sum divides by nearly nothing; a hair off it is the same picture.
  const tilt = Math.abs(sun.lat) < 0.5 ? (sun.lat < 0 ? -0.5 : 0.5) : sun.lat
  const line: string[] = []
  for (let lon = -180; lon <= 180; lon += 4) {
    const lat = deg(Math.atan(-Math.cos(rad(lon - sun.lon)) / Math.tan(rad(tilt))))
    line.push(`${lon},${(-lat).toFixed(1)}`)
  }
  // The pole the sun has tilted away from is the dark one.
  const pole = tilt > 0 ? 90 : -90
  return [`-180,${pole}`, ...line, `180,${pole}`].join(' ')
}
