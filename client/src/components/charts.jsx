// Dashboard chart kit (SVG, no libraries). Every chart:
// - draws at the container's real pixel width (fluid), so text keeps its size on wide screens,
// - has a hover/focus tooltip, a legend for 2+ series, and a table twin (pass showTable),
// - colors marks by series identity (fixed slot order, never by rank) and keeps all text in text tokens.
// Palette slots are CSS variables (--series-1..6, --series-prev, --status-good/critical) in index.css.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import Grid from './Grid'

export const SLOT = (i) => `var(--series-${(i % 6) + 1})`
export const PREV_COLOR = 'var(--series-prev)'
export const GOOD_COLOR = 'var(--status-good)'
export const CRIT_COLOR = 'var(--status-critical)'

export const compact = (v) => {
  const a = Math.abs(v)
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${Math.round(v / 1e3)}K`
  if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}K`
  return `${Math.round(v * 10) / 10}`
}
export const money0 = (v) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))
export const moneyCompact = (v) => (v == null ? '—' : `$${compact(v)}`)
export const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }))
export const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`)

function useWidth(fallback = 640) {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w || fallback]
}

function niceScale(maxValue, count = 4) {
  const m = Math.max(0, maxValue)
  if (!m) return { ticks: [0, 1], max: 1 }
  const raw = m / count, mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw)
  const top = Math.ceil(m / step) * step
  return { ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step), max: top }
}

// Rounded data-end (top) column path, square at the baseline.
function colPath(x, w, yTop, yBase, r = 4) {
  const h = yBase - yTop
  if (h <= 0) return ''
  const rr = Math.min(r, h, w / 2)
  return `M${x},${yBase} L${x},${yTop + rr} Q${x},${yTop} ${x + rr},${yTop} L${x + w - rr},${yTop} Q${x + w},${yTop} ${x + w},${yTop + rr} L${x + w},${yBase} Z`
}

function Tooltip({ x, width, title, rows, hint }) {
  // keep the tooltip inside the chart box
  const left = Math.max(90, Math.min(width - 90, x))
  return (
    <div className="chart-tip" style={{ left }}>
      <div className="chart-tip-title">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="chart-tip-row">
          <span>{r.color && <i className={`tip-key ${r.mark || 'line'}`} style={{ background: r.color }} />}{r.label}</span>
          <b>{r.value}</b>
        </div>
      ))}
      {hint && <div className="chart-tip-hint">{hint}</div>}
    </div>
  )
}

export function Legend({ items }) {
  return (
    <ul className="viz-legend">
      {items.map((it) => (
        <li key={it.label}><i className={`viz-key ${it.mark || 'rect'}`} style={{ background: it.color }} />{it.label}</li>
      ))}
    </ul>
  )
}

/** Signed change vs comparison. goodUp=false flips which direction is good (e.g. cost ratio). */
export function Delta({ cur, prev, goodUp = true, points = false, suffix = 'vs comparison' }) {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return <span className="delta flat"><Minus size={12} /> No comparison data</span>
  let change, text
  if (points) { change = cur - prev; text = `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)} pts` }
  else {
    if (!prev) return <span className="delta flat">New this period {suffix && <span className="delta-sfx">· nothing in comparison</span>}</span>
    change = (cur - prev) / Math.abs(prev); text = `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`
  }
  const flat = Math.abs(change) < 0.0005
  const good = flat ? null : (change > 0) === goodUp
  const Icon = flat ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`delta ${flat ? 'flat' : good ? 'good' : 'bad'}`}>
      <Icon size={13} />{text}{suffix && <span className="delta-sfx"> {suffix}</span>}
    </span>
  )
}

/** Small trend line for KPI cards: de-emphasis gray line with the current window's last point in the accent. */
export function Sparkline({ values, height = 34, label }) {
  const [ref, W] = useWidth(160)
  const vals = values.map((v) => v || 0)
  const max = Math.max(...vals, 0), min = Math.min(...vals, 0)
  const span = max - min || 1
  const pad = 4
  const x = (i) => pad + (i * (W - pad * 2)) / Math.max(1, vals.length - 1)
  const y = (v) => pad + (height - pad * 2) * (1 - (v - min) / span)
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${d} L${x(vals.length - 1)},${height - pad} L${x(0)},${height - pad} Z`
  return (
    <div ref={ref} className="spark" aria-hidden={!label}>
      {vals.length > 1 && (
        <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
          <path d={area} className="spark-area" />
          <path d={d} className="spark-line" />
          <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r={3.5} className="spark-dot" />
        </svg>
      )}
    </div>
  )
}

