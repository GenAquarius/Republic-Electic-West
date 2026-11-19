// Alarm Monitoring — AI insights (Claude). Mounted at /api/am/ai behind requireAuth + requireModule('AM').
//
// How it stays accurate: Claude never writes SQL and never sees raw tables. It answers by calling the
// read-only, parameterised queries below (tools); every number in an answer comes from one of them, and the
// response lists the queries used so the screen can show its sources.
// Privacy: tools return account number, customer name, city, monitoring type, contract terms, monthly value
// and dates only — never phone numbers, emails, street addresses, panel details or call-list passcodes.
//
// Needs ANTHROPIC_API_KEY in server/.env. Optional: AM_AI_MODEL (default claude-opus-5-5).
const express = require('express');
const AnthropicSDK = require('@anthropic-ai/sdk');
const { query } = require('../db');
const { h } = require('../crud');

const Anthropic = AnthropicSDK.default || AnthropicSDK.Anthropic || AnthropicSDK;
const router = express.Router();
const MODEL = process.env.AM_AI_MODEL || 'claude-opus-5-5';
const MAX_TOOL_ROUNDS = 8;
const configured = () => !!process.env.ANTHROPIC_API_KEY;
let client = null;
const getClient = () => (client ||= new Anthropic()); // reads ANTHROPIC_API_KEY from the environment

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---------------------------------------------------------------------------
// Read-only data tools
// ---------------------------------------------------------------------------
const MV = "TRY_CAST(REPLACE(REPLACE(a.MonthlyContractValue,'$',''),',','') AS money)";
const START = 'ISNULL(a.ActivationDate, a.DateEntered)';
const isoDate = (v, label) => {
  if (v == null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) throw bad(`${label} must be YYYY-MM-DD`);
  return String(v).replace(/-/g, ''); // yyyymmdd: unambiguous for SQL Server
};
const clampInt = (v, lo, hi, dflt) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt };
const monitoringTypeId = async (name) => {
  if (!name) return null;
  const r = await query('SELECT TOP 1 MonitoringTypeID AS id FROM LsAmMonitoringType WHERE MonitoringType LIKE @n', { n: `%${String(name).slice(0, 60)}%` });
  return r[0]?.id ?? -1; // -1 = no such type -> no rows
};

