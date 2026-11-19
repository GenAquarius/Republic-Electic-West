// Shared pieces for Alarm Monitoring AI insights: the ask hook, a safe Markdown renderer and the answer card.
import { Fragment, useState } from 'react'
import { BarChart3, Check, ChevronDown, Copy, Database, FileDown, FileText, LayoutList, Printer, Sheet, Sparkles } from 'lucide-react'
import { api } from '../../api'
import { AiVisuals, downloadAllCsv, useVisuals } from './aiVisuals'
import Grid from '../../components/Grid'

const TOOL_LABEL = {
  portfolio_summary: () => 'Portfolio summary',
  portfolio_history: (i) => `Monthly history, ${i.months || 36} months`,
  account_trend: (i) => `${i.metric === 'cancelled' ? 'Cancellations' : 'New accounts'} by ${i.group_by || 'month'}, ${i.from} – ${i.to}${i.monitoring_type ? ` (${i.monitoring_type})` : ''}`,
  cancellation_reasons: (i) => `Cancellation reasons${i.from ? `, ${i.from} – ${i.to || 'today'}` : ''}`,
  renewals_due: (i) => `Renewals due in ${i.days} days${i.include_overdue ? ' + overdue' : ''}`,
  find_accounts: (i) => `Account search${Object.keys(i).length ? ` (${Object.entries(i).filter(([k]) => k !== 'limit' && k !== 'sort').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', ')})` : ''}`,
  revenue_breakdown: (i) => `Revenue by ${String(i.dimension || '').replace(/_/g, ' ')}`,
  data_quality_check: () => 'Data-quality checks',
}
export const sourceLabel = (s) => (TOOL_LABEL[s.tool] ? TOOL_LABEL[s.tool](s.input || {}) : s.tool)

/** POST /am/ai/ask — body is { preset } | { report, params } | { question } */
export function useAiAsk() {
  const [state, setState] = useState({ loading: false, error: '', data: null })
  const ask = async (body) => {
    setState({ loading: true, error: '', data: null })
    try {
      const data = await api('/am/ai/ask', { method: 'POST', body })
      setState({ loading: false, error: '', data: { ...data, at: Date.now() } })
      return data
    } catch (e) {
      setState({ loading: false, error: e.message, data: null })
      return null
    }
  }
  return { ...state, ask, reset: () => setState({ loading: false, error: '', data: null }) }
}