/**
 * Multi-series line chart over shared x categories. series: [{ key, name, color, values[], area?, sub[] (per-point note) }].
 * One crosshair finds the X; the tooltip lists every series at that X. Single y axis.
 */
export function LineChart({ categories, series, format = num, height = 260, onPointClick, ariaLabel, clickHint }) {
  const [ref, W] = useWidth()
  const [hover, setHover] = useState(null)
  const padL = 52, padR = 64, padT = 16, padB = 28
  const innerW = Math.max(10, W - padL - padR), innerH = height - padT - padB
  const all = series.flatMap((s) => s.values.map((v) => v || 0))
  const { ticks, max } = useMemo(() => niceScale(Math.max(0, ...all)), [all.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const n = categories.length
  const x = (i) => padL + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1))
  const y = (v) => padT + innerH - ((v || 0) / max) * innerH
  const base = padT + innerH
  const every = Math.ceil(n / Math.max(1, Math.floor(innerW / 54)))

  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const i = n <= 1 ? 0 : Math.round(((px - padL) / innerW) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  const main = series[0]
  const last = n - 1

  return (
    <div className="chart-wrap" ref={ref}>
      <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} className="chart" role="img" aria-label={ariaLabel}
        onPointerMove={pick} onPointerLeave={() => setHover(null)}
        onClick={onPointClick && hover != null ? () => onPointClick(hover) : undefined}
        style={onPointClick ? { cursor: 'pointer' } : undefined}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis tabular">{compact(t)}</text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={base} y2={base} className="chart-baseline" />
        {categories.map((c, i) => (i % every === 0 || (i === last && last % every >= every / 2)) && (
          <text key={c.key} x={x(i)} y={height - 8} textAnchor="middle" className="chart-axis">{c.short}</text>
        ))}
        {/* draw the comparison first so the current series sits on top */}
        {[...series].reverse().map((s) => {
          const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
          return (
            <g key={s.key}>
              {s.area && n > 1 && <path d={`${d} L${x(last)},${base} L${x(0)},${base} Z`} style={{ fill: s.color }} className="viz-area" />}
              <path d={d} style={{ stroke: s.color }} className="viz-line" />
            </g>
          )
        })}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={base} className="viz-cross" />}
        {series.map((s) => {
          const i = hover ?? last
          return <circle key={s.key} cx={x(i)} cy={y(s.values[i])} r={4} style={{ fill: s.color }} className="viz-dot" />
        })}
        {/* direct label: the current series' latest value */}
        {main && n > 0 && <text x={x(last) + 8} y={y(main.values[last])} dy="0.32em" className="chart-value">{compact(main.values[last] || 0)}</text>}
        {/* keyboard access: one focus stop per x */}
        {categories.map((c, i) => (
          <rect key={c.key} x={x(i) - innerW / Math.max(1, n - 1) / 2} y={padT} width={Math.max(8, innerW / Math.max(1, n - 1))} height={innerH}
            fill="transparent" tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            onKeyDown={onPointClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onPointClick(i) : undefined}
            aria-label={`${c.label}: ${series.map((s) => `${s.name} ${format(s.values[i] || 0)}`).join(', ')}`} />
        ))}
      </svg>
      {hover != null && (
        <Tooltip x={x(hover)} width={W} title={categories[hover].label}
          rows={series.map((s) => ({ label: s.sub?.[hover] ? `${s.name} (${s.sub[hover]})` : s.name, value: format(s.values[hover] || 0), color: s.color }))}
          hint={onPointClick ? clickHint || 'Click to open details' : null} />
      )}
    </div>
  )
}

/**
 * Stacked columns. categories: [{ key, label, short }]; series: [{ key, name, color }]; value(catIndex, seriesKey).
 * 2px surface gap between segments; only the top segment gets the rounded data-end.
 */