const TOOLS = [
  {
    name: 'portfolio_summary',
    description: 'Current alarm monitoring portfolio: total/active/cancelled accounts, active monthly recurring revenue (MRR), average monthly value, and active accounts and MRR broken down by monitoring type and by contract terms. Call this first for any overview question.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const [tot, byType, byTerms] = await Promise.all([
        query(`SELECT COUNT(*) AS totalAccounts,
                      SUM(CASE WHEN a.DisconnectionDate IS NULL THEN 1 ELSE 0 END) AS activeAccounts,
                      SUM(CASE WHEN a.DisconnectionDate IS NOT NULL THEN 1 ELSE 0 END) AS cancelledAccounts,
                      SUM(CASE WHEN a.DisconnectionDate IS NULL THEN ${MV} ELSE 0 END) AS activeMRR,
                      AVG(CASE WHEN a.DisconnectionDate IS NULL AND ${MV} > 0 THEN ${MV} END) AS avgMonthlyValueActivePaying
                 FROM AmAccount a`),
        query(`SELECT ISNULL(mt.MonitoringType,'(none)') AS monitoringType, COUNT(*) AS activeAccounts, SUM(${MV}) AS activeMRR
                 FROM AmAccount a LEFT JOIN LsAmMonitoringType mt ON mt.MonitoringTypeID = a.MonitoringTypeId
                WHERE a.DisconnectionDate IS NULL GROUP BY mt.MonitoringType ORDER BY activeAccounts DESC`),
        query(`SELECT ISNULL(t.ContractTerms,'(none)') AS contractTerms, COUNT(*) AS activeAccounts, SUM(${MV}) AS activeMRR
                 FROM AmAccount a LEFT JOIN LsAmContractTerms t ON t.ContractTermsID = a.ContractTermsId
                WHERE a.DisconnectionDate IS NULL GROUP BY t.ContractTerms ORDER BY activeAccounts DESC`),
      ])
      return { asOf: new Date().toISOString().slice(0, 10), ...tot[0], byMonitoringType: byType, byContractTerms: byTerms }
    },
  },
  {
    name: 'account_trend',
    description: 'Counts per month or per year of new accounts (by activation date, or date entered when there is none) or cancelled accounts (by disconnection date), with the monthly value gained or lost. Use for growth, churn and seasonality questions.',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['new', 'cancelled'] },
        from: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive)' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive)' },
        group_by: { type: 'string', enum: ['month', 'year'] },
        monitoring_type: { type: 'string', description: 'Optional monitoring type name to filter on' },
        split_by_type: { type: 'boolean', description: 'Return one row per period AND monitoring type (for stacked charts / heatmaps)' },
      },
      required: ['metric', 'from', 'to', 'group_by'],
      additionalProperties: false,
    },
    run: async (i) => {
      const from = isoDate(i.from, 'from'), to = isoDate(i.to, 'to')
      if (!from || !to) throw bad('from and to are required')
      const col = i.metric === 'cancelled' ? 'a.DisconnectionDate' : START
      const fmt = i.group_by === 'year' ? 'yyyy' : 'yyyy-MM'
      const mt = await monitoringTypeId(i.monitoring_type)
      const split = !!i.split_by_type
      const typeCol = "ISNULL(mt.MonitoringType,'(none)')"
      const rows = await query(
        `SELECT FORMAT(${col}, '${fmt}') AS period${split ? `, ${typeCol} AS monitoringType` : ''}, COUNT(*) AS accounts, SUM(${MV}) AS monthlyValue
           FROM AmAccount a LEFT JOIN LsAmMonitoringType mt ON mt.MonitoringTypeID = a.MonitoringTypeId
          WHERE ${col} IS NOT NULL AND CAST(${col} AS date) BETWEEN @from AND @to AND (@mt IS NULL OR a.MonitoringTypeId = @mt)
          GROUP BY FORMAT(${col}, '${fmt}')${split ? `, ${typeCol}` : ''} ORDER BY period`, { from, to, mt })
      return { metric: i.metric, from: i.from, to: i.to, groupBy: i.group_by, monitoringType: i.monitoring_type || 'all', splitByType: split, rows,
        totalAccounts: rows.reduce((t, r) => t + r.accounts, 0), totalMonthlyValue: rows.reduce((t, r) => t + (r.monthlyValue || 0), 0) }
    },
  },
  {
    name: 'portfolio_history',
    description: 'Month-by-month history for the last N months (default 36, max 120): active accounts and active MRR at each month end, plus new and cancelled accounts in that month and the net change. Use for trend lines of portfolio size and revenue.',
    input_schema: {
      type: 'object',
      properties: { months: { type: 'integer', description: 'Number of months back, including the current month (1-120)' } },
      additionalProperties: false,
    },
    run: async (i) => {
      const n = clampInt(i.months, 1, 120, 36)
      const rows = await query(
        `WITH m AS (SELECT 0 AS i, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) AS ms
                    UNION ALL SELECT i + 1, DATEADD(month, -1, ms) FROM m WHERE i < @n - 1)
         SELECT FORMAT(m.ms, 'yyyy-MM') AS period,
                (SELECT COUNT(*) FROM AmAccount a WHERE ${START} < DATEADD(month, 1, m.ms) AND (a.DisconnectionDate IS NULL OR a.DisconnectionDate >= DATEADD(month, 1, m.ms))) AS activeAccounts,
                (SELECT SUM(${MV}) FROM AmAccount a WHERE ${START} < DATEADD(month, 1, m.ms) AND (a.DisconnectionDate IS NULL OR a.DisconnectionDate >= DATEADD(month, 1, m.ms))) AS activeMRR,
                (SELECT COUNT(*) FROM AmAccount a WHERE ${START} >= m.ms AND ${START} < DATEADD(month, 1, m.ms)) AS newAccounts,
                (SELECT COUNT(*) FROM AmAccount a WHERE a.DisconnectionDate >= m.ms AND a.DisconnectionDate < DATEADD(month, 1, m.ms)) AS cancelledAccounts
           FROM m ORDER BY m.ms OPTION (MAXRECURSION 200)`, { n })
      for (const r of rows) r.netChange = r.newAccounts - r.cancelledAccounts
      return { months: n, note: 'Accounts with no activation or entry date are not counted in the history', rows }
    },
  },
  {
    name: 'cancellation_reasons',
    description: 'Cancelled accounts grouped by cancellation reason (and monitoring type), with the monthly revenue lost, for an optional date range on the disconnection date.',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string', description: 'YYYY-MM-DD, optional' }, to: { type: 'string', description: 'YYYY-MM-DD, optional' } },
      additionalProperties: false,
    },
    run: async (i) => {
      const from = isoDate(i.from, 'from'), to = isoDate(i.to, 'to')
      const rows = await query(
        `SELECT ISNULL(NULLIF(LTRIM(RTRIM(a.CancellationReason)),''),'(no reason recorded)') AS reason, ISNULL(mt.MonitoringType,'(none)') AS monitoringType,
                COUNT(*) AS accounts, SUM(${MV}) AS monthlyValueLost
           FROM AmAccount a LEFT JOIN LsAmMonitoringType mt ON mt.MonitoringTypeID = a.MonitoringTypeId
          WHERE a.DisconnectionDate IS NOT NULL AND (@from IS NULL OR a.DisconnectionDate >= @from) AND (@to IS NULL OR CAST(a.DisconnectionDate AS date) <= @to)
          GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(a.CancellationReason)),''),'(no reason recorded)'), mt.MonitoringType
          ORDER BY accounts DESC`, { from, to })
      return { from: i.from || null, to: i.to || null, rows }
    },
  },
  {
    name: 'renewals_due',
    description: 'Active accounts whose renewal date falls in the next N days (or is already past, when include_overdue is true), with account number, customer name, city, contract terms, monthly value and renewal date.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'Look-ahead window in days, 1-730' },
        include_overdue: { type: 'boolean', description: 'Also list active accounts whose renewal date has already passed' },
      },
      required: ['days'],
      additionalProperties: false,
    },
    run: async (i) => {
      const d = clampInt(i.days, 1, 730, 90)
      const rows = await query(
        `SELECT TOP 1000 a.AccountID, a.AccountNumber, a.CustomerName, a.ServiceCity AS city, ISNULL(mt.MonitoringType,'(none)') AS monitoringType,
                a.ContractTerms, ${MV} AS monthlyValue, CAST(a.RenewalDate AS date) AS renewalDate,
                DATEDIFF(day, CAST(GETDATE() AS date), a.RenewalDate) AS daysUntilRenewal
           FROM AmAccount a LEFT JOIN LsAmMonitoringType mt ON mt.MonitoringTypeID = a.MonitoringTypeId
          WHERE a.DisconnectionDate IS NULL AND a.RenewalDate IS NOT NULL
            AND a.RenewalDate <= DATEADD(day, @d, CAST(GETDATE() AS date))
            AND (@od = 1 OR a.RenewalDate >= CAST(GETDATE() AS date))
          ORDER BY a.RenewalDate`, { d, od: i.include_overdue ? 1 : 0 })
      const overdue = rows.filter((r) => r.daysUntilRenewal < 0)
      const top = [...rows].sort((x, y) => (y.monthlyValue || 0) - (x.monthlyValue || 0)).slice(0, 40)
      return { days: d, includeOverdue: !!i.include_overdue, accounts: rows.length, monthlyValueAtStake: Math.round(rows.reduce((t, r) => t + (r.monthlyValue || 0), 0) * 100) / 100,
        overdueAccounts: overdue.length, overdueMonthlyValue: Math.round(overdue.reduce((t, r) => t + (r.monthlyValue || 0), 0) * 100) / 100,
        oldestOverdueRenewal: overdue[0]?.renewalDate ?? null,
        rowsShown: top.length, rowsNote: rows.length > top.length ? `Showing the ${top.length} highest-value of ${rows.length} accounts` : 'All accounts shown', rows: top }
    },
  },
  {
    name: 'find_accounts',
    description: 'Search accounts with filters. Returns up to `limit` rows (max 50) plus the total matching count and total monthly value. Fields: account number, customer name, city, monitoring type, contract terms, monthly value, salesperson, activation, renewal and disconnection dates, cancellation reason.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'cancelled', 'all'] },
        city: { type: 'string' },
        monitoring_type: { type: 'string' },
        customer_name: { type: 'string', description: 'Part of the customer name' },
        min_monthly_value: { type: 'number' },
        max_monthly_value: { type: 'number' },
        renewal_from: { type: 'string', description: 'YYYY-MM-DD' },
        renewal_to: { type: 'string', description: 'YYYY-MM-DD' },
        activated_from: { type: 'string', description: 'YYYY-MM-DD' },
        activated_to: { type: 'string', description: 'YYYY-MM-DD' },
        sort: { type: 'string', enum: ['monthly_value_desc', 'renewal_date', 'activation_date', 'account_number'] },
        limit: { type: 'integer', description: '1-50, default 25' },
      },
      additionalProperties: false,
    },
    run: async (i) => {
      const p = {
        st: ['active', 'cancelled'].includes(i.status) ? i.status : null,
        city: i.city ? `%${String(i.city).slice(0, 60)}%` : null,
        name: i.customer_name ? `%${String(i.customer_name).slice(0, 80)}%` : null,
        mt: await monitoringTypeId(i.monitoring_type),
        minv: Number.isFinite(+i.min_monthly_value) && i.min_monthly_value !== undefined ? +i.min_monthly_value : null,
        maxv: Number.isFinite(+i.max_monthly_value) && i.max_monthly_value !== undefined ? +i.max_monthly_value : null,
        rf: isoDate(i.renewal_from, 'renewal_from'), rt: isoDate(i.renewal_to, 'renewal_to'),
        af: isoDate(i.activated_from, 'activated_from'), at: isoDate(i.activated_to, 'activated_to'),
      }
      const where = `(@st IS NULL OR (@st = 'active' AND a.DisconnectionDate IS NULL) OR (@st = 'cancelled' AND a.DisconnectionDate IS NOT NULL))
        AND (@city IS NULL OR a.ServiceCity LIKE @city) AND (@name IS NULL OR a.CustomerName LIKE @name)
        AND (@mt IS NULL OR a.MonitoringTypeId = @mt)
        AND (@minv IS NULL OR ${MV} >= @minv) AND (@maxv IS NULL OR ${MV} <= @maxv)
        AND (@rf IS NULL OR a.RenewalDate >= @rf) AND (@rt IS NULL OR CAST(a.RenewalDate AS date) <= @rt)
        AND (@af IS NULL OR ${START} >= @af) AND (@at IS NULL OR CAST(${START} AS date) <= @at)`
      const SORT = { monthly_value_desc: `${MV} DESC`, renewal_date: 'a.RenewalDate', activation_date: `${START}`, account_number: 'a.AccountNumber' }
      const limit = clampInt(i.limit, 1, 50, 25)
      const [rows, tot] = await Promise.all([
        query(`SELECT TOP (${limit}) a.AccountID, a.AccountNumber, a.CustomerName, a.ServiceCity AS city, ISNULL(mt.MonitoringType,'(none)') AS monitoringType,
                      a.ContractTerms, ${MV} AS monthlyValue, a.SalesPerson, CAST(${START} AS date) AS activated, CAST(a.RenewalDate AS date) AS renewalDate,
                      CAST(a.DisconnectionDate AS date) AS disconnected, a.CancellationReason
                 FROM AmAccount a LEFT JOIN LsAmMonitoringType mt ON mt.MonitoringTypeID = a.MonitoringTypeId
                WHERE ${where} ORDER BY ${SORT[i.sort] || SORT.account_number}`, p),
        query(`SELECT COUNT(*) AS n, SUM(${MV}) AS monthlyValue FROM AmAccount a WHERE ${where}`, p),
      ])
      return { totalMatching: tot[0].n, totalMonthlyValue: tot[0].monthlyValue, returned: rows.length, rows }
    },
  },
  {
    name: 'revenue_breakdown',
    description: 'Active accounts and monthly recurring revenue grouped by one dimension: city, monitoring type, contract terms, salesperson or activation year. Top 20 groups.',
    input_schema: {
      type: 'object',
      properties: { dimension: { type: 'string', enum: ['city', 'monitoring_type', 'contract_terms', 'salesperson', 'activation_year'] } },
      required: ['dimension'],
      additionalProperties: false,
    },
    run: async (i) => {
      const DIM = {
        city: "ISNULL(NULLIF(UPPER(LTRIM(RTRIM(a.ServiceCity))),''),'(none)')",
        monitoring_type: "ISNULL(mt.MonitoringType,'(none)')",
        contract_terms: "ISNULL(a.ContractTerms,'(none)')",
        salesperson: "ISNULL(NULLIF(LTRIM(RTRIM(a.SalesPerson)),''),'(none)')",
        activation_year: `ISNULL(FORMAT(${START},'yyyy'),'(none)')`,
      }
      const d = DIM[i.dimension]
      if (!d) throw bad('Unknown dimension')
      const rows = await query(
        `SELECT TOP 20 ${d} AS grp, COUNT(*) AS activeAccounts, SUM(${MV}) AS activeMRR, AVG(${MV}) AS avgMonthlyValue
           FROM AmAccount a LEFT JOIN LsAmMonitoringType mt ON mt.MonitoringTypeID = a.MonitoringTypeId
          WHERE a.DisconnectionDate IS NULL GROUP BY ${d} ORDER BY activeMRR DESC`)
      return { dimension: i.dimension, rows }
    },
  },
  {
    name: 'data_quality_check',
    description: 'Counts of data problems in the alarm accounts (missing account ID or number, duplicate account numbers, active accounts with no renewal date, no monitoring type, no contract terms or zero/blank monthly value, renewal before activation, no call-list contacts, cancelled without a reason) with up to 5 example accounts each.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const CHECKS = {
        missingAccountIdOrNumber: 'a.AccountID IS NULL OR a.AccountNumber IS NULL',
        duplicateAccountNumber: 'a.AccountNumber IN (SELECT AccountNumber FROM AmAccount WHERE AccountNumber IS NOT NULL GROUP BY AccountNumber HAVING COUNT(*) > 1)',
        activeWithoutRenewalDate: 'a.DisconnectionDate IS NULL AND a.RenewalDate IS NULL',
        activeWithoutMonitoringType: 'a.DisconnectionDate IS NULL AND a.MonitoringTypeId IS NULL',
        activeWithoutContractTerms: 'a.DisconnectionDate IS NULL AND a.ContractTermsId IS NULL',
        activeWithZeroOrBlankValue: `a.DisconnectionDate IS NULL AND ISNULL(${MV}, 0) = 0`,
        renewalBeforeActivation: 'a.RenewalDate < a.ActivationDate',
        activeWithoutCallListContacts: 'a.DisconnectionDate IS NULL AND NOT EXISTS (SELECT 1 FROM AmAccountContact c WHERE c.AccountId = a.AccountID)',
        cancelledWithoutReason: "a.DisconnectionDate IS NOT NULL AND LTRIM(RTRIM(ISNULL(a.CancellationReason,''))) = ''",
      }
      const out = {}
      await Promise.all(Object.entries(CHECKS).map(async ([k, w]) => {
        const [n, ex] = await Promise.all([
          query(`SELECT COUNT(*) AS n FROM AmAccount a WHERE ${w}`),
          query(`SELECT TOP 5 a.AccountNumber, a.CustomerName FROM AmAccount a WHERE ${w} ORDER BY a.AccountNumber`),
        ])
        out[k] = { count: n[0].n, examples: ex }
      }))
      return out
    },
  },
]
const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]))

