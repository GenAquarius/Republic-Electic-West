// <Grid> — drop-in replacement for <table className="grid ..."> used by every table in the app.
// It reads the table's own <thead>/<tbody> JSX (no data contract needed) and adds, on top of it:
// multi-column sort, global search, multi-condition column filters, client pagination with page sizes,
// column show/hide, drag-and-drop reorder, resize, density, saved views (per user), row selection with bulk
// actions, a right-click row menu, permission-based column visibility, and export (Excel, CSV, PDF) of all
// filtered rows in the chosen columns. Sticky header, horizontal scroll and row hover come from CSS.
//
// Safety rules, decided per table from its JSX:
// - Header cells with their own onClick (server-side sort) keep it; the grid doesn't client-sort those columns.
// - Tables with input controls in rows (editable grids) or group/sub-header rows keep their row order:
//   no sort/filter/paging/selection, column features only.
// - Tables with grouped headers (colSpan / several header rows) or custom row components render as before,
//   with export and density only.
// - serverPaged: the page has its own server pager; the grid doesn't paginate and its search/filters apply to
//   the loaded page. exportAll (optional) fetches every filtered record for export.
// - Print pages (/print, /ticket, /pick) never paginate.
import { Children, Fragment, cloneElement, isValidElement, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  ArrowDown, ArrowUp, Bookmark, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Columns3, Copy, Download,
  Eye, EyeOff, FileSpreadsheet, FileText, Filter, GripVertical, MoreHorizontal, Plus, RotateCcw, Rows3, Search, Trash2, X,
} from 'lucide-react'
import { session } from '../api'
import { asNumber, exportCsv, exportPdf, exportXlsx } from './gridExport'
import { columnAllowed } from './columnPolicy'

const PAGE_SIZES = [10, 25, 50, 100]
const OPS = [
  ['contains', 'contains'], ['not_contains', 'does not contain'], ['equals', 'equals'], ['not_equals', 'does not equal'],
  ['starts', 'starts with'], ['ends', 'ends with'], ['gt', 'greater than'], ['lt', 'less than'], ['between', 'between'],
  ['empty', 'is empty'], ['not_empty', 'is not empty'],
]
const NO_VALUE = new Set(['empty', 'not_empty'])

// ---------------------------------------------------------------------------
// JSX helpers
// ---------------------------------------------------------------------------
const flat = (children) => Children.toArray(children).flatMap((c) => (isValidElement(c) && c.type === Fragment ? flat(c.props.children) : [c]))
const isEl = (e, ...types) => isValidElement(e) && types.includes(e.type)

function textOf(n) {
  if (n == null || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  if (!isValidElement(n)) return ''
  const p = n.props || {}
  if (n.type === 'input') return p.type === 'checkbox' ? (p.checked ? 'Yes' : 'No') : String(p.value ?? p.defaultValue ?? '')
  if (n.type === 'select' || n.type === 'textarea') return String(p.value ?? p.defaultValue ?? '')
  if (n.type === 'br') return ' '
  const t = textOf(p.children)
  if (t || typeof n.type === 'string') return t
  for (const k of ['label', 'value', 'status', 'text', 'title', 'name']) if (typeof p[k] === 'string' || typeof p[k] === 'number') return String(p[k])
  return ''
}
function hasControls(n) {
  if (Array.isArray(n)) return n.some(hasControls)
  if (!isValidElement(n)) return false
  if (n.type === 'input' || n.type === 'select' || n.type === 'textarea') return true
  const name = typeof n.type === 'function' ? n.type.displayName || n.type.name || '' : ''
  if (/Select|Picker|Input|Editor|Combo/.test(name)) return true
  return hasControls(n.props?.children)
}
const clean = (s) => String(s).replace(/\s+/g, ' ').trim()

// "$1,234" -> 1234, "3/5/2024" -> time, else lower-case text
function sortKey(t) {
  const n = asNumber(t)
  if (n != null) return { n }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t) || /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m) {
    const d = t.includes('/') ? Date.UTC(+m[3], +m[1] - 1, +m[2]) : Date.UTC(+m[1], +m[2] - 1, +m[3])
    if (!Number.isNaN(d)) return { n: d }
  }
  return { s: t.toLowerCase() }
}
const cmpKeys = (a, b) => {
  const ae = a.s === '' , be = b.s === ''
  if (ae !== be) return ae ? 1 : -1 // blanks last
  if (a.n != null && b.n != null) return a.n - b.n
  if (a.n != null) return -1
  if (b.n != null) return 1
  return (a.s || '').localeCompare(b.s || '', undefined, { numeric: true })
}

