// Visual report for an AI answer: KPI tiles, charts, tables and lists drawn from the exact data the AI's queries
// returned (answer.sources[].data), never from the AI's text, so every figure on screen matches the database.
// Every card switches between Chart / Table / List and exports its rows as CSV.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Download, List as ListIcon, Sparkles, Table2 } from 'lucide-react'
import { DataTable, Donut, Legend, LineChart, SLOT, StackedColumns, money0, num } from '../../components/charts'
import { download } from '../po/shared'
import { fmtDate } from '../../format'

const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }

/** Animated number for KPI tiles (counts up once on mount). */
function CountUp({ value, format = num }) {
  const [v, setV] = useState(() => (reduceMotion() ? value : 0))
  useEffect(() => {
    if (reduceMotion() || !Number.isFinite(value)) { setV(value); return undefined }
    let raf; const t0 = performance.now(), dur = 700
    const step = (t) => { const p = Math.min(1, (t - t0) / dur); setV(value * (1 - (1 - p) ** 3)); if (p < 1) raf = requestAnimationFrame(step) }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{format(v)}</>
}

/** Horizontal ranked bars; widths grow in on mount. rows: [{ label, value, note?, to? }] */
export function HBars({ rows, format = num, color = SLOT(0) }) {
  const [grown, setGrown] = useState(reduceMotion())
  useEffect(() => { const t = requestAnimationFrame(() => setGrown(true)); return () => cancelAnimationFrame(t) }, [])
  const max = Math.max(1, ...rows.map((r) => r.value || 0))
  return (
    <ul className="ai-hbars">
      {rows.map((r, i) => {
        const label = <span className="ai-hbar-label" title={r.label}>{r.label}</span>
        return (
          <li key={`${r.label}-${i}`} title={`${r.label}: ${format(r.value)}${r.note ? ` · ${r.note}` : ''}`}>
            {r.to ? <Link to={r.to}>{label}</Link> : label}
            <span className="ai-hbar-track">
              <span className="ai-hbar-fill" style={{ width: grown ? `${((r.value || 0) / max) * 100}%` : 0, background: color, transitionDelay: `${i * 40}ms` }} />
            </span>
            <span className="ai-hbar-val">{format(r.value)}</span>
            {r.note && <span className="ai-hbar-note">{r.note}</span>}
          </li>
        )
      })}
    </ul>
  )
}

/** Card list view: rows -> [{ title, sub, meta: [[label, value]], to, tone }] */
function CardList({ items }) {
  return (
    <ul className="ai-list">
      {items.map((it, i) => {
        const body = (
          <>
            <span className="ai-list-title">{it.title}</span>
            {it.sub && <span className="ai-list-sub">{it.sub}</span>}
            <span className="ai-list-meta">{it.meta.map(([k, v]) => <span key={k}><em>{k}</em> {v}</span>)}</span>
            {it.flag && <span className={`badge ${it.flag.tone}`}>{it.flag.text}</span>}
          </>
        )
        return <li key={i} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>{it.to ? <Link to={it.to} className="ai-list-item">{body}</Link> : <div className="ai-list-item">{body}</div>}</li>
      })}
    </ul>
  )
}

const VIEW_ICON = { chart: BarChart3, table: Table2, list: ListIcon }
const VIEW_LABEL = { chart: 'Chart', table: 'Table', list: 'List' }

function VizCard({ card }) {
  const views = ['chart', 'table', 'list'].filter((v) => card[v])
  const [view, setView] = useState(card.defaultView || views[0])
  return (
    <section className={`ai-viz-card${card.wide ? ' wide' : ''}`}>
      <header>
        <div>
          <h3>{card.title}</h3>
          {card.sub && <p className={card.aiCaption ? 'ai-caption' : undefined}>{card.aiCaption && <Sparkles size={12} />}{card.sub}</p>}
        </div>
        <div className="ai-viz-tools">
          {views.length > 1 && (
            <span className="seg dash-seg" role="group" aria-label={`${card.title} view`}>
              {views.map((v) => {
                const Icon = VIEW_ICON[v]
                return <button key={v} type="button" className={`seg-btn${view === v ? ' active' : ''}`} aria-pressed={view === v} onClick={() => setView(v)} title={VIEW_LABEL[v]}><Icon size={13} /> {VIEW_LABEL[v]}</button>
              })}
            </span>
          )}
          {card.csv && <button type="button" className="btn small ghost" onClick={() => download(card.csv.rows, card.csv.cols, card.csv.file)} title="Download CSV"><Download size={13} /> CSV</button>}
        </div>
      </header>
      <div className="ai-viz-body" key={view}>
        {view === 'chart' && card.chart}
        {view === 'table' && <DataTable columns={card.table.columns} rows={card.table.rows} />}
        {view === 'list' && card.list}
      </div>
    </section>
  )
}

const acctLink = (r) => (r.AccountID ? `/am/accounts/${r.AccountID}` : null)
const acctTitle = (r) => `#${r.AccountNumber ?? '—'} ${r.CustomerName || ''}`.trim()
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
const periodLabel = (p) => (/^\d{4}-\d{2}$/.test(p) ? new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : p)
const QUALITY_LABEL = {
  missingAccountIdOrNumber: 'Missing account ID or number', duplicateAccountNumber: 'Duplicate account numbers',
  activeWithoutRenewalDate: 'Active, no renewal date', activeWithoutMonitoringType: 'Active, no monitoring type',
  activeWithoutContractTerms: 'Active, no contract terms', activeWithZeroOrBlankValue: 'Active, $0 or blank value',
  renewalBeforeActivation: 'Renewal before activation', activeWithoutCallListContacts: 'Active, no call-list contacts',
  cancelledWithoutReason: 'Cancelled, no reason',
}

/** Turn the AI's query results into KPI tiles and visual cards. */
function buildVisuals(sources) {
  const kpis = [], cards = []
  const seen = new Set()
  for (const s of sources || []) {
    const sig = s.tool + JSON.stringify(s.input || {})
    if (seen.has(sig) || !s.data) continue
    seen.add(sig)
    const d = s.data
    const id = `${s.tool}-${cards.length}`

    if (s.tool === 'portfolio_summary') {
      kpis.push(
        { label: 'Active accounts', value: d.activeAccounts, format: num, sub: `of ${num(d.totalAccounts)} on file` },
        { label: 'Active MRR', value: d.activeMRR, format: money0, sub: 'monthly recurring revenue' },
        { label: 'Cancelled accounts', value: d.cancelledAccounts, format: num, sub: d.totalAccounts ? `${((d.cancelledAccounts / d.totalAccounts) * 100).toFixed(1)}% of all accounts` : '' },
        { label: 'Avg monthly value', value: d.avgMonthlyValueActivePaying, format: (v) => `$${(v || 0).toFixed(2)}`, sub: 'active paying accounts' },
      )
      const types = d.byMonitoringType || []
      cards.push({
        key: id + 'a', title: 'Active accounts by monitoring type', sub: `As of ${d.asOf}`,
        chart: <Donut items={types.map((t, k) => ({ name: t.monitoringType.replace(/\s+/g, ' '), value: t.activeAccounts, color: SLOT(k) }))} format={num} centerLabel="Active accounts" />,
        table: { columns: [{ key: 'monitoringType', label: 'Monitoring type' }, { key: 'activeAccounts', label: 'Active accounts', num: true, format: num }, { key: 'activeMRR', label: 'MRR', num: true, format: money0 }], rows: types },
        list: <CardList items={types.map((t) => ({ title: t.monitoringType, meta: [['Accounts', num(t.activeAccounts)], ['MRR', money0(t.activeMRR)]] }))} />,
        csv: { rows: types, cols: [['monitoringType', 'Monitoring type'], ['activeAccounts', 'Active accounts'], ['activeMRR', 'MRR']], file: 'am-ai-by-monitoring-type.csv' },
      })
      const terms = d.byContractTerms || []
      cards.push({
        key: id + 'b', title: 'MRR by contract terms', sub: 'Active accounts',
        chart: <HBars rows={terms.map((t) => ({ label: t.contractTerms, value: t.activeMRR || 0, note: `${num(t.activeAccounts)} acct${t.activeAccounts === 1 ? "" : "s"}` }))} format={money0} />,
        table: { columns: [{ key: 'contractTerms', label: 'Contract terms' }, { key: 'activeAccounts', label: 'Active accounts', num: true, format: num }, { key: 'activeMRR', label: 'MRR', num: true, format: money0 }], rows: terms },
        csv: { rows: terms, cols: [['contractTerms', 'Contract terms'], ['activeAccounts', 'Active accounts'], ['activeMRR', 'MRR']], file: 'am-ai-by-contract-terms.csv' },
      })
    }

    if (s.tool === 'account_trend') {
      const what = d.metric === 'cancelled' ? 'Cancellations' : 'New accounts'
      const rows = d.rows || []
      const cats = rows.map((r) => ({ key: r.period, label: r.period, short: periodLabel(r.period) }))
      cards.push({
        key: id, wide: true, title: `${what} by ${d.groupBy}`, sub: `${fmtDate(d.from)} – ${fmtDate(d.to)} · ${d.monitoringType === 'all' ? 'all monitoring types' : d.monitoringType} · ${num(d.totalAccounts)} accounts, ${money0(d.totalMonthlyValue)}/month`,
        chart: rows.length
          ? <StackedColumns categories={cats} series={[{ key: 'accounts', name: what, color: d.metric === 'cancelled' ? 'var(--status-critical)' : SLOT(0) }]} value={(k) => rows[k].accounts} format={num} totalLabel={what}
              extraRows={(k) => [{ label: d.metric === 'cancelled' ? 'Monthly value lost' : 'Monthly value added', value: money0(rows[k].monthlyValue) }]} height={230} ariaLabel={`${what} by ${d.groupBy}`} />
          : <p className="muted">No accounts in this period.</p>,
        table: { columns: [{ key: 'period', label: d.groupBy === 'year' ? 'Year' : 'Month' }, { key: 'accounts', label: what, num: true, format: num }, { key: 'monthlyValue', label: 'Monthly value', num: true, format: money0 }], rows },
        csv: { rows, cols: [['period', 'Period'], ['accounts', what], ['monthlyValue', 'Monthly value']], file: `am-ai-${d.metric}-${d.groupBy}.csv` },
      })
    }

    if (s.tool === 'cancellation_reasons') {
      const rows = d.rows || []
      const byReason = Object.values(rows.reduce((m, r) => {
        const k = r.reason; m[k] ||= { reason: k, accounts: 0, lost: 0 }; m[k].accounts += r.accounts; m[k].lost += r.monthlyValueLost || 0; return m
      }, {})).sort((a, b) => b.accounts - a.accounts)
      cards.push({
        key: id, title: 'Cancellations by reason', sub: d.from ? `${fmtDate(d.from)} – ${fmtDate(d.to) || 'today'}` : 'All time',
        chart: <HBars rows={byReason.map((r) => ({ label: r.reason, value: r.accounts, note: `${money0(r.lost)}/mo lost` }))} format={num} color="var(--status-critical)" />,
        table: { columns: [{ key: 'reason', label: 'Reason' }, { key: 'monitoringType', label: 'Monitoring type' }, { key: 'accounts', label: 'Accounts', num: true, format: num }, { key: 'monthlyValueLost', label: 'MRR lost', num: true, format: money0 }], rows },
        list: <CardList items={byReason.map((r) => ({ title: r.reason, meta: [['Accounts', num(r.accounts)], ['MRR lost', money0(r.lost)]] }))} />,
        csv: { rows, cols: [['reason', 'Reason'], ['monitoringType', 'Monitoring type'], ['accounts', 'Accounts'], ['monthlyValueLost', 'MRR lost']], file: 'am-ai-cancellation-reasons.csv' },
      })
    }

    if (s.tool === 'renewals_due') {
      kpis.push(
        { label: 'Renewals in scope', value: d.accounts, format: num, sub: `next ${d.days} days${d.includeOverdue ? ' + overdue' : ''}` },
        { label: 'Monthly value at stake', value: d.monthlyValueAtStake, format: money0, sub: 'from these accounts' },
        ...(d.includeOverdue ? [{ label: 'Already overdue', value: d.overdueAccounts, format: num, sub: `${money0(d.overdueMonthlyValue)}/month`, tone: d.overdueAccounts ? 'bad' : '' }] : []),
      )
      const rows = d.rows || []
      cards.push({
        key: id, wide: true, title: 'Accounts to call about renewal', sub: d.rowsNote, defaultView: 'list',
        chart: <HBars rows={rows.slice(0, 15).map((r) => ({ label: acctTitle(r), value: r.monthlyValue || 0, note: r.daysUntilRenewal < 0 ? `${-r.daysUntilRenewal} days overdue` : `in ${r.daysUntilRenewal} days`, to: acctLink(r) }))} format={money0} />,
        table: {
          columns: [{ key: 'AccountNumber', label: 'Account #' }, { key: 'CustomerName', label: 'Customer' }, { key: 'city', label: 'City', format: titleCase }, { key: 'ContractTerms', label: 'Terms' },
            { key: 'monthlyValue', label: 'Monthly', num: true, format: money0 }, { key: 'renewalDate', label: 'Renewal', format: fmtDate }, { key: 'daysUntilRenewal', label: 'Days', num: true, format: (v) => (v < 0 ? `${-v} overdue` : `in ${v}`) }],
          rows,
        },
        list: <CardList items={rows.map((r) => ({ title: acctTitle(r), sub: `${titleCase(r.city)} · ${r.monitoringType} · ${r.ContractTerms || 'no terms'}`, to: acctLink(r),
          meta: [['Monthly', money0(r.monthlyValue)], ['Renewal', fmtDate(r.renewalDate)]],
          flag: r.daysUntilRenewal < 0 ? { tone: 'red', text: `${-r.daysUntilRenewal} days overdue` } : { tone: 'amber', text: `in ${r.daysUntilRenewal} days` } }))} />,
        csv: { rows, cols: [['AccountNumber', 'Account #'], ['CustomerName', 'Customer'], ['city', 'City'], ['monitoringType', 'Monitoring type'], ['ContractTerms', 'Terms'], ['monthlyValue', 'Monthly'], ['renewalDate', 'Renewal date'], ['daysUntilRenewal', 'Days until renewal']], file: 'am-ai-renewals.csv' },
      })
    }

    if (s.tool === 'find_accounts') {
      const rows = d.rows || []
      cards.push({
        key: id, wide: true, title: 'Matching accounts', sub: `${num(d.totalMatching)} match · ${money0(d.totalMonthlyValue)}/month in total${d.returned < d.totalMatching ? ` · showing ${d.returned}` : ''}`, defaultView: 'table',
        chart: <HBars rows={rows.map((r) => ({ label: acctTitle(r), value: r.monthlyValue || 0, note: titleCase(r.city), to: acctLink(r) }))} format={money0} />,
        table: {
          columns: [{ key: 'AccountNumber', label: 'Account #' }, { key: 'CustomerName', label: 'Customer' }, { key: 'city', label: 'City', format: titleCase }, { key: 'monitoringType', label: 'Type' },
            { key: 'ContractTerms', label: 'Terms' }, { key: 'monthlyValue', label: 'Monthly', num: true, format: money0 }, { key: 'activated', label: 'Activated', format: fmtDate },
            { key: 'renewalDate', label: 'Renewal', format: fmtDate }, { key: 'disconnected', label: 'Cancelled', format: fmtDate }],
          rows,
        },
        list: <CardList items={rows.map((r) => ({ title: acctTitle(r), sub: `${titleCase(r.city)} · ${r.monitoringType}`, to: acctLink(r),
          meta: [['Monthly', money0(r.monthlyValue)], ['Renewal', fmtDate(r.renewalDate) || '—']], flag: r.disconnected ? { tone: 'neutral', text: `Cancelled ${fmtDate(r.disconnected)}` } : null }))} />,
        csv: { rows, cols: [['AccountNumber', 'Account #'], ['CustomerName', 'Customer'], ['city', 'City'], ['monitoringType', 'Monitoring type'], ['ContractTerms', 'Terms'], ['monthlyValue', 'Monthly'], ['activated', 'Activated'], ['renewalDate', 'Renewal'], ['disconnected', 'Cancelled'], ['CancellationReason', 'Reason']], file: 'am-ai-accounts.csv' },
      })
    }

    if (s.tool === 'revenue_breakdown') {
      const dim = String(d.dimension || '').replace(/_/g, ' ')
      const rows = (d.rows || []).map((r) => ({ ...r, grp: d.dimension === 'city' ? titleCase(r.grp) : r.grp }))
      cards.push({
        key: id, title: `Revenue by ${dim}`, sub: 'Active accounts, top 20',
        chart: <HBars rows={rows.map((r) => ({ label: r.grp, value: r.activeMRR || 0, note: `${num(r.activeAccounts)} acct${r.activeAccounts === 1 ? "" : "s"}` }))} format={money0} />,
        table: { columns: [{ key: 'grp', label: titleCase(dim) }, { key: 'activeAccounts', label: 'Active accounts', num: true, format: num }, { key: 'activeMRR', label: 'MRR', num: true, format: money0 }, { key: 'avgMonthlyValue', label: 'Avg / account', num: true, format: money0 }], rows },
        csv: { rows, cols: [['grp', titleCase(dim)], ['activeAccounts', 'Active accounts'], ['activeMRR', 'MRR'], ['avgMonthlyValue', 'Avg per account']], file: `am-ai-revenue-by-${d.dimension}.csv` },
      })
    }

    if (s.tool === 'data_quality_check') {
      const rows = Object.entries(d).map(([k, v]) => ({ check: QUALITY_LABEL[k] || k, count: v.count, examples: (v.examples || []).map(acctTitle).join('; ') })).sort((a, b) => b.count - a.count)
      cards.push({
        key: id, title: 'Data-quality issues', sub: 'Accounts affected per check',
        chart: <HBars rows={rows.map((r) => ({ label: r.check, value: r.count }))} format={num} color="var(--series-2)" />,
        table: { columns: [{ key: 'check', label: 'Check' }, { key: 'count', label: 'Accounts', num: true, format: num }, { key: 'examples', label: 'Examples' }], rows },
        list: <CardList items={rows.map((r) => ({ title: r.check, sub: r.examples || 'No examples', meta: [['Accounts', num(r.count)]], flag: r.count ? { tone: 'amber', text: 'Fix' } : { tone: 'green', text: 'OK' } }))} />,
        csv: { rows, cols: [['check', 'Check'], ['count', 'Accounts'], ['examples', 'Examples']], file: 'am-ai-data-quality.csv' },
      })
    }
  }
  return { kpis, cards }
}

export function useVisuals(sources, charts) {
  return useMemo(() => ({ ...buildVisuals(sources), aiCharts: buildAiCharts(charts) }), [sources, charts])
}

export function AiVisuals({ visuals }) {
  const { kpis, cards, aiCharts } = visuals
  if (!kpis.length && !cards.length && !aiCharts.length) return null
  return (
    <div className="ai-visuals">
      {kpis.length > 0 && (
        <div className="ai-kpis">
          {kpis.map((k, i) => (
            <div key={k.label} className={`ai-kpi ${k.tone || ''}`} style={{ animationDelay: `${i * 60}ms` }}>
              <span className="ai-kpi-label">{k.label}</span>
              <b className="ai-kpi-value"><CountUp value={k.value || 0} format={k.format} /></b>
              {k.sub && <span className="ai-kpi-sub">{k.sub}</span>}
            </div>
          ))}
        </div>
      )}
      {aiCharts.length > 0 && (
        <>
          <h3 className="ai-viz-heading"><Sparkles size={14} /> Charts chosen by AI</h3>
          <div className="ai-viz-grid">{aiCharts.map((c) => <VizCard key={c.key} card={c} />)}</div>
        </>
      )}
      {cards.length > 0 && (
        aiCharts.length
          ? <details className="ai-data-views"><summary>All data behind this answer ({cards.length} views)</summary><div className="ai-viz-grid">{cards.map((c) => <VizCard key={c.key} card={c} />)}</div></details>
          : <div className="ai-viz-grid">{cards.map((c) => <VizCard key={c.key} card={c} />)}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Charts chosen by the AI (show_chart specs). Data = the query rows the server attached to each spec.
// ---------------------------------------------------------------------------
const FORMATS = { number: num, money: money0, percent: (v) => (v == null ? '—' : `${(+v).toFixed(1)}%`) }
const isPeriod = (v) => /^\d{4}(-\d{2})?$/.test(String(v))
const fieldLabel = (f) => String(f).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()).replace(/\bMrr\b/i, 'MRR')
const cleanLabel = (v) => (v == null || v === '' ? '(none)' : String(v).replace(/\s+/g, ' '))

/** Two categorical dimensions: rows x columns, cell shade = value (one-hue sequential scale). */
function Heatmap({ xs, cols, cell, format }) {
  const max = Math.max(1, ...xs.flatMap((x) => cols.map((c) => cell(x, c) || 0)))
  return (
    <div className="ai-heat-wrap">
      <table className="ai-heat">
        <thead><tr><th />{cols.map((c) => <th key={c} title={c}>{c}</th>)}</tr></thead>
        <tbody>
          {xs.map((x, ri) => (
            <tr key={x}>
              <th scope="row">{isPeriod(x) ? periodLabel(x) : x}</th>
              {cols.map((c, ci) => {
                const v = cell(x, c) || 0
                const a = v ? 0.12 + 0.83 * (v / max) : 0
                return (
                  <td key={c} title={`${x} · ${c}: ${format(v)}`} style={{ background: v ? `rgba(109, 79, 216, ${a.toFixed(3)})` : undefined, color: a > 0.55 ? '#fff' : undefined, animationDelay: `${(ri + ci) * 25}ms` }}>
                    {v ? format(v) : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ai-heat-scale"><span>Low</span><i /><span>High · max {format(max)}</span></div>
    </div>
  )
}

function buildAiCharts(charts) {
  return (charts || []).map((c, n) => {
    const fmt = FORMATS[c.format] || num
    const y0 = c.y[0]
    let rows = c.rows.map((r) => ({ ...r }))
    const timeLike = rows.every((r) => isPeriod(r[c.x]))
    if (c.sort !== 'none' && !['line', 'area'].includes(c.type)) rows.sort((a, b) => (c.sort === 'desc' ? 1 : -1) * ((b[y0] || 0) - (a[y0] || 0)))
    else if (timeLike) rows.sort((a, b) => String(a[c.x]).localeCompare(String(b[c.x])))
    const tableCols = [c.x, ...(c.seriesField ? [c.seriesField] : []), ...c.y].map((f) => ({ key: f, label: fieldLabel(f), num: c.y.includes(f), format: c.y.includes(f) ? fmt : (v) => (isPeriod(v) ? v : cleanLabel(v)) }))
    const base = {
      key: `ai-${n}`, title: c.title, sub: c.caption, aiCaption: true, wide: ['line', 'area', 'stacked_column', 'heatmap'].includes(c.type) || (c.type === 'column' && rows.length > 8),
      table: { columns: tableCols, rows },
      csv: { rows, cols: tableCols.map((t) => [t.key, t.label]), file: `am-ai-chart-${n + 1}.csv` },
    }
    let chart = null

    if (c.type === 'line' || c.type === 'area') {
      const cats = rows.map((r) => ({ key: String(r[c.x]), label: isPeriod(r[c.x]) ? periodLabel(r[c.x]) : cleanLabel(r[c.x]), short: isPeriod(r[c.x]) ? periodLabel(r[c.x]) : cleanLabel(r[c.x]).slice(0, 10) }))
      const series = c.y.map((f, k) => ({ key: f, name: fieldLabel(f), color: SLOT(k), values: rows.map((r) => +r[f] || 0), area: c.type === 'area' || (k === 0 && c.y.length === 1) }))
      chart = (
        <>
          {series.length > 1 && <Legend items={series.map((s) => ({ label: s.name, color: s.color, mark: 'line' }))} />}
          <LineChart categories={cats} series={series} format={fmt} height={250} ariaLabel={c.title} />
        </>
      )
    } else if (c.type === 'column') {
      const limited = rows.slice(0, c.limit)
      const cats = limited.map((r) => ({ key: String(r[c.x]), label: isPeriod(r[c.x]) ? periodLabel(r[c.x]) : cleanLabel(r[c.x]), short: isPeriod(r[c.x]) ? periodLabel(r[c.x]) : cleanLabel(r[c.x]).slice(0, 10) }))
      // Columns grow up from one baseline: a measure with negative values (e.g. net change) stays in the table only
      const usable = c.y.filter((f) => !limited.some((r) => +r[f] < 0))
      const dropped = c.y.filter((f) => !usable.includes(f))
      const series = usable.map((f) => ({ key: f, name: fieldLabel(f), color: SLOT(c.y.indexOf(f)) }))
      chart = series.length ? (
        <>
          {series.length > 1 && <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />}
          <StackedColumns grouped={series.length > 1} categories={cats} series={series} value={(i, f) => +limited[i][f] || 0} format={fmt} height={240} ariaLabel={c.title} totalLabel={series.length > 1 ? 'Total' : series[0].name} />
          {dropped.length > 0 && <p className="muted small">{dropped.map(fieldLabel).join(', ')} can be negative, so it is shown in the Table view.</p>}
        </>
      ) : <p className="muted">These values can be negative; see the Table view.</p>
    } else if (c.type === 'bar') {
      chart = <HBars rows={rows.slice(0, c.limit).map((r) => ({ label: cleanLabel(r[c.x]), value: +r[y0] || 0 }))} format={fmt} />
    } else if (c.type === 'donut') {
      const sorted = [...rows].sort((a, b) => (+b[y0] || 0) - (+a[y0] || 0))
      const top = sorted.slice(0, 5), rest = sorted.slice(5)
      const items = top.map((r, k) => ({ name: cleanLabel(r[c.x]), value: +r[y0] || 0, color: SLOT(k) }))
      if (rest.length) items.push({ name: `Other (${rest.length})`, value: rest.reduce((t, r) => t + (+r[y0] || 0), 0), color: 'var(--series-prev)', other: true })
      chart = <Donut items={items} format={fmt} centerLabel={fieldLabel(y0)} />
    } else if (c.type === 'stacked_column' || c.type === 'heatmap') {
      const xs = [...new Set(rows.map((r) => String(r[c.x])))]
      if (xs.every(isPeriod)) xs.sort()
      const totals = {}
      for (const r of rows) { const k = cleanLabel(r[c.seriesField]); totals[k] = (totals[k] || 0) + (+r[y0] || 0) }
      let cols = Object.keys(totals).sort((a, b) => totals[b] - totals[a])
      const cap = c.type === 'stacked_column' ? 5 : 12
      const folded = cols.length > cap ? cols.slice(cap) : []
      if (folded.length) cols = [...cols.slice(0, cap), 'Other']
      const cell = (x, col) => rows.filter((r) => String(r[c.x]) === x && (col === 'Other' ? folded.includes(cleanLabel(r[c.seriesField])) : cleanLabel(r[c.seriesField]) === col)).reduce((t, r) => t + (+r[y0] || 0), 0)
      if (c.type === 'heatmap') chart = <Heatmap xs={xs} cols={cols} cell={cell} format={fmt} />
      else {
        const series = cols.map((col, k) => ({ key: col, name: col, color: col === 'Other' ? 'var(--series-prev)' : SLOT(k) }))
        const cats = xs.map((x) => ({ key: x, label: isPeriod(x) ? periodLabel(x) : x, short: isPeriod(x) ? periodLabel(x) : x.slice(0, 10) }))
        chart = (
          <>
            <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />
            <StackedColumns categories={cats} series={series} value={(i, col) => cell(xs[i], col)} format={fmt} height={250} ariaLabel={c.title} />
          </>
        )
      }
    }
    return { ...base, chart }
  })
}

/** One CSV with every dataset of the report, one section after another (opens in Excel). */
export function downloadAllCsv(visuals, name) {
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const val = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : v)
  const parts = [...(visuals.aiCharts || []), ...visuals.cards].filter((c) => c.csv).map((c) => [
    esc(c.title), c.csv.cols.map(([, l]) => esc(l)).join(','), ...c.csv.rows.map((r) => c.csv.cols.map(([k]) => esc(val(r[k]))).join(',')), '',
  ].join('\r\n'))
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([parts.join('\r\n')], { type: 'text/csv' }))
  a.download = name; a.click(); URL.revokeObjectURL(a.href)
}