// Presentation tool: Claude picks how to show data it already queried; the screen draws the chart from that
// query result (never from numbers Claude types), so a chart can't show a figure the database didn't return.
const CHART_TYPES = ['line', 'area', 'column', 'bar', 'donut', 'stacked_column', 'heatmap']
const SHOW_CHART = {
  name: 'show_chart',
  description: `Present one chart to the user, drawn from the rows of a data query you already ran in this conversation. Call it 2-5 times after gathering data, for the visuals that best support your answer (most important first). Chart types: line or area = a measure over time (periods on x); column = counts or values per period; bar = ranking categories (largest first); donut = share of a whole, max 6 parts; stacked_column = parts of a whole over time (needs series_field); heatmap = two categories against each other, e.g. period x monitoring type (needs series_field). Every query result carries a query_index; use it, and use the exact array key (dataset) and field names from that result.`,
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: CHART_TYPES },
      title: { type: 'string', description: 'Short chart title' },
      caption: { type: 'string', description: 'One sentence: the takeaway the reader should get from this chart' },
      query_index: { type: 'integer', description: 'query_index of the data query result to plot' },
      dataset: { type: 'string', description: 'Array key in that result, e.g. "rows", "byMonitoringType", "byContractTerms"' },
      x: { type: 'string', description: 'Field for categories / periods' },
      y: { type: 'array', items: { type: 'string' }, description: 'Numeric field(s) to plot. Several fields = several lines/series (line, area, column). Other types use the first.' },
      series_field: { type: 'string', description: 'stacked_column / heatmap: field whose values become the series (stack parts) or heatmap columns' },
      value_format: { type: 'string', enum: ['number', 'money', 'percent'] },
      sort: { type: 'string', enum: ['none', 'desc', 'asc'] },
      limit: { type: 'integer', description: 'Max categories to show (1-30)' },
    },
    required: ['type', 'title', 'caption', 'query_index', 'x', 'y'],
    additionalProperties: false,
  },
}
const MAX_CHARTS = 6
function resolveChart(spec, sources) {
  if (!CHART_TYPES.includes(spec.type)) throw bad(`type must be one of ${CHART_TYPES.join(', ')}`)
  const src = sources[(spec.query_index | 0) - 1]
  if (!src) throw bad(`No data query with query_index ${spec.query_index}. Valid: 1-${sources.length}`)
  const key = spec.dataset || 'rows'
  const rows = src.data?.[key]
  if (!Array.isArray(rows)) throw bad(`Query ${spec.query_index} (${src.tool}) has no array "${key}". Arrays: ${Object.keys(src.data || {}).filter((k) => Array.isArray(src.data[k])).join(', ') || 'none'}`)
  if (!rows.length) throw bad('That dataset is empty; there is nothing to chart')
  const ys = (Array.isArray(spec.y) ? spec.y : [spec.y]).filter(Boolean).slice(0, 4)
  const fields = Object.keys(rows[0])
  const missing = [spec.x, ...ys, spec.series_field].filter((f) => f && !fields.includes(f))
  if (missing.length) throw bad(`Unknown field(s) ${missing.join(', ')}. Fields: ${fields.join(', ')}`)
  if (!ys.length) throw bad('y needs at least one numeric field')
  if (['stacked_column', 'heatmap'].includes(spec.type) && !spec.series_field) throw bad(`${spec.type} needs series_field`)
  return {
    type: spec.type, title: String(spec.title).slice(0, 120), caption: String(spec.caption || '').slice(0, 300),
    x: spec.x, y: ys, seriesField: spec.series_field || null, format: ['money', 'percent'].includes(spec.value_format) ? spec.value_format : 'number',
    sort: ['desc', 'asc'].includes(spec.sort) ? spec.sort : 'none', limit: clampInt(spec.limit, 1, 30, 30),
    source: { tool: src.tool, input: src.input }, rows,
  }
}

