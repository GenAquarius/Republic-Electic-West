// Printable account documents — Access reports AmAccountInfo (with zone and call-list subreports)
// and AmAccountInfoTech (technician sheet: service address, panel type, premises phone).
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Mail, Printer, XCircle } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import Logo from '../../components/Logo'

function useAccount(id) {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    Promise.all([api(`/am/accounts/${id}`), api('/am/lookups')])
      .then(([acc, lk]) => setD({ ...acc, lookups: lk }))
      .catch((e) => setError(e.message))
  }, [id])
  return { d, error }
}

const printedAt = () => new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

// Label-over-value field. Blank values read "Not recorded" (lighter weight) instead of a bare dash,
// which reads better once the page is printed or exported to PDF.
function Field({ label, value, wide }) {
  const empty = value == null || value === ''
  return (
    <div className={wide ? 'am-f wide' : 'am-f'}>
      <span className="am-f-l">{label}</span>
      <span className={empty ? 'am-f-v empty' : 'am-f-v'}>{value === true ? 'Yes' : value === false ? 'No' : empty ? 'Not recorded' : value}</span>
    </div>
  )
}

function Shell({ id, title, d, error, children, email }) {
  return (
    <div className="page print-doc">
      <PageHeader title={title} track={false}
        actions={<>
          <Link className="btn" to={`/am/accounts/${id}`}><ArrowLeft size={15} /> Back to account</Link>
          {email && d && <a className="btn" href={email} title="Opens a new email. Use Print → Save as PDF and attach the file."><Mail size={15} /> Email</a>}
          <button className="btn primary" disabled={!d} onClick={() => window.print()}><Printer size={15} /> Print</button>
        </>} />
      {error && <ErrorState message={error} />}
      {!d && !error ? <SkeletonRows rows={8} cols={3} /> : d && <article className="am-sheet">{children}</article>}
    </div>
  )
}

// Shared letterhead for both documents: logo, division line, the document's own title/badge on the
// left and the account number pulled out in the brand color on the right.
function AmHead({ title, badge, badgeTone = 'green', accountNumber }) {
  const BadgeIcon = badgeTone === 'green' ? CheckCircle2 : XCircle
  return (
    <header className="am-head">
      <div>
        <div className="am-head-brand">
          <Logo size={38} />
          <div><div className="am-head-co">Republic Electric West</div><div className="am-head-div">REI Security · Alarm monitoring</div></div>
        </div>
        <h2>{title}</h2>
        {badge && <span className={`am-badge ${badgeTone}`}><BadgeIcon size={11} /> {badge}</span>}
      </div>
      <div className="am-head-right">
        <div className="muted xs">Account</div>
        <div className="am-acct-no">{accountNumber}</div>
        <div className="muted xs" style={{ marginTop: 4 }}>Printed {printedAt()}</div>
      </div>
    </header>
  )
}

function SectionTitle({ children }) {
  return <h3 className="am-sec-h">{children}</h3>
}

