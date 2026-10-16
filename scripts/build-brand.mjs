// Builds the Credrail brand SVGs in public/brand, with the wordmark converted to outlines
// (Inter SemiBold) so the files render identically everywhere, including GitHub.
// Run: npm run brand:build
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'

const require = createRequire(import.meta.url)
const font = opentype.loadSync(require.resolve('@fontsource/inter/files/inter-latin-600-normal.woff'))
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'brand')

const INDIGO = '#4F46E5', INDIGO_DARK = '#8B88FF', INK = '#101828'
const r = n => Math.round(n * 100) / 100

// Full mark (concept A), 48×48 grid
const markPaths = `<path d="M37 13.1A17 17 0 1 0 37 34.9" stroke-width="3.4"/><path d="M31.66 17.57A10 10 0 1 0 31.66 30.43" stroke-width="3.4"/><g stroke-width="2.6"><path d="M14 24H7"/><path d="M16.93 31.07L11.98 36.02"/><path d="M16.93 16.93L11.98 11.98"/><path d="M24 34V41"/><path d="M24 14V7"/></g>`
// Small-size mark: heavier rails, two sleepers (used inside the app icon / favicon)
const smallPaths = `<path d="M37.5 12.5A18 18 0 1 0 37.5 35.5" stroke-width="5.2"/><path d="M31.2 18.2A9 9 0 1 0 31.2 29.8" stroke-width="5.2"/><g stroke-width="4.2"><path d="M17.6 30.4L11.3 36.7"/><path d="M17.6 17.6L11.3 11.3"/></g>`

const g = (paths, color, transform = '') =>
  `<g fill="none" stroke="${color}" stroke-linecap="round"${transform ? ` transform="${transform}"` : ''}>${paths}</g>`

// Wordmark: Inter SemiBold, tracking -0.035em, as a single outlined path
function wordmark(text, fontSize, x, baseline, tracking = -0.035) {
  const scale = fontSize / font.unitsPerEm
  const glyphs = font.stringToGlyphs(text)
  let cursor = x
  const commands = []
  glyphs.forEach((glyph, i) => {
    const p = glyph.getPath(cursor, baseline, fontSize)
    commands.push(p.toPathData(2))
    let adv = glyph.advanceWidth * scale
    if (i < glyphs.length - 1) adv += font.getKerningValue(glyph, glyphs[i + 1]) * scale
    cursor += adv + tracking * fontSize
  })
  const bbox = font.getPath(text, x, baseline, fontSize).getBoundingBox()
  return { d: commands.join(''), width: cursor - x - tracking * fontSize, top: bbox.y1 }
}

const files = {}
files['credrail-mark.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="Credrail">${g(markPaths, INDIGO)}</svg>`
files['credrail-mark-white.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="Credrail">${g(markPaths, '#FFFFFF')}</svg>`
files['credrail-icon.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Credrail"><rect width="64" height="64" rx="15" fill="${INDIGO}"/>${g(smallPaths, '#FFFFFF', 'translate(10 10) scale(0.9167)')}</svg>`

// Lockups: mark 48 tall, wordmark vertically centred on it
const FS = 36
const wm = wordmark('credrail', FS, 0, 0)
const ascent = -wm.top // height above baseline
const baseline = 24 + ascent / 2
const textX = 48 + 12
const W = r(textX + wm.width + 2)
const word = wordmark('credrail', FS, textX, baseline)
for (const [name, markColor, textColor] of [['credrail-logo.svg', INDIGO, INK], ['credrail-logo-dark.svg', INDIGO_DARK, '#FFFFFF']]) {
  files[name] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 48" role="img" aria-label="Credrail">${g(markPaths, markColor)}<path fill="${textColor}" d="${word.d}"/></svg>`
}
files['credrail-wordmark.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(wm.width + 2)} 48"><path fill="${INK}" d="${wordmark('credrail', FS, 0, baseline).d}"/></svg>`

fs.mkdirSync(outDir, { recursive: true })
for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(outDir, n), c + '\n')
console.log(Object.keys(files).map(n => `${n} (${files[n].length} bytes)`).join('\n'))
console.log({ width: W, baseline: r(baseline), ascent: r(ascent) })