const TOOL_DEFS = [...TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema })), SHOW_CHART]

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
const SYSTEM = `You are the reporting analyst for the Alarm Monitoring module of StaffWare, the operations system of Republic Electric West (REW / Republic Elite). The module tracks residential and commercial security-alarm monitoring accounts: customers pay a monthly contract value for monitoring, on contract terms (monthly, 12, 24, 36 months, ...), and accounts renew or are cancelled (disconnected) with a cancellation reason.

Your readers are office managers. Answer with facts from the tools and a short, practical interpretation.

Rules:
- Every number you state must come from a tool result in this conversation. Call the tools you need first; never estimate, extrapolate or invent figures, names or dates. If the data cannot answer the question, say so plainly and say what data would be needed.
- Money is USD per month unless you say otherwise ("MRR" = monthly recurring revenue from active accounts). Round money to whole dollars and percentages to one decimal.
- Refer to accounts as "#<account number> <customer name>".
- Point out data problems you notice (missing dates, blank values) when they affect the answer.
- Visuals: after gathering data, call show_chart 2-5 times for the charts that best support your answer, choosing the chart type that fits the data (see the tool description). The charts appear next to your text, so refer to them ("see the trend chart") instead of repeating long lists of numbers.
- Format: Markdown. Start with a one-sentence headline. Then short sections with "## " headings and bullet points; use a small table only when comparing several rows. End with "## Suggested actions" (2-4 bullets) when the question is about performance, risk or planning. Keep it under about 350 words unless the user asks for a full list.`