export function StackedColumns({ categories, series, value, format = num, height = 250, onColumnClick, ariaLabel, totalLabel = 'Total', extraRows, grouped = false }) {
  const [ref, W] = useWidth()
  const [hover, setHover] = useState(null)
  const padL = 48, padR = 12, padT = 18, padB = 28
  const innerW = Math.max(10, W - padL - padR), innerH = height - padT - padB
  // Negative values are never stacked or drawn (columns grow up from one baseline); totals add positives only.
  const pos = (i, k) => Math.max(0, value(i, k) || 0)
  const totals = categories.map((_, i) => series.reduce((t, s) => t + pos(i, s.key), 0))
  const peak = grouped ? Math.max(0, ...categories.flatMap((_, i) => series.map((s) => pos(i, s.key)))) : Math.max(0, ...totals)
  const { ticks, max } = niceScale(peak)
  const n = categories.length
  const slot = innerW / Math.max(1, n)
  const bw = grouped ? Math.min(14, (slot * 0.8) / Math.max(1, series.length) - 2) : Math.min(24, slot * 0.62)
  const y = (v) => padT + innerH - (v / max) * innerH
  const base = padT + innerH
  const every = Math.ceil(n / Math.max(1, Math.floor(innerW / 44)))
  const GAP = 2

  return (
    <div className="chart-wrap" ref={ref}>
      <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} className="chart" role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis tabular">{compact(t)}</text>
          </g>
        ))}
        {categories.map((c, i) => {
          const cx = padL + slot * i + slot / 2
          const x0 = cx - bw / 2
          let acc = 0
          const segs = series.map((s) => ({ s, v: pos(i, s.key) })).filter((g) => g.v > 0)
          // grouped: one column per series side by side, each from the baseline, 2px apart
          const groupW = series.length * bw + (series.length - 1) * GAP
          return (
            <g key={c.key} className={hover != null && hover !== i ? 'viz-dim' : ''}>
              {grouped && series.map((s, k) => {
                const v = pos(i, s.key)
                if (!v) return null
                const gx = cx - groupW / 2 + k * (bw + GAP)
                return <path key={s.key} d={colPath(gx, Math.max(1, bw), y(v), base)} style={{ fill: s.color }} />
              })}
              {!grouped && segs.map((g, k) => {
                const yBot = y(acc), yTop = y(acc + g.v)
                acc += g.v
                const isTop = k === segs.length - 1
                // gap: trim 2px off the bottom of every segment above the first
                const bottom = k === 0 ? yBot : yBot - GAP
                if (bottom - yTop <= 0.5) return null
                return isTop
                  ? <path key={g.s.key} d={colPath(x0, bw, yTop, bottom)} style={{ fill: g.s.color }} />
                  : <rect key={g.s.key} x={x0} y={yTop} width={bw} height={bottom - yTop} style={{ fill: g.s.color }} />
              })}
              {(i % every === 0 || (i === n - 1 && (n - 1) % every >= every / 2)) && <text x={cx} y={height - 8} textAnchor="middle" className="chart-axis">{c.short}</text>}
              <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill="transparent" tabIndex={0}
                onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                onClick={onColumnClick ? () => onColumnClick(i) : undefined}
                onKeyDown={onColumnClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onColumnClick(i) : undefined}
                style={onColumnClick ? { cursor: 'pointer' } : undefined}
                aria-label={`${c.label}: ${series.map((s) => `${s.name} ${format(value(i, s.key) || 0)}`).join(', ')}`} />
            </g>
          )
        })}
        <line x1={padL} x2={W - padR} y1={base} y2={base} className="chart-baseline" />
      </svg>
      {hover != null && (
        <Tooltip x={padL + slot * hover + slot / 2} width={W} title={categories[hover].label}
          rows={[
            { label: totalLabel, value: format(totals[hover]) },
            ...[...series].reverse().map((s) => ({ label: s.name, value: format(value(hover, s.key) || 0), color: s.color, mark: 'rect' })),
            ...(extraRows ? extraRows(hover) : []),
          ]}
          hint={onColumnClick ? 'Click to open details' : null} />
      )}
    </div>
  )
}

