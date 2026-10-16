import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

// Link-preview card (also used as the GitHub social preview: docs/assets/social-preview.png)
export const alt = 'Credrail: open-source, explainable credit underwriting for NBFCs'
export const size = { width: 1280, height: 640 }
export const contentType = 'image/png'

export default async function OpenGraphImage() {
  const logo = await readFile(join(process.cwd(), 'public/brand/credrail-logo-dark.svg'))
  const logoSrc = `data:image/svg+xml;base64,${logo.toString('base64')}`
  const fontFile = (weight: number) => readFile(join(process.cwd(), `node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff`))
  const [regular, semibold] = await Promise.all([fontFile(400), fontFile(600)])

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '88px 96px', background: '#0F1222', color: '#E7E9F3', fontFamily: 'Inter' }}>
        <img src={logoSrc} height={84} width={326} alt="" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 64, fontWeight: 600, color: '#FFFFFF', letterSpacing: '-0.03em', lineHeight: 1.1, maxWidth: 980 }}>
            Explainable credit underwriting for NBFCs
          </div>
          <div style={{ fontSize: 30, color: '#A9AEC4', maxWidth: 1000, lineHeight: 1.35 }}>
            Fraud checks, a cash-flow scorecard and loan sizing, run under your own versioned credit policy. Open source.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 24, color: '#8E93AB' }}>
          <span>Policy as code</span><span>·</span><span>Maker-checker</span><span>·</span><span>REST API + webhooks</span><span>·</span><span>Apache-2.0</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Inter', data: regular, weight: 400, style: 'normal' },
        { name: 'Inter', data: semibold, weight: 600, style: 'normal' },
      ],
    }
  )
}