const today = () => new Date().toISOString().slice(0, 10)
const PRESETS = {
  overview: 'Give me a portfolio overview: size, active accounts and MRR, the mix by monitoring type and contract terms, how new accounts and cancellations have trended over the last 3 years, and the main risks and opportunities.',
  renewals: 'Which active accounts renew in the next 90 days or are already past their renewal date? Summarise the count and monthly value at stake, highlight the largest ones, and suggest how to prioritise renewal calls.',
  churn: 'Analyse cancellations over the last 3 years: trend by year, main reasons and monthly revenue lost, which monitoring types churn most, and what could reduce churn.',
  growth: 'Analyse new-account growth over the last 5 years by year and by monitoring type, and the revenue it added. Is growth speeding up or slowing down?',
  revenue: 'Where does monthly recurring revenue come from? Break it down by monitoring type, contract terms, city and salesperson, and point out concentration risks.',
  trends: 'Show how the alarm portfolio has changed month by month over the last 3 years: active accounts, monthly recurring revenue, new versus cancelled accounts and net change, and new and cancelled accounts by monitoring type per year. What are the turning points?',
  quality: 'Run a data-quality check on the alarm accounts and tell me which problems to fix first and why they matter for billing and renewals.',
}
const REPORT_LABEL = {
  created: 'Accounts created (new accounts by monitoring type and month)',
  'created-year': 'Accounts created per year',
  cancelled: 'Accounts cancelled (by type, month and reason)',
  expiring: 'Accounts expiring (contracts longer than a month whose term ends in the period)',
  'expiring-monthly': 'Active monthly / N/A contracts',
  renewals: 'Renewals due',
}

