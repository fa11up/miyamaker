/**
 * My Files' backdrop, in the spirit of late-90s cyberpunk anime: dusk over a quiet street, utility poles, wires that
 * run off the edge of the frame. Our own drawing, as an inline SVG, so it costs nothing to load.
 */
const pole = (x: number, h: number) => `
  <rect x="${x}" y="${600 - h}" width="9" height="${h}" fill="#07040c"/>
  <rect x="${x - 34}" y="${618 - h}" width="77" height="6" fill="#07040c"/>
  <rect x="${x - 24}" y="${640 - h}" width="57" height="5" fill="#07040c"/>
  <rect x="${x + 9}" y="${668 - h}" width="15" height="24" rx="3" fill="#07040c"/>`

const wire = (y1: number, y2: number, sag: number, w = 1.6) =>
  `<path d="M-20 ${y1} Q 300 ${(y1 + y2) / 2 + sag} 1020 ${y2}" stroke="#07040c" stroke-width="${w}" fill="none"/>`

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" preserveAspectRatio="xMaxYMax slice">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#160b26"/><stop offset=".5" stop-color="#3a1a3e"/>
      <stop offset=".78" stop-color="#8a3a44"/><stop offset="1" stop-color="#d98a5c"/>
    </linearGradient>
    <radialGradient id="stain"><stop offset="0" stop-color="#e0102e" stop-opacity=".8"/>
      <stop offset=".55" stop-color="#8c0a2a" stop-opacity=".55"/><stop offset="1" stop-color="#8c0a2a" stop-opacity="0"/></radialGradient>
    <pattern id="scan" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity=".3"/></pattern>
  </defs>
  <rect width="1000" height="600" fill="url(#sky)"/>
  ${wire(120, 210, 90)}${wire(150, 240, 96)}${wire(182, 268, 102, 2.2)}${wire(60, 330, 60, 1.2)}
  ${pole(150, 500)}${pole(760, 430)}
  <path d="M0 600V520l90-14 60 20 110-34 120 30 90-18 150 26 120-30 130 22 130-12v90z" fill="#0c0612"/>
  <rect x="300" y="520" width="16" height="10" fill="#ffd27a" opacity=".55"/>
  <rect x="610" y="534" width="12" height="9" fill="#9fe8c8" opacity=".35"/>
  <ellipse cx="500" cy="595" rx="520" ry="46" fill="#0c0612"/>
  <g>
    <ellipse cx="240" cy="572" rx="16" ry="6" fill="url(#stain)"/>
    <ellipse cx="520" cy="584" rx="30" ry="10" fill="url(#stain)"/>
    <ellipse cx="438" cy="566" rx="13" ry="5" fill="url(#stain)"/>
    <ellipse cx="830" cy="578" rx="22" ry="8" fill="url(#stain)"/>
  </g>
  <text x="968" y="38" text-anchor="end" font-family="monospace" font-size="13" letter-spacing="3" fill="#a8e8c0" opacity=".55">PRESENT DAY</text>
  <text x="968" y="58" text-anchor="end" font-family="monospace" font-size="13" letter-spacing="3" fill="#a8e8c0" opacity=".55">PRESENT TIME</text>
  <rect width="1000" height="600" fill="url(#scan)"/>
</svg>`

export const WIRED_BACKDROP = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