// ---- Minimal, safe Markdown (headings, bullets, numbered lists, tables, bold, italics, code) ----
function inline(text, keyBase) {
  const out = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g
  let last = 0, m, i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out.push(<strong key={`${keyBase}-${i++}`}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={`${keyBase}-${i++}`}>{t.slice(1, -1)}</code>)
    else out.push(<em key={`${keyBase}-${i++}`}>{t.slice(1, -1)}</em>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
const isRow = (l) => /^\s*\|.*\|\s*$/.test(l)
const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

export function Markdown({ text }) {
  const lines = String(text || '').split('\n')
  const blocks = []
  for (let i = 0; i < lines.length;) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    const h = /^(#{1,4})\s+(.*)$/.exec(l)
    if (h) { blocks.push({ t: h[1].length <= 2 ? 'h3' : 'h4', c: h[2] }); i++; continue }
    if (isRow(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(l); const rows = []; i += 2
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]))
      blocks.push({ t: 'table', head, rows }); continue
    }
    if (/^\s*[-*•]\s+/.test(l)) {
      const items = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ''))
      blocks.push({ t: 'ul', items }); continue
    }
    if (/^\s*\d+[.)]\s+/.test(l)) {
      const items = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''))
      blocks.push({ t: 'ol', items }); continue
    }
    const para = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*•]\s|\s*\d+[.)]\s)/.test(lines[i]) && !isRow(lines[i])) para.push(lines[i++])
    blocks.push({ t: 'p', c: para.join(' ') })
  }
  return (
    <div className="ai-md">
      {blocks.map((b, k) => {
        if (b.t === 'h3') return <h3 key={k}>{inline(b.c, k)}</h3>
        if (b.t === 'h4') return <h4 key={k}>{inline(b.c, k)}</h4>
        if (b.t === 'ul') return <ul key={k}>{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ul>
        if (b.t === 'ol') return <ol key={k}>{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ol>
        if (b.t === 'table') {
          return (
            <div key={k} className="ai-table"><Grid className="grid compact">
              <thead><tr>{b.head.map((c, j) => <th key={j}>{inline(c, `${k}-h${j}`)}</th>)}</tr></thead>
              <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${k}-${ri}-${j}`)}</td>)}</tr>)}</tbody>
            </Grid></div>
          )
        }
        return <p key={k}>{inline(b.c, k)}</p>
      })}
    </div>
  )
}

export function AiLoading({ label = 'Analyzing your alarm accounts…' }) {
  return (
    <div className="ai-loading" role="status" aria-live="polite">
      <Sparkles size={16} className="ai-pulse" />
      <div><b>{label}</b><span>Claude is querying the live database and writing the summary. This usually takes 10–40 seconds.</span></div>
    </div>
  )
}

const slug = (t) => String(t || 'ai-insight').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'ai-insight'

export function AiAnswer({ data, title }) {
  const [copied, setCopied] = useState(false)
  const [mode, setMode] = useState('both') // both | summary | visuals
  const [menu, setMenu] = useState(false)
  const visuals = useVisuals(data?.sources, data?.charts)
  if (!data) return null
  const hasVisuals = visuals.kpis.length > 0 || visuals.cards.length > 0 || visuals.aiCharts.length > 0
  const name = slug(title)
  const copy = async () => {
    try { await navigator.clipboard.writeText(data.answer); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }
  const saveMarkdown = () => {
    const src = (data.sources || []).map((s) => `- ${sourceLabel(s)}`).join('\n')
    const md = `# ${title || 'AI insight'}\n\n_Generated ${new Date(data.at || Date.now()).toLocaleString()} by ${data.model} from the live StaffWare database._\n\n${data.answer}\n\n---\n**Data used**\n${src}\n`
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' })); a.download = `${name}.md`; a.click(); URL.revokeObjectURL(a.href)
  }
  const print = () => {
    document.body.classList.add('print-ai')
    const done = () => { document.body.classList.remove('print-ai'); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    setTimeout(() => { window.print(); setTimeout(done, 1000) }, 50)
  }
  const pick = (fn) => () => { setMenu(false); fn() }
  return (
    <article className="ai-answer">
      <header>
        <span className="ai-badge"><Sparkles size={13} /> AI insight</span>
        {title && <h2>{title}</h2>}
        <div className="ai-tools no-print">
          {hasVisuals && (
            <span className="seg dash-seg" role="group" aria-label="Show">
              {[['both', 'Summary + visuals', LayoutList], ['summary', 'Summary', FileText], ['visuals', 'Visuals', BarChart3]].map(([k, l, Icon]) => (
                <button key={k} type="button" className={`seg-btn${mode === k ? ' active' : ''}`} aria-pressed={mode === k} onClick={() => setMode(k)}><Icon size={13} /> {l}</button>
              ))}
            </span>
          )}
          <div className="ai-export">
            <button type="button" className="btn small" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}><FileDown size={14} /> Export <ChevronDown size={13} /></button>
            {menu && (
              <div className="ai-export-menu" role="menu" onMouseLeave={() => setMenu(false)}>
                <button role="menuitem" onClick={pick(copy)}>{copied ? <Check size={14} /> : <Copy size={14} />} Copy summary text</button>
                <button role="menuitem" onClick={pick(saveMarkdown)}><FileText size={14} /> Download report (.md)</button>
                {hasVisuals && <button role="menuitem" onClick={pick(() => downloadAllCsv(visuals, `${name}-data.csv`))}><Sheet size={14} /> Download all data (.csv for Excel)</button>}
                <button role="menuitem" onClick={pick(print)}><Printer size={14} /> Print / Save as PDF</button>
              </div>
            )}
          </div>
        </div>
      </header>
      {mode !== 'visuals' && <Markdown text={data.answer} />}
      {data.truncated && <p className="muted small">The answer was cut short. Ask a narrower question for the rest.</p>}
      {mode !== 'summary' && hasVisuals && <AiVisuals visuals={visuals} />}
      <footer>
        <div className="ai-sources">
          <Database size={13} />
          <span>Data used (live database):</span>
          {data.sources?.length ? data.sources.map((s, i) => <Fragment key={i}><span className="ai-chip">{sourceLabel(s)}</span></Fragment>) : <span className="muted">no queries</span>}
        </div>
        <span className="muted small">Generated {new Date(data.at || Date.now()).toLocaleString()} · {data.model} · Charts and tables show the exact query results; the summary is written by AI and can make mistakes.</span>
      </footer>
    </article>
  )
}