function buildQuestion(b) {
  if (b.preset) {
    const q = PRESETS[b.preset]
    if (!q) throw bad('Unknown insight')
    return q
  }
  if (b.report) {
    const label = REPORT_LABEL[b.report]
    if (!label) throw bad('Unknown report')
    const from = b.params?.from && /^\d{4}-\d{2}-\d{2}$/.test(b.params.from) ? b.params.from : null
    const to = b.params?.to && /^\d{4}-\d{2}-\d{2}$/.test(b.params.to) ? b.params.to : null
    const type = b.params?.monitoringType ? String(b.params.monitoringType).slice(0, 60) : null
    return `I am looking at the "${label}" report${from && to ? ` for ${from} to ${to}` : ''}${type ? `, monitoring type ${type}` : ''}. Explain what this report shows for that period: the key figures, notable patterns or changes compared with the previous period of the same length, anything unusual, and what I should do about it.`
  }
  const q = String(b.question || '').trim()
  if (q.length < 3) throw bad('Type a question')
  if (q.length > 600) throw bad('Keep the question under 600 characters')
  return q
}

// ---------------------------------------------------------------------------
// Light per-user rate limit (in memory): 30 requests per hour
// ---------------------------------------------------------------------------
const hits = new Map()
function rateLimit(user) {
  const now = Date.now(), win = 3600e3
  const list = (hits.get(user) || []).filter((t) => now - t < win)
  if (list.length >= 30) throw bad('AI insight limit reached (30 per hour). Try again later.', 429)
  list.push(now); hits.set(user, list)
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
router.get('/status', (req, res) => {
  res.json({ configured: configured(), model: MODEL, presets: Object.entries(PRESETS).map(([key, text]) => ({ key, text })) })
})

router.post('/ask', h(async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'AI insights are not set up yet. Add ANTHROPIC_API_KEY to server/.env and restart the server.', code: 'not_configured' })
  const question = buildQuestion(req.body || {})
  rateLimit(req.user.username)

  const messages = [{ role: 'user', content: `Today is ${today()}.\n\n${question}` }]
  const sources = []
  const charts = []
  const usage = { input: 0, output: 0 }
  let final = null

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let response
    try {
      response = await getClient().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        tools: TOOL_DEFS,
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default', // a safety decline is retried server-side on Anthropic's recommended fallback model
        messages,
      })
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw bad('The AI service rejected the API key. Check ANTHROPIC_API_KEY in server/.env.', 502)
      if (e instanceof Anthropic.RateLimitError) throw bad('The AI service is busy. Try again in a minute.', 503)
      if (e instanceof Anthropic.APIError) { console.error('[am-ai] API error', e.status, e.message); throw bad('The AI service returned an error. Try again.', 502) }
      throw e
    }
    usage.input += response.usage?.input_tokens || 0
    usage.output += response.usage?.output_tokens || 0

    if (response.stop_reason === 'refusal') throw bad('The AI declined to answer this question. Try rephrasing it.', 422)
    if (response.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: response.content }); continue }
    if (response.stop_reason !== 'tool_use') { final = response; break }

    messages.push({ role: 'assistant', content: response.content })
    const results = []
    for (const block of response.content.filter((b) => b.type === 'tool_use')) {
      const tool = TOOL_BY_NAME[block.name]
      let content, isError = false
      try {
        if (block.name === SHOW_CHART.name) {
          if (charts.length >= MAX_CHARTS) throw bad(`At most ${MAX_CHARTS} charts`)
          charts.push(resolveChart(block.input || {}, sources))
          content = JSON.stringify({ ok: true, chart: charts.length })
        } else {
          if (!tool) throw bad(`Unknown tool ${block.name}`)
          const out = await tool.run(block.input || {})
          sources.push({ tool: block.name, input: block.input || {}, data: out }) // the screen draws charts/tables from this exact data
          content = JSON.stringify({ query_index: sources.length, ...out })
        }
      } catch (e) {
        isError = true
        content = e.status === 400 ? e.message : 'The query failed.'
        if (e.status !== 400) console.error('[am-ai] tool error', block.name, e.message)
      }
      results.push({ type: 'tool_result', tool_use_id: block.id, content, ...(isError ? { is_error: true } : {}) })
    }
    messages.push({ role: 'user', content: results })
  }
  if (!final) throw bad('The analysis took too many steps. Try a narrower question.', 422)

  const answer = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
  console.log(`[am-ai] ${req.user.username} ${req.body?.preset || req.body?.report || 'question'} · ${sources.length} queries · ${charts.length} charts · ${usage.input} in / ${usage.output} out tokens · ${final.model}`)
  res.json({ question, answer, sources, charts, model: final.model, usage, truncated: final.stop_reason === 'max_tokens' })
}))

module.exports = router
