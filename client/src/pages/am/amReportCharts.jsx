// Chart view of the Alarm Monitoring switchboard reports (Reports tab → "Chart" toggle).
// Drawn from the same report response as the table, so both views always show the same numbers.
import { Donut, Legend, SLOT, StackedColumns, money0, num } from '../../components/charts'
import { asNumber } from '../../components/gridExport'
import { HBars } from './aiVisuals'

const monthLabel = (p) => (/^\d{4}-\d{2}$/.test(p) ? new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : p)
const clean = (v, fallback = '(none)') => (v == null || String(v).trim() === '' ? fallback : String(v).replace(/\s+/g, ' ').trim())
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
const money = (v) => asNumber(v) ?? 0

/** Group values into the top `n` keys by total, the rest folded into "Other". */
function topKeys(rows, keyFn, valFn, n = 5) {
  const t = {}
  for (const r of rows) { const k = keyFn(r); t[k] = (t[k] || 0) + valFn(r) }
  const keys = Object.keys(t).sort((a, b) => t[b] - t[a])
  return { keys: keys.length > n ? [...keys.slice(0, n), 'Other'] : keys, totals: t, folded: new Set(keys.slice(n)) }
}

function Tiles({ items }) {
  return (
    <div className="am-chart-tiles">
      {items.map(([label, value, sub]) => <div key={label}><span>{label}</span><b className={String(value).length > 12 && !/^[\d$,.%\s]+$/.test(String(value)) ? 'text' : undefined}>{value}</b>{sub && <em>{sub}</em>}</div>)}
    </div>
  )
}
function Panel({ title, sub, children, wide }) {
  return (
    <section className={`am-chart-panel${wide ? ' wide' : ''}`}>
      <h3>{title}</h3>
      {sub && <p>{sub}</p>}
      {children}
    </section>
  )
}

/** Columns per period, stacked by a category (top 5 + Other), with a legend. */
function StackedByPeriod({ rows, periodKey, catFn, valFn, label, height = 240 }) {
  const periods = [...new Set(rows.map((r) => String(r[periodKey])))].sort()
  const { keys, folded } = topKeys(rows, catFn, valFn)
  const cell = (p, k) => rows.filter((r) => String(r[periodKey]) === p && (k === 'Other' ? folded.has(catFn(r)) : catFn(r) === k)).reduce((t, r) => t + valFn(r), 0)
  const series = keys.map((k, i) => ({ key: k, name: k, color: k === 'Other' ? 'var(--series-prev)' : SLOT(i) }))
  return (
    <>
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />}
      <StackedColumns categories={periods.map((p) => ({ key: p, label: monthLabel(p), short: monthLabel(p) }))} series={series}
        value={(i, k) => cell(periods[i], k)} format={num} totalLabel={label} height={height} ariaLabel={label} />
    </>
  )
}

function donutItems(rows, keyFn, valFn) {
  const { keys, totals, folded } = topKeys(rows, keyFn, valFn)
  return keys.map((k, i) => ({
    name: k, color: k === 'Other' ? 'var(--series-prev)' : SLOT(i), other: k === 'Other',
    value: k === 'Other' ? [...folded].reduce((t, f) => t + totals[f], 0) : totals[k],
  }))
}

