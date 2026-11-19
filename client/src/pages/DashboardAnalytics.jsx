// Management reporting section of the dashboard: period KPIs with comparison, revenue trend,
// customer and division breakdowns, labor mix and schedule performance. All data comes from
// GET /dashboard/analytics (posted A/R billing, labor paid and schedule stages).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, CalendarCheck2, Clock, DollarSign, Gauge, HardHat, Percent, Receipt, TrendingUp, Users, Wallet } from 'lucide-react'
import { EmptyState, ErrorState, Skeleton } from '../components/ui'
import {
  CRIT_COLOR, CompareBars, DataTable, Delta, Donut, GOOD_COLOR, LineChart, PREV_COLOR, SLOT, SegmentedBar, Sparkline, StackedColumns,
  money0, moneyCompact, num, pct,
} from '../components/charts'

const MONTH = (k, opts) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts })
const monthLong = (k) => MONTH(k, { month: 'long', year: 'numeric' })
const monthShort = (k) => MONTH(k, { month: 'short', year: 'numeric' })
const thisMonthKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const ymd = (iso) => String(iso).slice(0, 10)
export const rangeLabel = (months) => (months?.length ? `${monthShort(months[0])} – ${monthShort(months[months.length - 1])}` : '')

function ChartToggle({ table, onChange }) {
  return (
    <span className="seg dash-seg" role="group" aria-label="Chart or table">
      <button type="button" className={`seg-btn${!table ? ' active' : ''}`} aria-pressed={!table} onClick={() => onChange(false)}>Chart</button>
      <button type="button" className={`seg-btn${table ? ' active' : ''}`} aria-pressed={table} onClick={() => onChange(true)}>Table</button>
    </span>
  )
}

function Panel({ title, sub, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`panel viz-panel ${className}`}>
      <div className="panel-head">
        <div>
          <h2>{Icon && <Icon size={16} />}{title}</h2>
          {sub && <p className="viz-sub">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function KpiCard({ label, icon: Icon, value, delta, foot, spark, sparkLabel, onClick, loading }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} className={`kpi-card${onClick ? ' interactive' : ''}`} onClick={onClick}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {Icon && <span className="kpi-icon"><Icon size={15} /></span>}
      </div>
      <div className="kpi-value">{loading ? <Skeleton w="60%" h={28} /> : value}</div>
      <div className="kpi-delta">{loading ? <Skeleton w="70%" h={12} /> : delta}</div>
      {spark && !loading && <Sparkline values={spark} label={sparkLabel} />}
      {foot && <div className="kpi-foot">{loading ? null : foot}</div>}
    </Tag>
  )
}