export function AmAccountPrint() {
  const { id } = useParams()
  const { d, error } = useAccount(id)
  const a = d?.account
  const name = (list, v) => list.find((x) => String(x.id) === String(v))?.name
  const active = a && !a.DisconnectionDate
  return (
    <Shell id={id} title="Account information" d={d} error={error}>
      {a && <>
        <AmHead title="Alarm monitoring account information" badge={active ? 'Active' : 'Disconnected'} badgeTone={active ? 'green' : 'slate'} accountNumber={a.AccountNumber} />

        <section className="am-cols">
          <div>
            <SectionTitle>Account</SectionTitle>
            <div className="am-grid">
              <Field label="Customer name" value={a.CustomerName} />
              <Field label="Phone" value={a.PhoneNumber} />
              <Field label="Email" value={a.Email} />
              <Field label="Contract terms" value={a.ContractTerms || name(d.lookups.contractTerms, a.ContractTermsId)} />
              <Field label="Contract value / month" value={a.MonthlyContractValue} />
              <Field label="Sales person" value={a.SalesPerson} />
            </div>
          </div>
          <div>
            <SectionTitle>Panel and monitoring</SectionTitle>
            <div className="am-grid">
              <Field label="Panel info" value={a.PanelInfo} />
              <Field label="Panel type" value={a.PanelType} />
              <Field label="Monitoring type" value={name(d.lookups.monitoringTypes, a.MonitoringTypeId)} />
              <Field label="Permit #" value={a.PermitNumber} />
              <Field label="Activation date" value={fmtDate(a.ActivationDate)} />
              <Field label="Renewal date" value={fmtDate(a.RenewalDate)} />
              <Field label="Disconnection date" value={fmtDate(a.DisconnectionDate)} />
            </div>
          </div>
        </section>

        <section className="am-cols">
          <div>
            <SectionTitle>Monitoring service address</SectionTitle>
            <div className="am-grid">
              <Field label="Street" value={a.ServiceStreet} />
              <Field label="City / state / zip" value={[a.ServiceCity, a.ServiceState, a.ServiceZip].filter(Boolean).join(', ')} />
              <Field label="Country" value={a.ServiceCountry} />
            </div>
          </div>
          <div>
            <SectionTitle>Mailing address {a.MailingSameService && <span className="muted xs">(same as service)</span>}</SectionTitle>
            <div className="am-grid">
              <Field label="Street" value={a.MailStreet} />
              <Field label="City / state / zip" value={[a.MailCity, a.MailState, a.MailZip].filter(Boolean).join(', ')} />
              <Field label="Country" value={a.MailCountry} />
            </div>
          </div>
        </section>

        {a.AccountNotes && (
          <section className="am-sec-full">
            <SectionTitle>Account notes</SectionTitle>
            <p className="am-notes">{a.AccountNotes}</p>
          </section>
        )}
        {a.CancellationReason && (
          <section className="am-sec-full">
            <SectionTitle>Cancellation reason</SectionTitle>
            <p className="am-notes">{a.CancellationReason}</p>
          </section>
        )}

        <section className="am-sec-full">
          <SectionTitle>Zones</SectionTitle>
          <table className="am-table">
            <thead><tr><th style={{ width: 90 }}>Zone</th><th>Description</th></tr></thead>
            <tbody>
              {d.zones.map((z) => <tr key={z.ZoneID}><td>{z.Zone}</td><td>{z.ZoneDescription}</td></tr>)}
              {!d.zones.length && <tr><td colSpan={2} className="muted">No zones</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="am-sec-full" style={{ marginBottom: 0 }}>
          <SectionTitle>Call list</SectionTitle>
          <table className="am-table">
            <thead><tr><th>Contact name</th><th>Pass code</th><th>Phone</th><th>Type</th></tr></thead>
            <tbody>
              {d.contacts.map((c) => <tr key={c.ContactID}><td>{c.ContactName}</td><td className={c.PassCode ? '' : 'muted'}>{c.PassCode || '—'}</td><td>{c.PhoneNumber}</td><td>{c.PhoneType}</td></tr>)}
              {!d.contacts.length && <tr><td colSpan={4} className="muted">No contacts</td></tr>}
            </tbody>
          </table>
        </section>
      </>}
    </Shell>
  )
}

export function AmAccountTechPrint() {
  const { id } = useParams()
  const { d, error } = useAccount(id)
  const a = d?.account
  // Access: IIf([PhoneType] Like "Premises", contact phone, "") — one line per premises phone.
  const premises = (d?.contacts || []).filter((c) => /^premises$/i.test(c.PhoneType || '') && c.PhoneNumber)
  // Access "Email report": SendObject as PDF, no recipient, subject "Alarm monitoring info for homeowner: <name>".
  const email = a && `mailto:?subject=${encodeURIComponent(`Alarm monitoring info for homeowner: ${a.CustomerName || ''}`)}&body=${encodeURIComponent('Find attached alarm monitoring account information.')}`
  return (
    <Shell id={id} title="Account info – tech" d={d} error={error} email={email}>
      {a && <>
        <AmHead title="Account info – technician" accountNumber={a.AccountNumber} />

        <section className="am-sec-full" style={{ marginBottom: 18 }}>
          <SectionTitle>Customer</SectionTitle>
          <div className="am-grid">
            <Field label="Customer name" value={a.CustomerName} />
            <Field label="Panel type" value={a.PanelType} />
            <Field label="Premises phone" value={premises.map((c) => c.PhoneNumber).join(' · ') || null} />
          </div>
        </section>

        <section className="am-sec-full" style={{ marginBottom: 16 }}>
          <SectionTitle>Service address</SectionTitle>
          <div className="am-grid">
            <Field label="Street" value={a.ServiceStreet} wide />
            <Field label="City / state / zip" value={[a.ServiceCity, a.ServiceState, a.ServiceZip].filter(Boolean).join(', ')} />
            <Field label="Country" value={a.ServiceCountry} />
          </div>
        </section>

        <section className="am-sec-full" style={{ marginBottom: 0 }}>
          <SectionTitle>Zones</SectionTitle>
          <table className="am-table">
            <thead><tr><th style={{ width: 90 }}>Zone</th><th>Description</th></tr></thead>
            <tbody>
              {d.zones.map((z) => <tr key={z.ZoneID}><td>{z.Zone}</td><td>{z.ZoneDescription}</td></tr>)}
              {!d.zones.length && <tr><td colSpan={2} className="muted">No zones</td></tr>}
            </tbody>
          </table>
        </section>
      </>}
    </Shell>
  )
}