export default function AmReportCharts({ rep, d }) {
  const rows = d?.rows || []
  if (!rows.length) return null

  if (rep === 'created' || rep === 'cancelled') {
    const created = rep === 'created'
    const countKey = created ? 'NewAccounts' : 'CancelledAccounts'
    const periodKey = created ? 'PeriodActive' : 'PeriodCancelled'
    const val = (r) => r[countKey] || 0
    const byType = donutItems(rows, (r) => clean(r.MonitoringType), val)
    const periods = [...new Set(rows.map((r) => r[periodKey]))]
    const peak = periods.map((p) => [p, rows.filter((r) => r[periodKey] === p).reduce((t, r) => t + val(r), 0)]).sort((a, b) => b[1] - a[1])[0]
    const reasons = created ? null : topKeys(rows, (r) => clean(r.CancellationReason, '(no reason)'), val, 8)
    const lost = created ? null : (d.accounts || []).reduce((t, a) => t + money(a.MonthlyContractValue), 0)
    return (
      <div className="am-charts">
        <Tiles items={[
          [created ? 'New accounts' : 'Cancelled accounts', num(d.total)],
          ['Months with activity', num(periods.length)],
          ['Busiest month', peak ? monthLabel(peak[0]) : '—', peak ? `${num(peak[1])} accounts` : ''],
          created ? ['Largest type', byType[0]?.name || '—', byType[0] ? `${Math.round((byType[0].value / d.total) * 100)}% of new` : '']
            : ['Monthly revenue lost', money0(lost), 'from these accounts'],
        ]} />
        <div className="am-chart-grid">
          <Panel wide title={`${created ? 'New' : 'Cancelled'} accounts by month`} sub={created ? 'Stacked by monitoring type' : 'Stacked by cancellation reason'}>
            <StackedByPeriod rows={rows} periodKey={periodKey} label={created ? 'New accounts' : 'Cancelled'}
              catFn={created ? (r) => clean(r.MonitoringType) : (r) => clean(r.CancellationReason, '(no reason)')} valFn={val} />
          </Panel>
          <Panel title="Share by monitoring type"><Donut items={byType} format={num} centerLabel={created ? 'New accounts' : 'Cancelled'} /></Panel>
          {reasons && (
            <Panel title="Cancellations by reason">
              <HBars rows={reasons.keys.filter((k) => k !== 'Other').map((k) => ({ label: k, value: reasons.totals[k] }))} format={num} color="var(--status-critical)" />
            </Panel>
          )}
        </div>
      </div>
    )
  }

  if (rep === 'created-year') {
    const years = [...rows].sort((a, b) => String(a.PeriodActive).localeCompare(String(b.PeriodActive)))
    const best = [...years].sort((a, b) => b.NewAccounts - a.NewAccounts)[0]
    return (
      <div className="am-charts">
        <Tiles items={[['New accounts', num(d.total)], ['Years', num(years.length)], ['Best year', best?.PeriodActive || '—', best ? `${num(best.NewAccounts)} accounts` : ''], ['Average per year', num(Math.round(d.total / Math.max(1, years.length)))]]} />
        <div className="am-chart-grid">
          <Panel wide title="New accounts per year" sub={years[0]?.MonitorType || ''}>
            <StackedColumns categories={years.map((r) => ({ key: r.PeriodActive, label: r.PeriodActive, short: r.PeriodActive }))}
              series={[{ key: 'n', name: 'New accounts', color: SLOT(0) }]} value={(i) => years[i].NewAccounts} format={num} totalLabel="New accounts" height={240} ariaLabel="New accounts per year" />
          </Panel>
        </div>
      </div>
    )
  }

  // expiring / expiring-monthly: one row per account
  const expiring = rep === 'expiring'
  const mv = (r) => money(r.MonthlyContractValue)
  const totalValue = rows.reduce((t, r) => t + mv(r), 0)
  const byTerms = donutItems(rows, (r) => clean(r.ContractTerms), () => 1)
  const cities = topKeys(rows, (r) => titleCase(clean(r.ServiceCity)), mv, 10)
  const months = expiring ? [...new Set(rows.map((r) => String(r.FutureExpirationDate).slice(0, 7)))].sort() : []
  const byYear = expiring ? null : topKeys(rows, (r) => (r.ActivationDate ? String(r.ActivationDate).slice(0, 4) : '(none)'), () => 1, 50)
  const years = byYear ? byYear.keys.filter((k) => k !== 'Other').sort() : []
  return (
    <div className="am-charts">
      <Tiles items={[
        [expiring ? 'Contracts expiring' : 'Monthly / N/A contracts', num(rows.length)],
        ['Monthly value', money0(totalValue), expiring ? 'at stake in the period' : 'from these accounts'],
        ['Average per account', money0(totalValue / rows.length)],
        ['Most common terms', byTerms[0]?.name || '—', byTerms[0] ? `${num(byTerms[0].value)} accounts` : ''],
      ]} />
      <div className="am-chart-grid">
        {expiring && (
          <Panel wide title="Contracts expiring by month" sub="Accounts whose contract term ends in each month, with the monthly value">
            <StackedColumns categories={months.map((m) => ({ key: m, label: monthLabel(m), short: monthLabel(m) }))}
              series={[{ key: 'n', name: 'Contracts', color: SLOT(0) }]}
              value={(i) => rows.filter((r) => String(r.FutureExpirationDate).slice(0, 7) === months[i]).length}
              extraRows={(i) => [{ label: 'Monthly value', value: money0(rows.filter((r) => String(r.FutureExpirationDate).slice(0, 7) === months[i]).reduce((t, r) => t + mv(r), 0)) }]}
              format={num} totalLabel="Contracts" height={230} ariaLabel="Contracts expiring by month" />
          </Panel>
        )}
        {!expiring && (
          <Panel wide title="Accounts by activation year">
            <StackedColumns categories={years.map((y) => ({ key: y, label: y, short: y }))} series={[{ key: 'n', name: 'Accounts', color: SLOT(0) }]}
              value={(i) => byYear.totals[years[i]]} format={num} totalLabel="Accounts" height={220} ariaLabel="Accounts by activation year" />
          </Panel>
        )}
        <Panel title="Accounts by contract terms"><Donut items={byTerms} format={num} centerLabel="Accounts" /></Panel>
        <Panel title="Monthly value by city" sub="Top 10 cities">
          <HBars rows={cities.keys.filter((k) => k !== 'Other').map((k) => ({ label: k, value: cities.totals[k] }))} format={money0} />
        </Panel>
      </div>
    </div>
  )
}
