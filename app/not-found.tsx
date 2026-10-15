import Link from 'next/link'
import { FileQuestion } from 'lucide-react'

export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="empty" style={{ maxWidth: 420 }}>
        <div className="empty-icon"><FileQuestion size={20} aria-hidden /></div>
        <h1 className="page-title" style={{ fontSize: 20 }}>Page not found</h1>
        <p className="muted">It may have been removed, or it belongs to a different NBFC.</p>
        <Link href="/dashboard" className="btn btn-primary mt-4">Back to overview</Link>
      </div>
    </main>
  )
}
