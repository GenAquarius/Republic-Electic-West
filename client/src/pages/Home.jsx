import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertCircle, ArrowRight, ArrowUpRight, Boxes, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, History, HardHat,
  Home as HomeIcon, LayoutGrid, Wallet, Activity, Building2, RefreshCw, SlidersHorizontal, Gauge,
} from 'lucide-react'
import { api, session } from '../api'
import { GROUPS, MODULES, moduleByCode } from '../modules'
import { recentVisits, usePref } from '../prefs'
import { useLookups } from '../components/Pickers'
import { Badge, EmptyState, ErrorState, Skeleton, SkeletonRows, StatCard } from '../components/ui'
import DashboardAnalytics, { rangeLabel } from './DashboardAnalytics'
import { fmtDate } from '../format'

const money0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'))

function timeAgo(ts) {
  if (!ts) return ''
  const s = (Date.now() - new Date(ts).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const d = Math.floor(s / 86400)
  return d < 30 ? `${d} day${d > 1 ? 's' : ''} ago` : fmtDate(ts)
}
function dayLabel(ts) {
  const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return days < 30 ? `${days} days ago` : fmtDate(ts)
}
function ageLabel(since) {
  if (!since) return null
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86400000)
  if (days <= 0) return 'Due today'
  if (days < 60) return `${days} day${days > 1 ? 's' : ''} ago`
  const months = Math.floor(days / 30)
  return months < 24 ? `${months} months ago` : `Since ${new Date(since).getUTCFullYear()}`
}
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }
const PRIO_TONE = { high: 'red', medium: 'amber', low: 'neutral' }

// Shown in "Jump back in" until the user has opened some screens.
const SUGGESTED = [
  { path: '/ar/billing', title: 'Process billing', module: 'AR' },
  { path: '/pr/piece', title: 'Piece timecard', module: 'PR' },
  { path: '/sc', title: 'Schedule packs', module: 'SC' },
  { path: '/pu', title: 'Lot finder', module: 'PU' },
]

function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: '', loading: true })
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    fn().then((data) => setState({ data, error: '', loading: false })).catch((e) => setState({ data: null, error: e.message, loading: false }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { load() }, [load])
  return { ...state, reload: load }
}

