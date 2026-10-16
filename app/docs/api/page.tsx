import Script from 'next/script'

export const metadata = { title: 'Credrail API Reference' }

// Interactive reference rendered by Scalar from /api/v1/openapi.json
export default function ApiDocsPage() {
  return (
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      <script id="api-reference" data-url="/api/v1/openapi.json" />
      <Script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.74.0" strategy="afterInteractive" />
    </div>
  )
}
