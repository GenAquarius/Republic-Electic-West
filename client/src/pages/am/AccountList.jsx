import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from '../../components/Toast'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import AmTabs from './AmTabs'
import Grid from '../../components/Grid'
import { fetchAllPages } from '../../components/gridExport'

const COLS = [
  { key: 'AccountNumber', label: 'Acct #', sort: 'number' },
  { key: 'CustomerName', label: 'Customer', sort: 'name' },
  { key: 'ServiceStreet', label: 'Service address' },
  { key: 'ServiceCity', label: 'City', sort: 'city' },
  { key: 'PhoneNumber', label: 'Phone' },
  { key: 'MonitoringType', label: 'Monitoring' },
  { key: 'MonthlyContractValue', label: 'Monthly' },
  { key: 'ActivationDate', label: 'Activated', sort: 'activation', date: true },
  { key: 'RenewalDate', label: 'Renewal', sort: 'renewal', date: true },
]

export default function AccountList() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [data, setData] = useState({ rows: [], total: 0, page: 1, pageSize: 25 })
  const [lookups, setLookups] = useState({ monitoringTypes: [] })
  const [search, setSearch] = useState(sp.get('search') || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const params = Object.fromEntries(sp.entries())
  const set = (patch) => setSp({ ...params, page: 1, ...patch })
  // Export: every account matching the current search / status / type filters (live database), not just this page
  const exportAll = async () => {
    const rows = await fetchAllPages((page, pageSize) => api('/am/accounts', { params: { status: 'active', ...params, page, pageSize } }))
    return { columns: COLS.map((c) => c.label), rows: rows.map((r) => COLS.map((c) => (c.date ? fmtDate(r[c.key]) : r[c.key] ?? ''))) }
  }

  useEffect(() => { api('/am/lookups').then(setLookups).catch(() => {}) }, [])

  const [reloadKey, setReloadKey] = useState(0)
  const [confirm, setConfirm] = useState(null) // account row awaiting delete confirmation
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setLoading(true)
    api('/am/accounts', { params: { status: 'active', ...params } })
      .then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString(), reloadKey])

  // Delete from the list (same API as the account screen: removes the account, its call list and zones)
  async function doDelete() {
    const r = confirm
    setDeleting(true)
    try {
      await api(`/am/accounts/${r.AccountID}`, { method: 'DELETE' })
      toast(`Account ${r.AccountNumber ?? ''} – ${r.CustomerName || ''} deleted`)
      setConfirm(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast(`Could not delete: ${e.message}`, 'error')
    } finally {
      setDeleting(false)
    }
  }

  // Debounced search box
  useEffect(() => {
    const t = setTimeout(() => { if (search !== (sp.get('search') || '')) set({ search }) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const sort = params.sort || 'number'
  const dir = params.dir || 'asc'

  return (
    <div className="page">
      <PageHeader title="Alarm accounts" subtitle="Search, filter and open any alarm monitoring account"
        actions={<Link className="btn primary" to="/am/accounts/new"><Plus size={15} /> New account</Link>} />
      <AmTabs />

      <div className="filters">
        <input className="search" placeholder="Search name, account #, address, phone, email, panel…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={params.status || 'active'} onChange={(e) => set({ status: e.target.value })}>
          <option value="active">Active</option>
          <option value="disconnected">Disconnected</option>
          <option value="all">All</option>
        </select>
        <select value={params.monitoringTypeId || ''} onChange={(e) => set({ monitoringTypeId: e.target.value })}>
          <option value="">All monitoring types</option>
          {lookups.monitoringTypes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <span className="muted">{loading ? 'Loading…' : `${data.total} accounts`}</span>
      </div>
      {error && <ErrorState message={error} />}

      <div className="table-wrap">{loading && !data.rows.length && <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={3} /></div>}
        <Grid serverPaged searchable={false} filterable={false} exportAll={exportAll} title="Alarm accounts" className="grid clickable">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key}
                  className={c.sort ? 'sortable' : ''}
                  onClick={() => c.sort && set({ sort: c.sort, dir: sort === c.sort && dir === 'asc' ? 'desc' : 'asc', page: params.page || 1 })}>
                  {c.label}{sort === c.sort ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th className="am-row-actions-h">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.AccountID} onClick={() => nav(`/am/accounts/${r.AccountID}`)} className={r.DisconnectionDate ? 'dim' : ''}>
                {COLS.map((c) => <td key={c.key}>{c.date ? fmtDate(r[c.key]) : r[c.key]}</td>)}
                <td className="am-row-actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="icon-btn" title={r.AccountID ? 'Edit account' : 'This record has no account ID and cannot be opened'} aria-label={`Edit ${r.CustomerName || 'account'}`}
                    disabled={!r.AccountID} onClick={() => nav(`/am/accounts/${r.AccountID}`)}><Pencil size={15} /></button>
                  <button type="button" className="icon-btn danger" title={r.AccountID ? 'Delete account' : 'This record has no account ID and cannot be deleted here'} aria-label={`Delete ${r.CustomerName || 'account'}`}
                    disabled={!r.AccountID} onClick={() => setConfirm(r)}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
            {!loading && !data.rows.length && <tr><td colSpan={COLS.length + 1}><EmptyState icon={Search} title="No accounts match">Try a different search or filter.</EmptyState></td></tr>}
          </tbody>
        </Grid>
      </div>

      {confirm && (
        <div className="modal-backdrop" role="presentation" onClick={() => !deleting && setConfirm(null)}>
          <div className="modal am-confirm" role="alertdialog" aria-modal="true" aria-labelledby="am-del-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="am-del-title"><Trash2 size={17} /> Delete account {confirm.AccountNumber}?</h2>
            <p><b>{confirm.CustomerName}</b>{confirm.ServiceCity ? ` · ${confirm.ServiceCity}` : ''}</p>
            <p className="muted">This permanently removes the account, its call-list contacts and its zones from the database. It cannot be undone. To keep the history, set a disconnection date on the account instead.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" disabled={deleting} onClick={() => setConfirm(null)} autoFocus>Cancel</button>
              <button type="button" className="btn danger" disabled={deleting} onClick={doDelete}><Trash2 size={15} /> {deleting ? 'Deleting…' : 'Delete account'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="pager">
        <button className="btn small" disabled={data.page <= 1} onClick={() => setSp({ ...params, page: data.page - 1 })}>‹ Prev</button>
        <span className="muted">{data.total} accounts</span>
        <span>Page {data.page} of {pages}</span>
        <button className="btn small" disabled={data.page >= pages} onClick={() => setSp({ ...params, page: data.page + 1 })}>Next ›</button>
      </div>
    </div>
  )
}