export default function DashboardAnalytics({ state, can, division, divisions }) {
  const nav = useNavigate()
  const [tables, setTables] = useState({})
  const tableOf = (k) => !!tables[k]
  const setTable = (k) => (v) => setTables((t) => ({ ...t, [k]: v }))
  const { data: a, loading, error, reload } = state

  if (error && !a) return <ErrorState message={error} onRetry={reload} />
  if (!a) {
    return (
      <>
        <div className="kpi-grid">{Array.from({ length: 6 }).map((_, i) => <KpiCard key={i} label=" " loading />)}</div>
        <div className="viz-grid"><section className="panel viz-panel span-2"><Skeleton h={300} /></section><section className="panel viz-panel"><Skeleton h={300} /></section></div>
      </>
    )
  }

  const cur = a.current.months, prv = a.previous.months
  const nowKey = thisMonthKey()
  const cmpName = a.compare === 'yoy' ? 'Same period last year' : 'Previous period'
  const cmpShort = a.compare === 'yoy' ? 'vs last year' : 'vs previous period'
  const cats = cur.map((k, i) => ({
    key: k,
    label: `${monthLong(k)}${k === nowKey ? ' (to date)' : ''}`,
    short: i === 0 || k.endsWith('-01') ? MONTH(k, { month: 'short', year: '2-digit' }).replace(' ', " '") : MONTH(k, { month: 'short' }),
  }))
  const qsDiv = division ? `&division=${division}` : ''
  const rangeQs = `from=${ymd(a.current.start)}&to=${ymd(a.current.end)}${qsDiv}`

  // ---- Billing
  const B = a.billing
  const billBy = (months) => months.map((k) => (B?.monthly || []).filter((r) => r.month === k).reduce((t, r) => t + (r.total || 0), 0))
  const billCountBy = (months) => months.map((k) => (B?.monthly || []).filter((r) => r.month === k).reduce((t, r) => t + (r.bills || 0), 0))
  const revCur = billBy(cur), revPrev = billBy(prv)
  const billsCur = billCountBy(cur)
  const bt = B?.totals || { cur: {}, prev: {} }
  const revTotal = bt.cur.total || 0, revPrevTotal = bt.prev.total || 0
  const avgInv = bt.cur.bills ? revTotal / bt.cur.bills : null
  const avgInvPrev = bt.prev.bills ? revPrevTotal / bt.prev.bills : null
  // Division split for the current window (colors follow the division's lookup order, not its rank)
  const divOrder = divisions.map((d) => d.id)
  const divTotals = {}
  for (const r of B?.monthly || []) if (cur.includes(r.month)) divTotals[r.division || '—'] = (divTotals[r.division || '—'] || 0) + (r.total || 0)
  const divItems = Object.entries(divTotals)
    .sort(([x], [y]) => (divOrder.indexOf(x) + 1 || 99) - (divOrder.indexOf(y) + 1 || 99))
    .map(([id, value]) => {
      const idx = divOrder.indexOf(id)
      return { name: divisions.find((d) => d.id === id)?.name || id, value, color: SLOT(idx >= 0 ? idx : 5), darkText: idx === 3 }
    })

  // ---- Labor
  const L = a.labor
  const workTypes = [...new Set((L?.monthly || []).map((r) => r.workType))].sort()
  const wtColor = Object.fromEntries(workTypes.map((w, i) => [w, SLOT(i)]))
  const laborCell = (k, w, f) => (L?.monthly || []).filter((r) => r.month === k && (w == null || r.workType === w)).reduce((t, r) => t + (r[f] || 0), 0)
  const pieceCur = cur.map((k) => laborCell(k, null, 'piece')), piecePrev = prv.map((k) => laborCell(k, null, 'piece'))
  const hoursCur = cur.map((k) => laborCell(k, null, 'hours')), hoursPrev = prv.map((k) => laborCell(k, null, 'hours'))
  const sum = (xs) => xs.reduce((t, v) => t + v, 0)
  const pieceTotal = sum(pieceCur), piecePrevTotal = sum(piecePrev)
  const hoursTotal = sum(hoursCur), hoursPrevTotal = sum(hoursPrev)
  const ratio = revTotal ? pieceTotal / revTotal : null
  const ratioPrev = revPrevTotal ? piecePrevTotal / revPrevTotal : null
  const ratioSpark = cur.map((_, i) => (revCur[i] ? pieceCur[i] / revCur[i] : 0))
  const pieceByType = workTypes.map((w) => ({ name: w, value: sum(cur.map((k) => laborCell(k, w, 'piece'))), color: wtColor[w] }))
  const hoursByType = workTypes.map((w) => ({ name: w, value: sum(cur.map((k) => laborCell(k, w, 'hours'))) }))
  const lt = L?.totals || { cur: {}, prev: {} }

  // ---- Schedule
  const S = a.stages
  const stageRow = (k) => (S?.monthly || []).find((r) => r.month === k) || { completed: 0, onTime: 0 }
  const stagesCur = cur.map(stageRow), stagesPrev = prv.map(stageRow)
  const doneTotal = sum(stagesCur.map((r) => r.completed)), donePrev = sum(stagesPrev.map((r) => r.completed))
  const onTimeTotal = sum(stagesCur.map((r) => r.onTime)), onTimePrev = sum(stagesPrev.map((r) => r.onTime))
  const onTimeRate = doneTotal ? onTimeTotal / doneTotal : null
  const onTimeRatePrev = donePrev ? onTimePrev / donePrev : null
  const st = S?.totals || { cur: {}, prev: {} }

  const dimmed = loading ? ' viz-refetch' : ''
  const prevSub = prv.map((k) => monthShort(k))

  return (
    <div className={`analytics${dimmed}`} aria-busy={loading}>
      {error && <ErrorState message={error} onRetry={reload} />}

      {/* KPI summary */}
      <div className="kpi-grid">
        {B && (
          <KpiCard label="Billed revenue" icon={DollarSign} value={money0(revTotal)}
            delta={<Delta cur={revTotal} prev={revPrevTotal} suffix={cmpShort} />}
            spark={revCur} sparkLabel="Monthly billed revenue trend"
            foot={`${num(bt.cur.bills)} invoices · ${num(bt.cur.lots)} lots billed`}
            onClick={() => nav(`/insights/billing?${rangeQs}`)} />
        )}
        {B && (
          <KpiCard label="Average invoice" icon={Receipt} value={money0(avgInv)}
            delta={<Delta cur={avgInv} prev={avgInvPrev} suffix={cmpShort} />}
            spark={cur.map((_, i) => (billsCur[i] ? revCur[i] / billsCur[i] : 0))} sparkLabel="Average invoice value by month"
            foot={`${num(bt.cur.customers)} customers billed`} />
        )}
        {L && (
          <KpiCard label="Piece-rate labor paid" icon={Wallet} value={money0(pieceTotal)}
            delta={<Delta cur={pieceTotal} prev={piecePrevTotal} goodUp={false} suffix={cmpShort} />}
            spark={pieceCur} sparkLabel="Piece-rate labor by month"
            foot={`${num(lt.cur.payrolls)} pay dates · ${num(lt.cur.lots)} lots worked`} />
        )}
        {B && L && (
          <KpiCard label="Labor as % of billing" icon={Percent} value={pct(ratio)}
            delta={<Delta cur={ratio} prev={ratioPrev} points goodUp={false} suffix={cmpShort} />}
            spark={ratioSpark} sparkLabel="Piece labor as a share of billing by month"
            foot="Piece-rate pay ÷ billed revenue (lower is better)" />
        )}
        {L && (
          <KpiCard label="Labor hours" icon={Clock} value={`${num(hoursTotal)} h`}
            delta={<Delta cur={hoursTotal} prev={hoursPrevTotal} suffix={cmpShort} />}
            spark={hoursCur} sparkLabel="Labor hours by month"
            foot={`${num(lt.cur.employees)} employees paid${lt.prev.employees != null ? ` (${num(lt.prev.employees)} before)` : ''}`} />
        )}
        {S && (
          <KpiCard label="On-time stage completion" icon={CalendarCheck2} value={pct(onTimeRate)}
            delta={<Delta cur={onTimeRate} prev={onTimeRatePrev} points suffix={cmpShort} />}
            spark={stagesCur.map((r) => (r.completed ? r.onTime / r.completed : 0))} sparkLabel="On-time completion rate by month"
            foot={`${num(doneTotal)} stages completed${st.cur.avgDaysLate ? ` · late ones avg ${st.cur.avgDaysLate.toFixed(0)} days` : ''}`}
            onClick={can('SC') ? () => nav('/sc') : undefined} />
        )}
      </div>

      {!B && !L && !S && <EmptyState icon={BarChart3} title="No reporting modules">Billing, payroll or scheduling access is needed for the reporting charts.</EmptyState>}

      <div className="viz-grid">
        {/* Revenue trend */}
        {B && (
          <Panel className="span-2" title="Revenue trend" icon={TrendingUp}
            sub={`Billed revenue by month · ${rangeLabel(cur)} compared with ${rangeLabel(prv)}`}
            action={<ChartToggle table={tableOf('rev')} onChange={setTable('rev')} />}>
            <div className="viz-summary">
              <div><span>Period total</span><b>{money0(revTotal)}</b><Delta cur={revTotal} prev={revPrevTotal} suffix="" /></div>
              <div><span>{cmpName}</span><b>{money0(revPrevTotal)}</b></div>
              <div><span>Monthly average</span><b>{money0(revTotal / cur.length)}</b></div>
              <div><span>Best month</span><b>{(() => { const i = revCur.indexOf(Math.max(...revCur)); return revCur[i] ? `${cats[i].short.replace(/ '.*/, '')} · ${moneyCompact(revCur[i])}` : '—' })()}</b></div>
            </div>
            {tableOf('rev') ? (
              <DataTable onRowClick={(r) => nav(`/insights/billing?month=${r.key}`)}
                columns={[
                  { key: 'label', label: 'Month' }, { key: 'bills', label: 'Invoices', num: true, format: num },
                  { key: 'cur', label: 'Billed', num: true, format: money0 }, { key: 'prevLabel', label: 'Compared month' },
                  { key: 'prev', label: 'Compared billed', num: true, format: money0 },
                  { key: 'ch', label: 'Change', num: true, format: (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`) },
                ]}
                rows={cats.map((c, i) => ({ key: c.key, label: c.label, bills: billsCur[i], cur: revCur[i], prevLabel: monthLong(prv[i]), prev: revPrev[i], ch: revPrev[i] ? (revCur[i] - revPrev[i]) / revPrev[i] : null }))} />
            ) : (
              <>
                <div className="viz-legend-row">
                  <ul className="viz-legend">
                    <li><i className="viz-key line" style={{ background: SLOT(0) }} />This period ({rangeLabel(cur)})</li>
                    <li><i className="viz-key line" style={{ background: PREV_COLOR }} />{cmpName} ({rangeLabel(prv)})</li>
                  </ul>
                </div>
                <LineChart categories={cats} format={money0} ariaLabel="Billed revenue by month, this period and comparison period"
                  series={[
                    { key: 'cur', name: 'This period', color: SLOT(0), values: revCur, area: true },
                    { key: 'prev', name: 'Comparison', color: PREV_COLOR, values: revPrev, sub: prevSub },
                  ]}
                  onPointClick={(i) => nav(`/insights/billing?month=${cur[i]}`)} clickHint="Click to open that month's invoices" />
              </>
            )}
            {divItems.length > 1 && (
              <div className="viz-foot">
                <span className="viz-foot-label">Revenue by division</span>
                <SegmentedBar items={divItems} format={moneyCompact} />
              </div>
            )}
          </Panel>
        )}

        {/* Top customers */}
        {B && (
          <Panel title="Top customers" icon={Users} sub={`Billed this period vs ${a.compare === 'yoy' ? 'same period last year' : 'previous period'}`}
            action={<ChartToggle table={tableOf('cust')} onChange={setTable('cust')} />}>
            {!B.customers?.length ? <EmptyState title="No billing in this period" /> : tableOf('cust') ? (
              <DataTable onRowClick={(r) => !r.other && nav(`/insights/billing?search=${encodeURIComponent(r.name)}&${rangeQs}`)}
                columns={[
                  { key: 'name', label: 'Customer' }, { key: 'bills', label: 'Invoices', num: true, format: num },
                  { key: 'cur', label: 'This period', num: true, format: money0 }, { key: 'prev', label: 'Comparison', num: true, format: money0 },
                  { key: 'share', label: 'Share', num: true, format: (v) => pct(v) },
                ]}
                rows={B.customers.map((c) => ({ ...c, share: revTotal ? c.cur / revTotal : null }))} />
            ) : (
              <CompareBars rows={B.customers} format={moneyCompact} curLabel="This period" prevLabel={cmpName}
                onRowClick={(r) => nav(`/insights/billing?search=${encodeURIComponent(r.name)}&${rangeQs}`)} />
            )}
            {B.customers?.length > 0 && (() => {
              const named = B.customers.filter((c) => !c.other)
              const top = named[0]
              const newOnes = named.filter((c) => c.cur > 0 && !c.prev).length
              return (
                <div className="cust-insight">
                  <div><span>Largest customer share</span><b>{revTotal && top ? pct(top.cur / revTotal, 0) : '—'}</b></div>
                  <div><span>Customers billed</span><b>{num(bt.cur.customers)}</b><Delta cur={bt.cur.customers} prev={bt.prev.customers} suffix="" /></div>
                  <div><span>New vs comparison</span><b>{num(newOnes)}</b></div>
                </div>
              )
            })()}
          </Panel>
        )}

        {/* Labor hours by work type */}
        {L && (
          <Panel className="span-2" title="Labor hours by work type" icon={HardHat}
            sub={`Hours on posted payroll per month · ${rangeLabel(cur)}`}
            action={<ChartToggle table={tableOf('hrs')} onChange={setTable('hrs')} />}>
            {!hoursTotal ? <EmptyState title="No labor paid in this period" /> : tableOf('hrs') ? (
              <DataTable
                columns={[{ key: 'label', label: 'Month' }, ...workTypes.map((w) => ({ key: w, label: w, num: true, format: num })), { key: 'total', label: 'Total hours', num: true, format: num }, { key: 'piece', label: 'Piece pay', num: true, format: money0 }]}
                rows={cats.map((c, i) => ({ label: c.label, ...Object.fromEntries(workTypes.map((w) => [w, laborCell(c.key, w, 'hours')])), total: hoursCur[i], piece: pieceCur[i] }))} />
            ) : (
              <>
                <div className="viz-legend-row">
                  <ul className="viz-legend">{workTypes.map((w) => <li key={w}><i className="viz-key rect" style={{ background: wtColor[w] }} />{w} · {num(hoursByType.find((h) => h.name === w)?.value)} h</li>)}</ul>
                </div>
                <StackedColumns categories={cats} format={(v) => `${num(v)} h`} ariaLabel="Labor hours by work type per month" totalLabel="Total hours"
                  series={workTypes.map((w) => ({ key: w, name: w, color: wtColor[w] }))}
                  value={(i, w) => laborCell(cur[i], w, 'hours')}
                  extraRows={(i) => [{ label: 'Piece pay', value: money0(pieceCur[i]) }]} />
              </>
            )}
          </Panel>
        )}

        {/* Labor pay mix */}
        {L && (
          <Panel title="Piece pay by work type" icon={Gauge} sub={`Share of piece-rate pay · ${rangeLabel(cur)}`}
            action={<ChartToggle table={tableOf('mix')} onChange={setTable('mix')} />}>
            {!pieceTotal ? <EmptyState title="No piece-rate pay in this period" /> : tableOf('mix') ? (
              <DataTable columns={[{ key: 'name', label: 'Work type' }, { key: 'value', label: 'Piece pay', num: true, format: money0 }, { key: 'hours', label: 'Hours', num: true, format: num }, { key: 'share', label: 'Share of pay', num: true, format: (v) => pct(v) }]}
                rows={pieceByType.map((p) => ({ ...p, hours: hoursByType.find((h) => h.name === p.name)?.value, share: pieceTotal ? p.value / pieceTotal : null }))} />
            ) : (
              <Donut items={pieceByType} format={moneyCompact} centerLabel="Piece pay" />
            )}
          </Panel>
        )}

        {/* Schedule performance */}
        {S && (
          <Panel className="span-3" title="Stage completions" icon={CalendarCheck2}
            sub="Schedule stages posted complete per month, on or before the delivery date vs late"
            action={<ChartToggle table={tableOf('stg')} onChange={setTable('stg')} />}>
            <div className="viz-summary">
              <div><span>Completed</span><b>{num(doneTotal)}</b><Delta cur={doneTotal} prev={donePrev} suffix="" /></div>
              <div><span>On time</span><b>{num(onTimeTotal)}</b></div>
              <div><span>Late</span><b>{num(doneTotal - onTimeTotal)}</b></div>
              <div><span>On-time rate</span><b>{pct(onTimeRate)}</b><Delta cur={onTimeRate} prev={onTimeRatePrev} points suffix="" /></div>
            </div>
            {!doneTotal ? <EmptyState title="No stages completed in this period" /> : tableOf('stg') ? (
              <DataTable columns={[{ key: 'label', label: 'Month' }, { key: 'completed', label: 'Completed', num: true, format: num }, { key: 'onTime', label: 'On time', num: true, format: num }, { key: 'late', label: 'Late', num: true, format: num }, { key: 'rate', label: 'On-time rate', num: true, format: (v) => pct(v) }]}
                rows={cats.map((c, i) => ({ label: c.label, completed: stagesCur[i].completed, onTime: stagesCur[i].onTime, late: stagesCur[i].completed - stagesCur[i].onTime, rate: stagesCur[i].completed ? stagesCur[i].onTime / stagesCur[i].completed : null }))} />
            ) : (
              <>
                <div className="viz-legend-row">
                  <ul className="viz-legend">
                    <li><i className="viz-key rect" style={{ background: GOOD_COLOR }} />On time</li>
                    <li><i className="viz-key rect" style={{ background: CRIT_COLOR }} />Late</li>
                  </ul>
                </div>
                <StackedColumns categories={cats} height={220} ariaLabel="Stages completed per month, on time and late" totalLabel="Completed"
                  series={[{ key: 'onTime', name: 'On time', color: GOOD_COLOR }, { key: 'late', name: 'Late', color: CRIT_COLOR }]}
                  value={(i, k) => (k === 'onTime' ? stagesCur[i].onTime : stagesCur[i].completed - stagesCur[i].onTime)}
                  extraRows={(i) => [{ label: 'On-time rate', value: stagesCur[i].completed ? pct(stagesCur[i].onTime / stagesCur[i].completed, 0) : '—' }]}
                  onColumnClick={can('SC') ? () => nav('/sc') : undefined} />
              </>
            )}
          </Panel>
        )}
      </div>
    </div>
  )
}
