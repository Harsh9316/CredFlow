// Credrail brand mark. Paths match public/brand (see docs/BRAND.md).

const MARK = (
  <>
    <path d="M37 13.1A17 17 0 1 0 37 34.9" strokeWidth="3.4" />
    <path d="M31.66 17.57A10 10 0 1 0 31.66 30.43" strokeWidth="3.4" />
    <g strokeWidth="2.6">
      <path d="M14 24H7" />
      <path d="M16.93 31.07L11.98 36.02" />
      <path d="M16.93 16.93L11.98 11.98" />
      <path d="M24 34V41" />
      <path d="M24 14V7" />
    </g>
  </>
)

// Heavier version for small sizes (inside the app icon / favicon)
const SMALL_MARK = (
  <>
    <path d="M37.5 12.5A18 18 0 1 0 37.5 35.5" strokeWidth="5.2" />
    <path d="M31.2 18.2A9 9 0 1 0 31.2 29.8" strokeWidth="5.2" />
    <g strokeWidth="4.2">
      <path d="M17.6 30.4L11.3 36.7" />
      <path d="M17.6 17.6L11.3 11.3" />
    </g>
  </>
)

/** The rail-C mark in the current text colour. */
export function LogoMark({ size = 32, small = false, className }: { size?: number; small?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden className={className}>
      {small ? SMALL_MARK : MARK}
    </svg>
  )
}

/** App-icon style: the mark in white on an indigo rounded square. */
export function LogoIcon({ size = 32 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }} aria-hidden>
      <LogoMark size={Math.round(size * 0.74)} small={size < 40} />
    </span>
  )
}

/** Icon + "credrail" wordmark. */
export function Logo({ size = 32, inverse = false }: { size?: number; inverse?: boolean }) {
  return (
    <span className="logo" aria-label="Credrail">
      <LogoIcon size={size} />
      <span className="logo-word" style={{ fontSize: Math.round(size * 0.62), color: inverse ? '#fff' : undefined }}>credrail</span>
    </span>
  )
}