function Section({ title, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <h2>{Icon && <Icon size={16} />}{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Seg({ label, value, options, onChange }) {
  return (
    <span className="seg dash-seg" role="group" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" className={`seg-btn${value === k ? ' active' : ''}`} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </span>
  )
}

const PERIODS = [['3m', '3 months'], ['6m', '6 months'], ['12m', '12 months'], ['ytd', 'Year to date']]
const COMPARES = [['prev', 'Previous period'], ['yoy', 'Same period last year']]

export default function Home() {
  const nav = useNavigate()
  const user = session.user
  const can = (c) => user?.modules?.includes(c)
  const [division, setDivision] = usePref('sw_division', '')
  const [period, setPeriod] = usePref('sw_dash_period', '12m')
  const [compare, setCompare] = usePref('sw_dash_compare', 'prev')
  const { divisions } = useLookups('divisions')
  const divName = divisions.find((d) => d.id === division)?.name

  const summary = useLoad(() => api('/dashboard/summary', { params: { division } }), [division])
  const attention = useLoad(() => api('/dashboard/attention'), [])
  const analytics = useLoad(() => api('/dashboard/analytics', { params: { period, compare, division } }), [period, compare, division])
  const activity = useLoad(() => api('/dashboard/activity'), [])
  const [recent] = useState(() => recentVisits().slice(0, 6))
  const [showAllTasks, setShowAllTasks] = useState(false)
  const [prio, setPrio] = useState('all')
  const [showModDesc, setShowModDesc] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(() => Date.now())
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(t) }, [])

  const refresh = () => {
    summary.reload(); attention.reload(); analytics.reload(); activity.reload()
    setUpdatedAt(Date.now())
  }
  const refreshing = summary.loading || attention.loading || analytics.loading || activity.loading

  const s = summary.data
  const att = attention.data?.items || []
  const prioCount = (p) => att.filter((a) => a.priority === p).length
  const shownAtt = prio === 'all' ? att : att.filter((a) => a.priority === prio)

  const ph = s?.payrollPending
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const myModules = GROUPS.flatMap((g) => MODULES.filter((m) => can(m.code) && m.group === g))
  const suggested = SUGGESTED.filter((x) => moduleByCode[x.module]?.ready && (moduleByCode[x.module]?.public || can(x.module)))

  // Group the activity feed under day headings ("Today", "3 days ago", ...)
  const activityGroups = []
  for (const r of activity.data?.rows || []) {
    const label = dayLabel(r.DateEntered)
    const last = activityGroups[activityGroups.length - 1]
    if (last && last.label === label) last.rows.push(r)
    else activityGroups.push({ label, rows: [r] })
  }

  return (
    <div className="page dashboard">
      {/* Welcome */}
      <section className="welcome">
        <div className="welcome-main">
          <div className="welcome-date"><CalendarDays size={14} /> {today}</div>
          <h1>{greeting()}, {user?.username}</h1>
          <p className="welcome-sub">
            <Building2 size={14} /> Republic Electric West · {division ? divName || division : 'All divisions'}
          </p>
        </div>
        <div className="welcome-overview">
          <span className="muted small">{refreshing ? 'Updating…' : `Updated ${timeAgo(updatedAt)}`}</span>
          <button className="btn small ghost dash-refresh" onClick={refresh} disabled={refreshing} aria-label="Refresh dashboard" title="Refresh dashboard">
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          </button>
        </div>
      </section>

      {/* Report filters: scope every KPI and chart in the reporting section below */}
      <div className="dash-filters" role="toolbar" aria-label="Report filters">
        <span className="dash-filter-label"><SlidersHorizontal size={14} /> Reporting period</span>
        <Seg label="Reporting period" value={period} options={PERIODS} onChange={setPeriod} />
        <span className="dash-filter-label">Compare with</span>
        <Seg label="Compare with" value={compare} options={COMPARES} onChange={setCompare} />
        <label className="dash-filter-label" htmlFor="dash-division">Division</label>
        <select id="dash-division" className="dash-select" value={division} onChange={(e) => setDivision(e.target.value)}>
          <option value="">All divisions</option>
          {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {analytics.data && (
          <span className="dash-range muted small">
            {rangeLabel(analytics.data.current.months)} <span aria-hidden="true">vs</span><span className="sr-only">compared with</span> {rangeLabel(analytics.data.previous.months)}
          </span>
        )}
      </div>

      <DashboardAnalytics state={analytics} can={can} division={division} divisions={divisions} />

      {/* Operations snapshot: live, point-in-time figures (not affected by the reporting period) */}
      <div className="dash-section-head">
        <h2><Gauge size={16} /> Operations snapshot</h2>
        <span className="muted small">Live figures right now · not affected by the reporting period</span>
      </div>
      {summary.error ? <ErrorState message={summary.error} onRetry={summary.reload} /> : (
        <div className="kpis">
          <StatCard label="Open lots – REW" icon={HardHat} tone="blue" loading={summary.loading}
            onClick={() => nav('/insights/open-lots?division=REW')}
            value={num(s?.openLots?.REW ?? 0)} foot="Open-lot register · REW jobs" />
          <StatCard label="Open lots – REI" icon={HomeIcon} tone="blue" loading={summary.loading}
            onClick={() => nav('/insights/open-lots?division=REI')}
            value={num(s?.openLots?.REI ?? 0)} foot="Open-lot register · REI (Elite) jobs" />
          {can('IC') && (
            <StatCard label="Inventory value" icon={Boxes} tone="green" loading={summary.loading}
              onClick={() => nav(`/insights/inventory${division ? `?division=${division}` : ''}`)}
              value={money0(s?.inventory?.value)}
              foot={<>{num(s?.inventory?.items)} items on hand × average cost{s?.inventory?.negative ? <> · <span className="text-danger">{s.inventory.negative} negative</span></> : null}</>} />
          )}
          {can('PR') && (
            <StatCard label="Payroll pending" icon={Wallet} tone="amber" loading={summary.loading}
              onClick={() => nav('/insights/payroll-pending')}
              value={`${num(ph?.hourly?.hours ?? 0)} hrs`}
              foot={<>{num(ph?.hourly?.entries)} hourly entries{ph?.hourly?.payrollDate ? ` for ${fmtDate(ph.hourly.payrollDate)}` : ''} · {num(ph?.piece?.entries)} timecard lines not posted{ph?.piece?.entries ? ` (${money0(ph?.piece?.value)})` : ''}</>} />
          )}
        </div>
      )}

      {/* Needs attention: full-width table */}
      <Section title={<>Needs attention{att.length > 0 && <Badge tone="amber">{att.length} open</Badge>}</>} icon={AlertCircle} className="dash-block"
        action={att.length > 0 && (
          <span className="seg dash-seg" role="group" aria-label="Filter by priority">
            {[['all', `All ${att.length}`], ['high', `High ${prioCount('high')}`], ['medium', `Medium ${prioCount('medium')}`], ['low', `Low ${prioCount('low')}`]].map(([k, l]) => (
              <button key={k} type="button" className={`seg-btn${prio === k ? ' active' : ''}`} aria-pressed={prio === k} onClick={() => { setPrio(k); setShowAllTasks(false) }}>{l}</button>
            ))}
          </span>
        )}>
        <div id="attention" />
        {attention.loading && <SkeletonRows rows={3} cols={4} />}
        {attention.error && <ErrorState message={attention.error} onRetry={attention.reload} />}
        {!attention.loading && !attention.error && !att.length && (
          <EmptyState icon={CheckCircle2} title="All caught up">No pending payroll, overdue stages or unposted counts.</EmptyState>
        )}
        {!attention.loading && !attention.error && att.length > 0 && (
          <div className="att-table" role="table" aria-label="Items that need attention">
            <div className="att-row att-head" role="row">
              <span aria-hidden="true" /><span role="columnheader">Item</span><span role="columnheader">Module</span>
              <span role="columnheader">Oldest</span><span role="columnheader">Priority</span><span />
            </div>
            {(showAllTasks ? shownAtt : shownAtt.slice(0, 5)).map((a) => {
              const m = moduleByCode[a.module]
              const Icon = m?.icon
              const ready = m?.ready
              const records = `/insights/attention/${a.id}`
              const primary = ready ? a.action.to : records
              return (
                <div key={a.id} role="row" className="att-row clickable" onClick={(e) => !e.target.closest('button') && nav(primary)}>
                  <span className={`att-dot ${a.priority}`} aria-hidden="true" />
                  <span className="att-item" role="cell">
                    <span className="att-title">{a.title}</span>
                    <span className="att-detail">{a.detail}</span>
                  </span>
                  <span role="cell">{m && <span className={`att-mod accent-${m.accent}`}>{Icon && <Icon size={12} />}{m.name}</span>}</span>
                  <span role="cell" className="muted small">{ageLabel(a.since) || '—'}</span>
                  <span role="cell"><Badge tone={PRIO_TONE[a.priority] || 'neutral'}>{a.priority}</Badge></span>
                  <span role="cell" className="att-actions">
                    {ready
                      ? <button className="btn small ghost" onClick={() => nav(records)}>View records</button>
                      : a.review && <span className="muted small" title={`${m?.name} screens are being built`}>Coming soon</span>}
                    <button className={`btn small ${a.priority === 'high' ? 'primary' : ''}`} onClick={() => nav(primary)}>
                      {ready ? a.action.label : 'View records'} <ArrowRight size={13} />
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {shownAtt.length > 5 && (
          <button className="btn small ghost show-more" onClick={() => setShowAllTasks((v) => !v)}>
            {showAllTasks ? <>Show fewer <ChevronUp size={13} /></> : <>Show all {shownAtt.length} items <ChevronDown size={13} /></>}
          </button>
        )}
      </Section>

      <div className="dash-grid">
        {/* Jump back in */}
        <Section title="Jump back in" icon={History}>
          {recent.length ? (
            <ul className="recent">
              {recent.map((r) => {
                const m = moduleByCode[r.module]
                const Icon = m?.icon || HomeIcon
                return (
                  <li key={r.path}>
                    <Link to={r.path} className="recent-item">
                      <span className={`mod-icon accent-${m?.accent || 'slate'}`}><Icon size={15} /></span>
                      <span className="recent-text">
                        <span className="recent-title">{r.title}</span>
                        <span className="recent-sub">{m?.name || 'Dashboard'} · {timeAgo(r.at)}</span>
                      </span>
                      <ArrowUpRight size={14} className="recent-arrow" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : suggested.length ? (
            <>
              <p className="panel-sub">No recent screens yet. Start with a common one:</p>
              <ul className="recent">
                {suggested.map((x) => {
                  const m = moduleByCode[x.module]
                  const Icon = m.icon
                  return (
                    <li key={x.path}>
                      <Link to={x.path} className="recent-item">
                        <span className={`mod-icon accent-${m.accent}`}><Icon size={15} /></span>
                        <span className="recent-text">
                          <span className="recent-title">{x.title}</span>
                          <span className="recent-sub">{m.name}</span>
                        </span>
                        <ArrowUpRight size={14} className="recent-arrow" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <EmptyState icon={History} title="No recent screens">Screens you open will appear here.</EmptyState>
          )}
        </Section>

        {/* Activity */}
        <Section title="Recent activity" icon={Activity} className="span-2">
          {activity.loading && <SkeletonRows rows={5} cols={2} />}
          {activity.error && <ErrorState message={activity.error} onRetry={activity.reload} />}
          {activity.data && !activity.data.rows.length && <EmptyState title="No recent activity" />}
          <div className="feed">
            {activityGroups.map((g) => (
              <div key={g.label}>
                <div className="feed-day">{g.label}</div>
                <ul className="feed-list">
                  {g.rows.map((r, i) => {
                    const m = moduleByCode[r.module]
                    const Icon = m?.icon
                    const inner = (
                      <>
                        <span className={`feed-icon accent-${m?.accent || 'slate'}`}>{Icon && <Icon size={13} />}</span>
                        <span className="feed-text">
                          <span className="feed-title">{r.title}</span>
                          <span className="feed-sub">{r.kind}{r.UserEntered ? ` · ${r.UserEntered}` : ''} · {timeAgo(r.DateEntered)}</span>
                        </span>
                      </>
                    )
                    return <li key={i}>{m?.ready ? <Link to={r.link} className="feed-item">{inner}</Link> : <div className="feed-item">{inner}</div>}</li>
                  })}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      </div>
      {/* Modules: compact tiles */}
      <Section title="Modules" icon={LayoutGrid} className="dash-block dash-modules"
        action={<div className="row">
          <span className="muted small">{myModules.filter((m) => m.ready).length} of {myModules.length} available on the web</span>
          <button className="btn small ghost" onClick={() => setShowModDesc((v) => !v)} aria-pressed={showModDesc}>
            {showModDesc ? <>Hide descriptions <ChevronUp size={13} /></> : <>Show descriptions <ChevronDown size={13} /></>}
          </button>
        </div>}>
        <div className={`mod-tiles${showModDesc ? ' with-desc' : ''}`}>
          {myModules.map((m) => {
            const Icon = m.icon
            const stats = m.screens ? `${m.screens.forms} forms · ${m.screens.reports} reports · ${m.screens.actions} actions` : 'In development'
            const body = (
              <>
                <span className={`mod-icon accent-${m.accent}`}><Icon size={16} /></span>
                <span className="mod-tile-name">{m.name}</span>
                {!m.ready && <Badge>Coming soon</Badge>}
                {showModDesc && <span className="mod-tile-desc">{m.description}</span>}
                {showModDesc && <span className="mod-tile-stats">{stats}</span>}
              </>
            )
            return m.ready
              ? <Link key={m.code} to={m.path} className="mod-tile" title={`${m.description} (${stats})`}>{body}</Link>
              : <div key={m.code} className="mod-tile disabled" aria-disabled="true">{body}</div>
          })}
        </div>
      </Section>

    </div>
  )
}
