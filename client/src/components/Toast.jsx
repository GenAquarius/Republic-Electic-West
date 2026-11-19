// App-wide notifications: call toast('Account created') from anywhere; <Toaster /> (in Layout) shows them top-right.
// They survive page navigation (e.g. "created" then redirect to the new record) and disappear after a few seconds.
import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'

const EVT = 'sw-toast'
let seq = 0
export function toast(message, tone = 'success') {
  window.dispatchEvent(new CustomEvent(EVT, { detail: { id: ++seq, message, tone } }))
}

export function Toaster() {
  const [items, setItems] = useState([])
  useEffect(() => {
    const on = (e) => {
      const t = e.detail
      setItems((s) => [...s.slice(-3), t])
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), t.tone === 'error' ? 7000 : 4500)
    }
    window.addEventListener(EVT, on)
    return () => window.removeEventListener(EVT, on)
  }, [])
  if (!items.length) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.tone === 'error' ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
          <span>{t.message}</span>
          <button type="button" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} aria-label="Dismiss"><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}
