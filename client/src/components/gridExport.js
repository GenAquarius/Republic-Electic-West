// Table export helpers: CSV, Excel (.xlsx, written here as a small zip, no library) and PDF (jsPDF, loaded on demand).
// Input everywhere: columns = ['Label', ...], rows = [[cell, ...], ...] (cells are display text or numbers).

const saveBlob = (blob, name) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
const stamp = () => new Date().toISOString().slice(0, 10)
export const fileBase = (title) => `${String(title || 'table').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'table'}-${stamp()}`

// "$1,234.50" / "(12)" / "45%" -> number for Excel; anything else stays text
export function asNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v ?? '').trim()
  if (!/^\(?-?\$?\s?[\d,]+(\.\d+)?\)?%?$/.test(s) || !/\d/.test(s)) return null
  const neg = s.startsWith('(') || s.startsWith('-')
  const n = parseFloat(s.replace(/[$,()%\s-]/g, ''))
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

export function exportCsv(columns, rows, title) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const text = '﻿' + [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n')
  saveBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), `${fileBase(title)}.csv`)
}

// ---- XLSX (Office Open XML in an uncompressed zip) ----
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (bytes) => { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function zip(files) {
  const enc = new TextEncoder()
  const parts = [], central = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true)
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, data)
    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true)
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true)
    central.push(new Uint8Array(cen.buffer), name)
    offset += 30 + name.length + data.length
  }
  const cenSize = central.reduce((t, p) => t + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cenSize, true); end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
const xml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '') // eslint-disable-line no-control-regex
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) } return s }

export function exportXlsx(columns, rows, title) {
  const widths = columns.map((c, i) => Math.min(60, Math.max(8, String(c).length + 2, ...rows.slice(0, 300).map((r) => String(r[i] ?? '').length + 1))))
  const cell = (v, ref, header) => {
    const n = header ? null : asNumber(v)
    if (n != null) return `<c r="${ref}"><v>${n}</v></c>`
    return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(v)}</t></is></c>`
  }
  const sheetRows = [columns, ...rows].map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, `${colName(ci)}${ri + 1}`, ri === 0)).join('')}</row>`).join('')
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData>${rows.length ? `<autoFilter ref="A1:${colName(columns.length - 1)}${rows.length + 1}"/>` : ''}</worksheet>`
  const sheetName = xml(String(title || 'Sheet1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1')
  saveBlob(zip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', text: sheet },
  ]), `${fileBase(title)}.xlsx`)
}

export async function exportPdf(columns, rows, title, subtitle) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'letter' })
  doc.setFontSize(13); doc.text(String(title || 'Table'), 40, 40)
  doc.setFontSize(9); doc.setTextColor(110)
  doc.text(`${subtitle ? `${subtitle} · ` : ''}${rows.length} rows · exported ${new Date().toLocaleString()} · StaffWare`, 40, 56)
  autoTable(doc, {
    head: [columns.map(String)], body: rows.map((r) => r.map((v) => (v == null ? '' : String(v)))), startY: 68,
    styles: { fontSize: columns.length > 10 ? 6.5 : 8, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [91, 63, 196], textColor: 255 }, alternateRowStyles: { fillColor: [247, 246, 252] },
    margin: { left: 40, right: 40 },
  })
  doc.save(`${fileBase(title)}.pdf`)
}

/**
 * Fetch every page of a server-paged list (for "export all filtered records"). fetchPage(page, pageSize) -> { rows, total }.
 * Stops at the total, a short page, a repeated page (sample-data mode answers every page the same) or 50 pages.
 */
export async function fetchAllPages(fetchPage, pageSize = 200) {
  const all = []
  let prevFirst = null
  for (let page = 1; page <= 50; page++) {
    const d = await fetchPage(page, pageSize)
    const rows = d?.rows || []
    const first = JSON.stringify(rows[0] ?? null)
    if (page > 1 && first === prevFirst) break
    prevFirst = first
    all.push(...rows)
    if (rows.length < pageSize || (d.total != null && all.length >= d.total)) break
  }
  return all
}
