// Alarm Monitoring · AI insights: one-click insight reports and free questions, answered by Claude from the live database.
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BarChart3, LineChart as LineChartIcon, CalendarClock, DollarSign, KeyRound, Send, ShieldCheck, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import { api } from '../../api'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui'
import AmTabs from './AmTabs'
import { AiAnswer, AiLoading, useAiAsk } from './aiShared'

const PRESETS = [
  { key: 'overview', label: 'Portfolio overview', icon: BarChart3, text: 'Size, revenue, mix and 3-year trend, with risks and opportunities' },
  { key: 'renewals', label: 'Renewal priorities', icon: CalendarClock, text: 'Renewals due in 90 days and overdue, ranked by value' },
  { key: 'churn', label: 'Cancellation analysis', icon: TrendingDown, text: 'Churn by year, reason and monitoring type, revenue lost' },
  { key: 'growth', label: 'Growth trend', icon: TrendingUp, text: 'New accounts and revenue added over 5 years' },
  { key: 'trends', label: 'Trends dashboard', icon: LineChartIcon, text: 'Month-by-month accounts, MRR, new vs cancelled, by type' },
  { key: 'revenue', label: 'Revenue breakdown', icon: DollarSign, text: 'MRR by type, terms, city and salesperson; concentration' },
  { key: 'quality', label: 'Data-quality check', icon: ShieldCheck, text: 'Missing or inconsistent account data to fix first' },
]
const EXAMPLES = [
  'Which 10 active accounts pay the most per month?',
  'How many accounts did we lose in 2025 and why?',
  'Which cities have the most active accounts and revenue?',
  'List active accounts in Lodi with no renewal date',
]

export default function AmInsights() {
  const [status, setStatus] = useState(null)
  const [statusErr, setStatusErr] = useState('')
  const [q, setQ] = useState('')
  const [title, setTitle] = useState('')
  const ai = useAiAsk()
  const resultRef = useRef(null)

  useEffect(() => { api('/am/ai/status').then(setStatus).catch((e) => setStatusErr(e.message)) }, [])
  useEffect(() => { if (ai.data) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [ai.data])

  const inputRef = useRef(null)
  const [pickedLabel, setPickedLabel] = useState('') // label of the report/example whose prompt is in the box
  const presetText = (key) => status?.presets?.find((p) => p.key === key)?.text || ''
  // Clicking an example or an insight report only fills the question box; the user edits it if needed and presses Ask.
  const fill = (text, label) => {
    setQ(text); setPickedLabel(label)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } }, 50)
  }
  const submit = (e) => {
    e.preventDefault()
    const question = q.trim()
    if (question.length < 3 || ai.loading) return
    setTitle(pickedLabel && q === pickedLabel.text ? pickedLabel.label : question)
    ai.ask({ question })
  }

  return (
    <div className="page am-ai">
      <PageHeader title="AI insights" subtitle="Ask about your alarm monitoring accounts. Answers come from the live database." />
      <AmTabs />

      {statusErr && <ErrorState message={statusErr} />}
      {!status && !statusErr && <Skeleton h={120} />}
      {status && !status.configured && (
        <EmptyState icon={KeyRound} title="AI insights are not set up yet">
          An administrator needs to add an Anthropic API key to <code>server/.env</code> as <code>ANTHROPIC_API_KEY</code> and restart the server.
          The insights then use {status.model} and read only account numbers, names, cities, types, contract values and dates (never phone numbers, emails, addresses or passcodes).
        </EmptyState>
      )}

      {status?.configured && (
        <>
          <section className="card ai-ask">
            <form onSubmit={submit} className="ai-ask-form">
              <Sparkles size={18} className="ai-ask-icon" aria-hidden="true" />
              <textarea ref={inputRef} value={q} rows={q.length > 90 ? 3 : 1} onChange={(e) => setQ(e.target.value)} maxLength={600} disabled={ai.loading}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e) }}
                placeholder="Ask a question, e.g. Which accounts renew next month and what are they worth?" aria-label="Ask a question about alarm accounts" />
              <button className="btn primary" disabled={ai.loading || q.trim().length < 3}><Send size={15} /> Ask</button>
            </form>
            <div className="ai-examples">
              <span className="muted small">Click an example or an insight report below to put it in the box, edit it if you like, then press Ask (or Enter).</span>
            </div>
            <div className="ai-examples">
              <span className="muted small">Try:</span>
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="ai-chip btn-chip" disabled={ai.loading} onClick={() => fill(ex, { label: ex, text: ex })} title="Put this question in the box">{ex}</button>
              ))}
            </div>
          </section>

          <h2 className="ai-section-title">Insight reports</h2>
          <div className="ai-presets">
            {PRESETS.map((p) => {
              const Icon = p.icon
              return (
                <button key={p.key} type="button" className={`ai-preset${pickedLabel?.label === p.label && q === pickedLabel.text ? ' picked' : ''}`} disabled={ai.loading || !presetText(p.key)}
                  onClick={() => fill(presetText(p.key), { label: p.label, text: presetText(p.key) })} title="Put this report's question in the box, then press Ask">
                  <span className="ai-preset-icon"><Icon size={17} /></span>
                  <span className="ai-preset-label">{p.label}</span>
                  <span className="ai-preset-text">{p.text}</span>
                </button>
              )
            })}
          </div>

          <div ref={resultRef} className="ai-result">
            {ai.loading && <AiLoading label={`Working on: ${title}`} />}
            {ai.error && <div className="error-state" role="alert"><AlertTriangle size={16} /><span>{ai.error}</span></div>}
            {ai.data && <AiAnswer data={ai.data} title={title} />}
          </div>
        </>
      )}
    </div>
  )
}