function matches(text, f) {
  const t = text.toLowerCase(), v = String(f.v ?? '').toLowerCase()
  switch (f.op) {
    case 'empty': return !text
    case 'not_empty': return !!text
    case 'contains': return !v || t.includes(v)
    case 'not_contains': return !v || !t.includes(v)
    case 'equals': return !v || t === v
    case 'not_equals': return !v || t !== v
    case 'starts': return !v || t.startsWith(v)
    case 'ends': return !v || t.endsWith(v)
    case 'gt': case 'lt': case 'between': {
      if (f.v === '' && f.op !== 'between') return true
      const k = sortKey(text), a = sortKey(String(f.v ?? '')), b = sortKey(String(f.v2 ?? ''))
      if (k.n == null) return false
      if (f.op === 'gt') return a.n == null || k.n > a.n
      if (f.op === 'lt') return a.n == null || k.n < a.n
      return (a.n == null || k.n >= a.n) && (b.n == null || k.n <= b.n)
    }
    default: return true
  }
}

const userKey = () => session.user?.username || 'anon'
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } }
const store = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage blocked */ } }
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) }

// Close a popover on outside click / Escape
function usePopover() {
  const [open, setOpen] = useState(null)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(null) }
    const key = (e) => e.key === 'Escape' && setOpen(null)
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])
  return [open, setOpen, ref]
}

