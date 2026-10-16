import { ImageResponse } from 'next/og'

// Home-screen icon for iOS (180×180). iOS applies its own rounded mask, so this is full-bleed.
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#4F46E5' }}>
        <svg width="124" height="124" viewBox="0 0 48 48" fill="none" stroke="#FFFFFF" strokeLinecap="round">
          <path d="M37 13.1A17 17 0 1 0 37 34.9" strokeWidth="3.4" />
          <path d="M31.66 17.57A10 10 0 1 0 31.66 30.43" strokeWidth="3.4" />
          <path d="M14 24H7" strokeWidth="2.6" />
          <path d="M16.93 31.07L11.98 36.02" strokeWidth="2.6" />
          <path d="M16.93 16.93L11.98 11.98" strokeWidth="2.6" />
          <path d="M24 34V41" strokeWidth="2.6" />
          <path d="M24 14V7" strokeWidth="2.6" />
        </svg>
      </div>
    ),
    size
  )
}
