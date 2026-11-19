// Column-level visibility by permission. A table column whose header text matches `match` is shown (and exported)
// only to users whose login has at least one of `modules` (the same module codes as LoginUsers, e.g. 'DM' = admin).
// Rules apply to every table in the app. Add rules here; nothing is restricted until a rule exists.
import { session } from '../api'

export const COLUMN_RULES = [
  // Examples (uncomment / adapt):
  // { match: /^(hourly rate|pay rate|rate)$/i, modules: ['PR', 'DM'] },
  // { match: /^pass ?code$/i, modules: ['DM'] },
]

export function columnAllowed(label) {
  const mods = session.user?.modules || []
  return COLUMN_RULES.every((r) => !r.match.test(String(label || '').trim()) || r.modules.some((m) => mods.includes(m)))
}