/** Ranked horizontal bars (current period) with a tick for the comparison period. rows: [{ name, cur, prev, other? }] */
export function CompareBars({ rows, format = money0, onRowClick, curLabel = 'This period', prevLabel = 'Comparison' }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.cur || 0, r.prev || 0]))
  return (
    <div className="cbars">
      <Legend items={[{ label: curLabel, color: SLOT(0) }, { label: prevLabel, color: 'var(--text-2)', mark: 'tick' }]} />
      <ul>
        {rows.map((r) => {
          const ch = r.prev ? (r.cur - r.prev) / r.prev : null
          const clickable = onRowClick && !r.other
          const Tag = clickable ? 'button' : 'div'
          return (
            <li key={r.name}>
              <Tag type={clickable ? 'button' : undefined} className={`cbar${clickable ? ' clickable' : ''}`} onClick={clickable ? () => onRowClick(r) : undefined}
                title={`${r.name}: ${format(r.cur)} · ${prevLabel.toLowerCase()} ${format(r.prev)}`}>
                <span className="cbar-name">{r.name}</span>
                <span className="cbar-track">
                  {r.cur > 0 && <span className="cbar-fill" style={{ width: `${(r.cur / max) * 100}%`, background: r.other ? 'var(--series-prev)' : SLOT(0) }} />}
                  {r.prev > 0 && <span className="cbar-prev" style={{ left: `calc(${(r.prev / max) * 100}% - 1px)` }} />}
                </span>
                <span className="cbar-val tabular">{format(r.cur)}</span>
                <span className={`cbar-ch tabular ${ch == null ? 'flat' : ch >= 0 ? 'good' : 'bad'}`}>
                  {ch == null ? (r.cur ? 'new' : '—') : `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch * 100).toFixed(0)}%`}
                </span>
              </Tag>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Donut for part-to-whole at a glance (≤ 6 parts). items: [{ name, value, color }]. Legend lists name, value and share. */
export function Donut({ items, format = money0, centerLabel = 'Total', size = 168, onItemClick }) {
  const [hover, setHover] = useState(null)
  const parts = items.filter((it) => it.value > 0)
  const total = parts.reduce((t, it) => t + it.value, 0)
  const R = size / 2, r = R - 22
  let a0 = -Math.PI / 2
  const arcs = parts.map((it) => {
    const a = (it.value / total) * Math.PI * 2
    const s = { it, start: a0, end: a0 + a }
    a0 += a
    return s
  })
  const arcPath = (start, end) => {
    const large = end - start > Math.PI ? 1 : 0
    const p = (ang, rad) => `${R + rad * Math.cos(ang)},${R + rad * Math.sin(ang)}`
    if (end - start >= Math.PI * 2 - 1e-6) end = start + Math.PI * 2 - 1e-4
    return `M${p(start, R - 2)} A${R - 2},${R - 2} 0 ${large} 1 ${p(end, R - 2)} L${p(end, r)} A${r},${r} 0 ${large} 0 ${p(start, r)} Z`
  }
  const h = hover != null ? parts[hover] : null
  return (
    <div className="donut">
      <div className="donut-fig">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
          aria-label={parts.map((it) => `${it.name} ${format(it.value)} (${pct(it.value / total)})`).join(', ')} onPointerLeave={() => setHover(null)}>
          {arcs.map((s, i) => (
            <path key={s.it.name} d={arcPath(s.start, s.end)} style={{ fill: s.it.color }}
              className={`donut-seg${hover != null && hover !== i ? ' viz-dim' : ''}`}
              onPointerEnter={() => setHover(i)} />
          ))}
        </svg>
        <div className="donut-center">
          <b>{h ? pct(h.value / total, 0) : format(total)}</b>
          <span>{h ? h.name : centerLabel}</span>
        </div>
      </div>
      <ul className="donut-legend">
        {parts.map((it, i) => {
          const Tag = onItemClick && !it.other ? 'button' : 'div'
          return (
            <li key={it.name} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <Tag type={Tag === 'button' ? 'button' : undefined} className={`donut-row${hover === i ? ' on' : ''}`}
                onClick={Tag === 'button' ? () => onItemClick(it) : undefined} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                <i className="viz-key rect" style={{ background: it.color }} />
                <span className="donut-name">{it.name}</span>
                <span className="donut-val tabular">{format(it.value)}</span>
                <span className="donut-pct tabular">{pct(it.value / total, 0)}</span>
              </Tag>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Tall segmented bar: one whole split into parts, with shares printed inside parts wide enough to hold them. */
export function SegmentedBar({ items, format = money0 }) {
  const parts = items.filter((it) => it.value > 0)
  const total = parts.reduce((t, it) => t + it.value, 0)
  if (!total) return null
  return (
    <div className="segbar-wrap">
      <div className="segbar" role="img" aria-label={parts.map((it) => `${it.name} ${format(it.value)} (${pct(it.value / total, 0)})`).join(', ')}>
        {parts.map((it) => {
          const share = it.value / total
          return (
            <span key={it.name} className="segbar-part" style={{ flexGrow: share, background: it.color }} title={`${it.name}: ${format(it.value)} (${pct(share, 0)})`}>
              {share >= 0.08 && <span className={`segbar-lbl${it.darkText ? ' dark' : ''}`}>{pct(share, 0)}</span>}
            </span>
          )
        })}
      </div>
      <Legend items={parts.map((it) => ({ label: `${it.name} · ${format(it.value)}`, color: it.color }))} />
    </div>
  )
}

/** Table twin for any chart. columns: [{ key, label, num?, format? }] */
export function DataTable({ columns, rows, onRowClick }) {
  return (
    <div className="viz-table-wrap">
      <Grid className="grid compact">
        <thead><tr>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={onRowClick ? 'link-row' : ''} onClick={onRowClick ? () => onRowClick(r, i) : undefined}>
              {columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.format ? c.format(r[c.key], r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </Grid>
    </div>
  )
}