// ---------------------------------------------------------------------------
export default function Grid({ children, className = 'grid', serverPaged = false, exportAll, bulkActions = [], rowActions = [], title, searchable = true, filterable = true, ...rest }) {
  const loc = useLocation()
  const printPage = /\/(print|print-tech|ticket|pick)(\/|$)/.test(loc.pathname)

  // ---- parse the table JSX
  const parsed = useMemo(() => {
    const parts = flat(children)
    const thead = parts.find((e) => isEl(e, 'thead'))
    const tbodies = parts.filter((e) => isEl(e, 'tbody'))
    const tfoot = parts.find((e) => isEl(e, 'tfoot'))
    const caption = parts.find((e) => isEl(e, 'caption'))
    const fallback = { mode: 'wrap', parts }
    if (!thead || tbodies.length !== 1) return fallback
    const headRows = flat(thead.props.children).filter((e) => isEl(e, 'tr'))
    if (headRows.length !== 1) return fallback
    const ths = flat(headRows[0].props.children).filter((e) => isEl(e, 'th', 'td'))
    if (!ths.length || ths.some((th) => (th.props.colSpan || 1) > 1)) return fallback
    const N = ths.length
    const items = flat(tbodies[0].props.children)
    if (items.some((e) => isValidElement(e) && !isEl(e, 'tr'))) return fallback
    const rows = [], special = []
    let grouped = false
    items.forEach((tr, i) => {
      if (!isEl(tr, 'tr')) return
      const cells = flat(tr.props.children).filter((e) => isEl(e, 'td', 'th'))
      if (cells.length === N && cells.every((c) => (c.props.colSpan || 1) === 1)) rows.push({ tr, cells, i })
      else special.push({ tr, cells, i })
    })
    if (rows.length && special.some((s) => s.i < rows[rows.length - 1].i)) grouped = true
    const editable = rows.some((r) => hasControls(r.cells))
    const cols = ths.map((th, i) => ({ i, th, label: clean(textOf(th.props.children)), pageSort: typeof th.props.onClick === 'function' }))
    return { mode: grouped || editable ? 'cols' : 'full', thead, headRow: headRows[0], tbody: tbodies[0], tfoot, caption, cols, rows, special, N, editable, grouped }
  }, [children])

  const full = parsed.mode === 'full'
  const N = parsed.N || 0
  const labels = parsed.cols?.map((c) => c.label) || []
  const tableId = `${loc.pathname.replace(/\/\d+/g, '/#')}|${hash(labels.join('|'))}`
  const prefKey = `sw_grid:${userKey()}:${tableId}`
  const viewsKey = `sw_gridviews:${userKey()}:${tableId}`
  const defaultDensity = /\bcompact\b/.test(className) ? 'compact' : 'comfortable'
  const defaults = { order: Array.from({ length: N }, (_, i) => i), hidden: [], widths: {}, density: defaultDensity, pageSize: 25 }

  const [layout, setLayout] = useState(() => {
    const p = load(prefKey, null)
    return p && Array.isArray(p.order) && p.order.length === N ? { ...defaults, ...p } : defaults
  })
  useEffect(() => { // a different table (route change re-using the component)
    const p = load(prefKey, null)
    setLayout(p && Array.isArray(p.order) && p.order.length === N ? { ...defaults, ...p } : defaults)
  }, [prefKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const saveLayout = (patch) => setLayout((l) => { const n = { ...l, ...patch }; store(prefKey, n); return n })

  const [sorts, setSorts] = useState([])
  const [filters, setFilters] = useState([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(() => new Set())
  const [views, setViews] = useState(() => load(viewsKey, []))
  const [menu, setMenu, menuRef] = usePopover()
  const [ctx, setCtx] = useState(null)
  const [viewName, setViewName] = useState('')
  const [busy, setBusy] = useState('')
  const dragCol = useRef(null)
  const resizing = useRef(false)

  useEffect(() => { setPage(1) }, [search, filters, sorts, layout.pageSize])
  useEffect(() => {
    if (!ctx) return undefined
    const close = () => setCtx(null)
    const key = (e) => e.key === 'Escape' && close()
    window.addEventListener('click', close); window.addEventListener('scroll', close, true); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', key) }
  }, [ctx])

  // ---- passthrough mode: original table + export + density
  if (parsed.mode === 'wrap') {
    return <WrapGrid className={className} rest={rest} parts={parsed.parts} title={title} />
  }

  const allowed = parsed.cols.map((c) => columnAllowed(c.label))
  const visible = layout.order.filter((i) => allowed[i] && !layout.hidden.includes(i))
  const rowOps = full && !printPage
  const selectable = rowOps
  const paginate = rowOps && !serverPaged

  // ---- data rows: text, filter, sort, page
  const data = parsed.rows.map((r, k) => ({ ...r, key: r.tr.key ?? `r${k}`, texts: r.cells.map((c) => clean(textOf(c.props.children))) }))
  const q = search.trim().toLowerCase()
  const activeFilters = filters.filter((f) => f.col != null && (NO_VALUE.has(f.op) || String(f.v ?? '') !== '' || (f.op === 'between' && String(f.v2 ?? '') !== '')))
  let view = rowOps ? data.filter((r) => (!q || visible.some((i) => r.texts[i].toLowerCase().includes(q))) && activeFilters.every((f) => matches(r.texts[f.col] || '', f))) : data
  if (rowOps && sorts.length) {
    const keyed = view.map((r) => ({ r, k: sorts.map((s) => sortKey(r.texts[s.col] || '')) }))
    keyed.sort((a, b) => { for (let j = 0; j < sorts.length; j++) { const c = cmpKeys(a.k[j], b.k[j]); if (c) return sorts[j].dir === 'asc' ? c : -c } return 0 })
    view = keyed.map((x) => x.r)
  }
  const total = view.length
  const pages = paginate ? Math.max(1, Math.ceil(total / layout.pageSize)) : 1
  const curPage = Math.min(page, pages)
  const shown = paginate ? view.slice((curPage - 1) * layout.pageSize, curPage * layout.pageSize) : view
  const filtered = rowOps && (q || activeFilters.length)
  const compactBar = !serverPaged && parsed.rows.length <= 6 && !filtered && !sorts.length

  // ---- helpers
  const exportCols = visible.map((i) => parsed.cols[i].label || `Column ${i + 1}`)
  const rowsFor = (list) => list.map((r) => visible.map((i) => r.texts[i]))
  const pageTitle = title || document.querySelector('.page-head h1')?.textContent || document.title || 'Table'
  const run = async (kind, scope) => {
    setMenu(null)
    let cols = exportCols, rows
    if (scope === 'selected') rows = rowsFor(data.filter((r) => selected.has(r.key)))
    else if (serverPaged && exportAll && scope !== 'page') {
      setBusy('Preparing export…')
      try { const all = await exportAll(); cols = all.columns; rows = all.rows } catch (e) { setBusy(''); alert(`Export failed: ${e.message}`); return }
      setBusy('')
    } else rows = rowsFor(view)
    const sub = scope === 'selected' ? 'Selected rows' : filtered ? 'Filtered' : ''
    if (kind === 'xlsx') exportXlsx(cols, rows, pageTitle)
    else if (kind === 'csv') exportCsv(cols, rows, pageTitle)
    else { setBusy('Building PDF…'); try { await exportPdf(cols, rows, pageTitle, sub) } finally { setBusy('') } }
  }
  const toggleSort = (col, multi) => {
    setSorts((s) => {
      const cur = s.find((x) => x.col === col)
      const next = !cur ? 'asc' : cur.dir === 'asc' ? 'desc' : null
      if (!multi) return next ? [{ col, dir: next }] : []
      const others = s.filter((x) => x.col !== col)
      return next ? (cur ? s.map((x) => (x.col === col ? { col, dir: next } : x)) : [...others, { col, dir: next }]) : others
    })
  }
  const moveCol = (from, to) => {
    if (from === to || from == null) return
    const o = layout.order.filter((i) => i !== from)
    o.splice(o.indexOf(to), 0, from)
    saveLayout({ order: o })
  }
  const startResize = (col) => (e) => {
    e.preventDefault(); e.stopPropagation()
    resizing.current = true
    const th = e.currentTarget.parentElement
    const startX = e.clientX, startW = th.getBoundingClientRect().width
    const move = (ev) => { const w = Math.max(48, Math.round(startW + ev.clientX - startX)); setLayout((l) => ({ ...l, widths: { ...l.widths, [col]: w } })) }
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up)
      setTimeout(() => { resizing.current = false }, 0)
      setLayout((l) => { store(prefKey, l); return l })
    }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
  }
  const widthStyle = (i) => (layout.widths[i] ? { width: layout.widths[i], minWidth: layout.widths[i], maxWidth: layout.widths[i] } : null)
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.key))
  const toggleAll = () => setSelected((s) => { const n = new Set(s); if (allShownSelected) shown.forEach((r) => n.delete(r.key)); else view.forEach((r) => n.add(r.key)); return n })
  const toggleRow = (key) => setSelected((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  const copyText = async (t) => { try { await navigator.clipboard.writeText(t) } catch { /* blocked */ } }
  const saveView = () => {
    const name = viewName.trim(); if (!name) return
    const v = [...views.filter((x) => x.name !== name), { name, state: { layout, sorts, filters, search } }]
    setViews(v); store(viewsKey, v); setViewName('')
  }
  const applyView = (v) => { saveLayout(v.state.layout || defaults); setSorts(v.state.sorts || []); setFilters(v.state.filters || []); setSearch(v.state.search || ''); setMenu(null) }
  const deleteView = (name) => { const v = views.filter((x) => x.name !== name); setViews(v); store(viewsKey, v) }
  const resetAll = () => { saveLayout({ ...defaults }); store(prefKey, null); setSorts([]); setFilters([]); setSearch(''); setMenu(null) }
  const density = layout.density
  const tableClass = `${className.replace(/\bcompact\b/, '').trim()}${density === 'compact' ? ' compact' : ''} g-table`
  const selCols = selectable ? 1 : 0
  const spanAll = visible.length + selCols

  // ---- header
  const headCells = visible.map((i) => {
    const c = parsed.cols[i]
    const s = sorts.findIndex((x) => x.col === i)
    const sortable = rowOps && !c.pageSort && c.label
    const dir = s >= 0 ? sorts[s].dir : null
    return cloneElement(c.th, {
      key: `h${i}`,
      style: { ...(c.th.props.style || {}), ...widthStyle(i) },
      className: [c.th.props.className, sortable && 'g-sortable', dir && 'g-sorted'].filter(Boolean).join(' '),
      'aria-sort': dir ? (dir === 'asc' ? 'ascending' : 'descending') : undefined,
      title: sortable ? 'Click to sort · Shift+click to add a second sort · Drag to move' : c.th.props.title,
      draggable: true,
      onDragStart: (e) => { if (resizing.current) { e.preventDefault(); return } dragCol.current = i; e.dataTransfer.effectAllowed = 'move' },
      onDragOver: (e) => { e.preventDefault(); e.currentTarget.classList.add('g-drop') },
      onDragLeave: (e) => e.currentTarget.classList.remove('g-drop'),
      onDrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('g-drop'); moveCol(dragCol.current, i); dragCol.current = null },
      onClick: c.th.props.onClick || (sortable ? (e) => !resizing.current && toggleSort(i, e.shiftKey) : undefined),
    }, c.th.props.children,
    dir && <span key="s" className="g-sort-ind">{dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{sorts.length > 1 && <sup>{s + 1}</sup>}</span>,
    <span key="r" className="g-resize no-print" onMouseDown={startResize(i)} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => { e.stopPropagation(); const w = { ...layout.widths }; delete w[i]; saveLayout({ widths: w }) }} title="Drag to resize · double-click to reset" />)
  })
  const fixSpan = (tr, cells, key, extra) => {
    if (cells.length === 1 && (cells[0].props.colSpan || 1) >= N) {
      return cloneElement(tr, { key, ...extra }, cloneElement(cells[0], { colSpan: spanAll }))
    }
    if (cells.length === N) {
      return cloneElement(tr, { key, ...extra }, selCols ? <td key="sel" className="g-sel" /> : null, ...visible.map((i) => cloneElement(cells[i], { key: `c${i}`, style: { ...(cells[i].props.style || {}), ...widthStyle(i) } })))
    }
    return cloneElement(tr, { key, ...extra })
  }

  // ---- render
  return (
    <div className={`g-shell${compactBar ? ' g-small' : ''}`}>
      <div className="g-toolbar no-print" ref={menuRef}>
        {rowOps && !compactBar && searchable && (
          <div className="g-search">
            <Search size={14} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={serverPaged ? 'Search this page…' : 'Search table…'} aria-label="Search table" />
            {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={13} /></button>}
          </div>
        )}
        {rowOps && !compactBar && filterable && (
          <button type="button" className={`g-btn${activeFilters.length ? ' on' : ''}`} onClick={() => setMenu(menu === 'filters' ? null : 'filters')} aria-expanded={menu === 'filters'}>
            <Filter size={14} /> Filters{activeFilters.length ? <b className="g-count">{activeFilters.length}</b> : null}
          </button>
        )}
        {rowOps && sorts.length > 0 && !compactBar && (
          <span className="g-chip">Sorted by {sorts.map((s) => `${parsed.cols[s.col].label} ${s.dir === 'asc' ? '↑' : '↓'}`).join(', ')}
            <button type="button" onClick={() => setSorts([])} aria-label="Clear sort"><X size={12} /></button></span>
        )}
        {(filtered || sorts.length > 0) && <button type="button" className="g-btn ghost" onClick={() => { setSearch(''); setFilters([]); setSorts([]) }}><RotateCcw size={13} /> Clear all</button>}
        <span className="g-spacer" />
        {busy && <span className="g-busy">{busy}</span>}
        {!compactBar && (
          <span className="g-meta">
            {serverPaged ? `${total} on this page` : filtered ? `${total} of ${parsed.rows.length} rows` : `${parsed.rows.length} rows`}
          </span>
        )}
        <button type="button" className="g-btn icon" title={density === 'compact' ? 'Comfortable rows' : 'Compact rows'} onClick={() => saveLayout({ density: density === 'compact' ? 'comfortable' : 'compact' })}><Rows3 size={14} /><span className="g-lbl">{density === 'compact' ? 'Compact' : 'Comfortable'}</span></button>
        <button type="button" className="g-btn icon" onClick={() => setMenu(menu === 'cols' ? null : 'cols')} aria-expanded={menu === 'cols'} title="Columns"><Columns3 size={14} /><span className="g-lbl">Columns</span>{layout.hidden.length ? <b className="g-count">{layout.hidden.length} hidden</b> : null}</button>
        <button type="button" className="g-btn icon" onClick={() => setMenu(menu === 'views' ? null : 'views')} aria-expanded={menu === 'views'} title="Saved views"><Bookmark size={14} /><span className="g-lbl">Views</span></button>
        <button type="button" className="g-btn icon" onClick={() => setMenu(menu === 'export' ? null : 'export')} aria-expanded={menu === 'export'} title="Export"><Download size={14} /><span className="g-lbl">Export</span></button>

        {menu === 'filters' && (
          <div className="g-pop g-pop-filters" role="dialog" aria-label="Filters">
            <div className="g-pop-head"><b>Filters</b>{serverPaged && <span className="muted small"> · apply to the rows on this page; use the page's search for all records</span>}</div>
            {filters.length === 0 && <p className="muted small">No filters yet. Every condition must match (AND).</p>}
            {filters.map((f, k) => (
              <div key={k} className="g-frow">
                <select value={f.col ?? ''} onChange={(e) => setFilters((fs) => fs.map((x, j) => (j === k ? { ...x, col: +e.target.value } : x)))} aria-label="Column">
                  {visible.filter((i) => parsed.cols[i].label).map((i) => <option key={i} value={i}>{parsed.cols[i].label}</option>)}
                </select>
                <select value={f.op} onChange={(e) => setFilters((fs) => fs.map((x, j) => (j === k ? { ...x, op: e.target.value } : x)))} aria-label="Condition">
                  {OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {!NO_VALUE.has(f.op) && <input value={f.v ?? ''} onChange={(e) => setFilters((fs) => fs.map((x, j) => (j === k ? { ...x, v: e.target.value } : x)))} placeholder={f.op === 'between' ? 'From' : 'Value'} aria-label="Value" />}
                {f.op === 'between' && <input value={f.v2 ?? ''} onChange={(e) => setFilters((fs) => fs.map((x, j) => (j === k ? { ...x, v2: e.target.value } : x)))} placeholder="To" aria-label="To value" />}
                <button type="button" className="g-btn icon ghost" onClick={() => setFilters((fs) => fs.filter((_, j) => j !== k))} aria-label="Remove condition"><Trash2 size={13} /></button>
              </div>
            ))}
            <div className="g-pop-foot">
              <button type="button" className="g-btn" onClick={() => setFilters((fs) => [...fs, { col: visible.find((i) => parsed.cols[i].label) ?? 0, op: 'contains', v: '' }])}><Plus size={13} /> Add condition</button>
              {filters.length > 0 && <button type="button" className="g-btn ghost" onClick={() => setFilters([])}><RotateCcw size={13} /> Clear filters</button>}
            </div>
          </div>
        )}

        {menu === 'cols' && (
          <div className="g-pop g-pop-cols" role="dialog" aria-label="Columns">
            <div className="g-pop-head"><b>Columns</b><span className="muted small"> · drag to reorder</span></div>
            <ul>
              {layout.order.filter((i) => allowed[i]).map((i) => {
                const hidden = layout.hidden.includes(i)
                return (
                  <li key={i} draggable onDragStart={() => { dragCol.current = i }} onDragOver={(e) => e.preventDefault()} onDrop={() => { moveCol(dragCol.current, i); dragCol.current = null }}>
                    <GripVertical size={13} className="g-grip" />
                    <label>
                      <input type="checkbox" checked={!hidden} disabled={!hidden && visible.length <= 1}
                        onChange={() => saveLayout({ hidden: hidden ? layout.hidden.filter((x) => x !== i) : [...layout.hidden, i] })} />
                      {parsed.cols[i].label || <em className="muted">(actions)</em>}
                    </label>
                    {hidden ? <EyeOff size={13} className="muted" /> : <Eye size={13} className="muted" />}
                  </li>
                )
              })}
            </ul>
            <div className="g-pop-foot">
              <button type="button" className="g-btn ghost" onClick={() => saveLayout({ order: defaults.order, hidden: [], widths: {} })}><RotateCcw size={13} /> Reset to default layout</button>
            </div>
          </div>
        )}

        {menu === 'views' && (
          <div className="g-pop g-pop-views" role="dialog" aria-label="Saved views">
            <div className="g-pop-head"><b>Saved views</b><span className="muted small"> · columns, sort, filters and search</span></div>
            {views.length === 0 && <p className="muted small">No saved views for this table yet.</p>}
            <ul>
              {views.map((v) => (
                <li key={v.name}>
                  <button type="button" className="g-link" onClick={() => applyView(v)}><Bookmark size={13} /> {v.name}</button>
                  <button type="button" className="g-btn icon ghost" onClick={() => deleteView(v.name)} aria-label={`Delete view ${v.name}`}><Trash2 size={13} /></button>
                </li>
              ))}
            </ul>
            <div className="g-frow">
              <input value={viewName} onChange={(e) => setViewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveView()} placeholder="Name this view…" aria-label="View name" />
              <button type="button" className="g-btn" disabled={!viewName.trim()} onClick={saveView}><Check size={13} /> Save</button>
            </div>
            <div className="g-pop-foot"><button type="button" className="g-btn ghost" onClick={resetAll}><RotateCcw size={13} /> Reset everything to default</button></div>
          </div>
        )}

        {menu === 'export' && (
          <div className="g-pop g-pop-export" role="menu">
            <div className="g-pop-head"><b>Export</b><span className="muted small"> · {visible.length} visible columns</span></div>
            {[['xlsx', 'Excel (.xlsx)', FileSpreadsheet], ['csv', 'CSV', FileText], ['pdf', 'PDF', FileText]].map(([k, l, Icon]) => (
              <button key={k} type="button" role="menuitem" onClick={() => run(k)}>
                <Icon size={14} /> {l}
                <span className="muted small">{serverPaged ? (exportAll ? 'all matching records' : 'rows on this page') : filtered ? `${total} filtered rows` : `all ${parsed.rows.length} rows`}</span>
              </button>
            ))}
            {selected.size > 0 && <div className="g-pop-sep" />}
            {selected.size > 0 && [['xlsx', 'Selected rows → Excel'], ['csv', 'Selected rows → CSV'], ['pdf', 'Selected rows → PDF']].map(([k, l]) => (
              <button key={`s${k}`} type="button" role="menuitem" onClick={() => run(k, 'selected')}><Check size={14} /> {l} <span className="muted small">{selected.size} rows</span></button>
            ))}
          </div>
        )}
      </div>

      {selectable && selected.size > 0 && (
        <div className="g-bulk no-print" role="region" aria-label="Bulk actions">
          <b>{selected.size} selected</b>
          <button type="button" className="g-btn" onClick={() => run('xlsx', 'selected')}><FileSpreadsheet size={13} /> Excel</button>
          <button type="button" className="g-btn" onClick={() => run('csv', 'selected')}><FileText size={13} /> CSV</button>
          <button type="button" className="g-btn" onClick={() => run('pdf', 'selected')}><FileText size={13} /> PDF</button>
          <button type="button" className="g-btn" onClick={() => copyText([exportCols.join('\t'), ...rowsFor(data.filter((r) => selected.has(r.key))).map((r) => r.join('\t'))].join('\n'))}><Copy size={13} /> Copy</button>
          {bulkActions.map((a) => <button key={a.label} type="button" className={`g-btn${a.danger ? ' danger' : ''}`} onClick={() => a.onClick([...selected], data.filter((r) => selected.has(r.key)))}>{a.label}</button>)}
          <button type="button" className="g-btn ghost" onClick={() => setSelected(new Set())}><X size={13} /> Clear selection</button>
        </div>
      )}

      <div className={`g-scroll${parsed.rows.length > 15 ? ' g-tall' : ''}`}>
        <table {...rest} className={tableClass}>
          {parsed.caption}
          {cloneElement(parsed.thead, {}, cloneElement(parsed.headRow, { key: 'hr' },
            selCols ? <th key="sel" className="g-sel"><input type="checkbox" checked={allShownSelected} onChange={toggleAll} aria-label="Select all rows" /></th> : null,
            ...headCells))}
          {cloneElement(parsed.tbody, {},
            // grouped / editable tables: every row in its original position (group rows stay with their rows)
            ...(!full ? [...data.map((r) => ({ at: r.i, row: r })), ...parsed.special.map((s, k) => ({ at: s.i, sp: s, k }))].sort((a, b) => a.at - b.at)
              .map((x) => (x.sp ? fixSpan(x.sp.tr, x.sp.cells, `sp${x.k}`)
                : cloneElement(x.row.tr, { key: x.row.key }, ...visible.map((i) => cloneElement(x.row.cells[i], { key: `c${i}`, style: { ...(x.row.cells[i].props.style || {}), ...widthStyle(i) } }))))) : []),
            ...(!full ? [] : shown).map((r) => {
              const isSel = selected.has(r.key)
              return cloneElement(r.tr, {
                key: r.key,
                className: [r.tr.props.className, isSel && 'g-selected'].filter(Boolean).join(' '),
                onContextMenu: (e) => {
                  if (e.target.closest('input, select, textarea, a')) return
                  e.preventDefault()
                  const td = e.target.closest('td'); const cellIdx = td ? [...td.parentElement.children].indexOf(td) - selCols : -1
                  setCtx({ x: e.clientX, y: e.clientY, row: r, rowEl: e.currentTarget, col: cellIdx >= 0 ? visible[cellIdx] : null })
                },
              },
              selCols ? <td key="sel" className="g-sel" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={isSel} onChange={() => toggleRow(r.key)} aria-label="Select row" /></td> : null,
              ...visible.map((i) => cloneElement(r.cells[i], { key: `c${i}`, style: { ...(r.cells[i].props.style || {}), ...widthStyle(i) }, className: [r.cells[i].props.className, layout.widths[i] && 'g-clip'].filter(Boolean).join(' ') || undefined })))
            }),
            ...(parsed.mode === 'full' ? parsed.special.map((s, k) => fixSpan(s.tr, s.cells, `sp${k}`)) : []),
            ...(rowOps && parsed.rows.length > 0 && total === 0 ? [<tr key="g-empty" className="g-empty"><td colSpan={spanAll}><Search size={16} /> No rows match the search or filters. <button type="button" className="g-link" onClick={() => { setSearch(''); setFilters([]) }}>Clear them</button></td></tr>] : []))}
          {parsed.tfoot && cloneElement(parsed.tfoot, {}, ...flat(parsed.tfoot.props.children).map((tr, k) => (isEl(tr, 'tr') ? fixSpan(tr, flat(tr.props.children).filter((e) => isEl(e, 'td', 'th')), `f${k}`) : tr)))}
        </table>
      </div>

      {/* rows of a grouped / editable table keep their order: render them in place with column features only */}
      {paginate && total > PAGE_SIZES[0] && (
        <div className="g-pager no-print">
          <span className="g-meta">Showing {total ? (curPage - 1) * layout.pageSize + 1 : 0}–{Math.min(total, curPage * layout.pageSize)} of {total}{filtered ? ` (filtered from ${parsed.rows.length})` : ''}</span>
          <label className="g-meta">Rows per page
            <select value={layout.pageSize} onChange={(e) => saveLayout({ pageSize: +e.target.value })}>{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <span className="g-spacer" />
          <button type="button" className="g-btn icon" disabled={curPage <= 1} onClick={() => setPage(1)} aria-label="First page"><ChevronsLeft size={14} /></button>
          <button type="button" className="g-btn icon" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
          <span className="g-meta">Page {curPage} of {pages}</span>
          <button type="button" className="g-btn icon" disabled={curPage >= pages} onClick={() => setPage(curPage + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
          <button type="button" className="g-btn icon" disabled={curPage >= pages} onClick={() => setPage(pages)} aria-label="Last page"><ChevronsRight size={14} /></button>
        </div>
      )}

      {ctx && (
        <div className="g-ctx" style={{ left: Math.min(ctx.x, window.innerWidth - 230), top: Math.min(ctx.y, window.innerHeight - 260) }} role="menu" onClick={(e) => e.stopPropagation()}>
          {typeof ctx.row.tr.props.onClick === 'function' && <button role="menuitem" onClick={() => { const el = ctx.rowEl; setCtx(null); el.click() }}><ChevronRight size={14} /> Open</button>}
          {selectable && <button role="menuitem" onClick={() => { toggleRow(ctx.row.key); setCtx(null) }}><Check size={14} /> {selected.has(ctx.row.key) ? 'Unselect row' : 'Select row'}</button>}
          {ctx.col != null && <button role="menuitem" onClick={() => { copyText(ctx.row.texts[ctx.col]); setCtx(null) }}><Copy size={14} /> Copy “{parsed.cols[ctx.col].label || 'cell'}”</button>}
          <button role="menuitem" onClick={() => { copyText(visible.map((i) => ctx.row.texts[i]).join('\t')); setCtx(null) }}><Copy size={14} /> Copy row</button>
          {ctx.col != null && ctx.row.texts[ctx.col] && rowOps && filterable && (
            <button role="menuitem" onClick={() => { setFilters((fs) => [...fs, { col: ctx.col, op: 'equals', v: ctx.row.texts[ctx.col] }]); setCtx(null) }}><Filter size={14} /> Filter to this value</button>
          )}
          {ctx.col != null && rowOps && parsed.cols[ctx.col].label && !parsed.cols[ctx.col].pageSort && (
            <button role="menuitem" onClick={() => { toggleSort(ctx.col, false); setCtx(null) }}><ArrowUp size={14} /> Sort by {parsed.cols[ctx.col].label}</button>
          )}
          {rowActions.map((a) => <button key={a.label} role="menuitem" onClick={() => { setCtx(null); a.onClick(ctx.row.key, ctx.row) }}><MoreHorizontal size={14} /> {a.label}</button>)}
        </div>
      )}
    </div>
  )
}

// Tables the grid can't safely restructure (grouped headers, custom row components): original markup + export/density.
function WrapGrid({ className, rest, parts, title }) {
  const ref = useRef(null)
  const [menu, setMenu, menuRef] = usePopover()
  const [density, setDensity] = useState(/\bcompact\b/.test(className) ? 'compact' : 'comfortable')
  const tableClass = `${className.replace(/\bcompact\b/, '').trim()}${density === 'compact' ? ' compact' : ''} g-table`
  const read = () => {
    const t = ref.current
    const head = [...(t?.tHead?.rows || [])].pop()
    const cols = head ? [...head.cells].map((c) => clean(c.textContent)) : []
    const rows = [...(t?.tBodies?.[0]?.rows || [])].map((r) => [...r.cells].map((c) => clean(c.textContent)))
    return { cols, rows }
  }
  const run = async (kind) => {
    setMenu(null)
    const { cols, rows } = read()
    const name = title || document.querySelector('.page-head h1')?.textContent || 'Table'
    if (kind === 'xlsx') exportXlsx(cols, rows, name)
    else if (kind === 'csv') exportCsv(cols, rows, name)
    else await exportPdf(cols, rows, name)
  }
  return (
    <div className="g-shell g-small">
      <div className="g-toolbar no-print" ref={menuRef}>
        <span className="g-spacer" />
        <button type="button" className="g-btn icon" title={density === 'compact' ? 'Comfortable rows' : 'Compact rows'} onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}><Rows3 size={14} /><span className="g-lbl">{density === 'compact' ? 'Compact' : 'Comfortable'}</span></button>
        <button type="button" className="g-btn icon" onClick={() => setMenu(menu === 'export' ? null : 'export')} title="Export"><Download size={14} /><span className="g-lbl">Export</span></button>
        {menu === 'export' && (
          <div className="g-pop g-pop-export" role="menu">
            {[['xlsx', 'Excel (.xlsx)', FileSpreadsheet], ['csv', 'CSV', FileText], ['pdf', 'PDF', FileText]].map(([k, l, Icon]) => (
              <button key={k} type="button" role="menuitem" onClick={() => run(k)}><Icon size={14} /> {l}</button>
            ))}
          </div>
        )}
      </div>
      <div className="g-scroll"><table {...rest} ref={ref} className={tableClass}>{parts}</table></div>
    </div>
  )
}
