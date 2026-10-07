/**
 * Which coach a row belongs to, worked out from the chain of parents it hangs off. The
 * Topset server holds every coach's data in one database, so everything a desktop app sends
 * up or asks for is checked against this before it touches the database.
 */

import { ROLES, type Role } from "@/lib/roles";
import { MERGED_TABLES, type Row } from "@/lib/sync-plan";

type Parent = { column: string; table: string; optional?: boolean };

/** Parents first. The first parent listed is the one a row is found through. */
export const SCOPE: { table: string; parents: Parent[] }[] = [
  { table: "Coach", parents: [] },
  { table: "Athlete", parents: [{ column: "coachId", table: "Coach" }] },
  { table: "Program", parents: [{ column: "athleteId", table: "Athlete" }] },
  { table: "BodyweightLog", parents: [{ column: "athleteId", table: "Athlete" }] },
  { table: "CheckinQuestion", parents: [{ column: "athleteId", table: "Athlete" }] },
  { table: "CheckinAnswer", parents: [{ column: "athleteId", table: "Athlete" }] },
  { table: "CoachMessage", parents: [{ column: "athleteId", table: "Athlete" }] },
  { table: "AthleteVideo", parents: [{ column: "athleteId", table: "Athlete" }] },
  { table: "NutritionLog", parents: [{ column: "athleteId", table: "Athlete" }] },
  { table: "CheckinPhoto", parents: [{ column: "athleteId", table: "Athlete" }] },
  { table: "Injury", parents: [{ column: "athleteId", table: "Athlete" }] },
  { table: "SessionMove", parents: [{ column: "athleteId", table: "Athlete" }] },
  { table: "Meeting", parents: [{ column: "athleteId", table: "Athlete" }] },
  { table: "Meet", parents: [{ column: "athleteId", table: "Athlete" }] },
  {
    table: "Block",
    parents: [
      { column: "athleteId", table: "Athlete" },
      { column: "programId", table: "Program" },
    ],
  },
  { table: "Attempt", parents: [{ column: "meetId", table: "Meet" }] },
  { table: "Week", parents: [{ column: "blockId", table: "Block" }] },
  { table: "Day", parents: [{ column: "weekId", table: "Week" }] },
  {
    table: "ExerciseRow",
    parents: [
      { column: "dayId", table: "Day" },
      { column: "fromId", table: "ExerciseRow", optional: true },
    ],
  },
  { table: "ProgressionRule", parents: [{ column: "rowId", table: "ExerciseRow" }] },
  { table: "SetLog", parents: [{ column: "rowId", table: "ExerciseRow" }] },
];

export const SCOPED_TABLES = SCOPE.map((s) => s.table);

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * SQL selecting the ids of `table` that belong to one coach, with a single `?` for the
 * coach's id — a chain of `IN (SELECT …)` up to the Coach row. With `shared`, athletes
 * shared with the coach count too, and so does everything under them: `true` for any share
 * (what they may read), a role for shares at least that strong. Without it, only what the
 * coach owns: what they may delete outright.
 */
export function ownedIdsSql(table: string, shared: boolean | Role = false): string {
  const entry = SCOPE.find((s) => s.table === table);
  if (!entry) throw new Error(`No ownership rule for ${table}.`);
  if (entry.parents.length === 0) return `SELECT "id" FROM ${quote(table)} WHERE "id" = ?`;
  if (table === "Athlete" && shared) {
    const roles = ROLES.slice(ROLES.indexOf(shared === true ? "view" : shared));
    // Still one `?`, so callers that mix in their own arguments stay as they are.
    return (
      `SELECT a."id" FROM "Athlete" a, (SELECT ? AS "me") m WHERE a."coachId" = m."me" OR a."id" IN ` +
      `(SELECT "athleteId" FROM "AthleteShare" WHERE "coachId" = m."me" AND "role" IN (${roles.map((r) => `'${r}'`).join(", ")}))`
    );
  }
  const [parent] = entry.parents;
  return `SELECT "id" FROM ${quote(table)} WHERE ${quote(parent.column)} IN (${ownedIdsSql(parent.table, shared)})`;
}

/**
 * The joins from `table` (as `t0`) up to its athlete, and the expression for that athlete's
 * id; null for the Coach table, which has none.
 */
export function athleteChain(table: string): { from: string; athlete: string } | null {
  if (table === "Coach") return null;
  if (table === "Athlete") return { from: `"Athlete" t0`, athlete: `t0."id"` };
  let from = `${quote(table)} t0`;
  let at = table;
  for (let i = 0; ; i++) {
    const [parent] = SCOPE.find((s) => s.table === at)?.parents ?? [];
    if (!parent) throw new Error(`No athlete above ${table}.`);
    if (parent.table === "Athlete") return { from, athlete: `t${i}.${quote(parent.column)}` };
    from += ` JOIN ${quote(parent.table)} t${i + 1} ON t${i + 1}."id" = t${i}.${quote(parent.column)}`;
    at = parent.table;
  }
}

export type PushTables = Record<string, { upsert: Row[]; remove: string[] }>;

/**
 * A push without what the coach may only look at: rows under athletes shared with them to
 * view or review (`readOnly`, per table), and new rows hung under those. Dropped rather than
 * refused, so an app that changed one anyway keeps syncing the rest. Review keeps the
 * Reviewed mark: a Day in `reviewable` comes back in `reviews`, for the caller to write alone.
 */
export function withoutReadOnly(
  tables: PushTables,
  readOnly: Map<string, Set<string>>,
  reviewable: Set<string> = new Set(),
): { tables: PushTables; reviews: { id: string; reviewedAt: unknown }[] } {
  const out: PushTables = {};
  const dropped = new Map<string, Set<string>>();
  const reviews: { id: string; reviewedAt: unknown }[] = [];
  const blocked = (table: string, id: unknown) => readOnly.get(table)?.has(String(id)) || dropped.get(table)?.has(String(id));
  for (const { table, parents } of SCOPE) {
    const change = tables[table];
    if (!change) continue;
    const gone = new Set<string>();
    dropped.set(table, gone);
    const upsert = change.upsert.filter((row) => {
      const keep = !readOnly.get(table)?.has(String(row.id)) && !parents.some((p) => row[p.column] != null && blocked(p.table, row[p.column]));
      if (!keep) gone.add(String(row.id));
      if (!keep && table === "Day" && reviewable.has(String(row.id))) reviews.push({ id: String(row.id), reviewedAt: row.reviewedAt ?? null });
      return keep;
    });
    const remove = change.remove.filter((id) => !readOnly.get(table)?.has(id));
    if (upsert.length || remove.length) out[table] = { upsert, remove };
  }
  // Tables outside the scope are refused by `checkPush`, so they pass through to it.
  for (const [table, change] of Object.entries(tables)) if (!SCOPED_TABLES.includes(table)) out[table] = change;
  return { tables: out, reviews };
}

/**
 * Whether one coach may make these changes: every row it sends is new or already theirs,
 * and hangs off a parent that is theirs or arrives in the same push; every row it removes
 * is theirs. `owned` is what the coach has now, athletes shared with them to edit included; `taken` holds
 * ids that exist but belong to someone else. `owners` names the owner of each athlete in
 * `owned` that isn't the coach's own: only an owner removes an athlete or hands it over.
 * Returns the first problem, or null.
 */
export function checkPush(
  coachId: string,
  tables: PushTables,
  owned: Map<string, Set<string>>,
  taken: Set<string>,
  owners: Map<string, string> = new Map(),
): string | null {
  for (const name of Object.keys(tables)) {
    // Sets come from the athlete app only; merged tables have their own channel.
    if (!SCOPED_TABLES.includes(name) || name === "SetLog" || MERGED_TABLES.has(name)) return `${name} can't be synced.`;
  }
  const mine = (table: string) => owned.get(table) ?? new Set<string>();
  const arriving = new Map<string, Set<string>>();

  for (const { table, parents } of SCOPE) {
    const change = tables[table];
    if (!change) continue;
    const incoming = new Set<string>();
    for (const row of change.upsert) {
      if (typeof row.id !== "string" || row.id === "") return `A ${table} row has no id.`;
      if (taken.has(row.id)) return `${table} ${row.id} belongs to someone else.`;
      if (table === "Coach" && row.id !== coachId) return "Only your own coach profile can be changed.";
      // A new athlete is the coach's own; one shared with them stays its owner's.
      if (table === "Athlete" && row.coachId !== (owners.get(row.id) ?? coachId)) return `Athlete ${row.id} isn't yours to hand over.`;
      for (const p of parents) {
        const value = row[p.column];
        // A shared athlete hangs off its owner, checked just above.
        if (table === "Athlete" && owners.has(row.id) && value === owners.get(row.id)) continue;
        if (value === null || value === undefined) {
          if (p.optional) continue;
          return `${table} ${row.id} has no ${p.column}.`;
        }
        const ok =
          mine(p.table).has(String(value)) ||
          arriving.get(p.table)?.has(String(value)) ||
          (p.table === table && change.upsert.some((r) => r.id === value));
        if (!ok) return `${table} ${row.id} points at a ${p.table} that isn't yours.`;
      }
      incoming.add(row.id);
    }
    arriving.set(table, incoming);
    for (const id of change.remove) {
      if (!mine(table).has(id)) return `${table} ${id} isn't yours to remove.`;
      if (table === "Athlete" && owners.has(id)) return "Only the coach who added an athlete can delete them.";
    }
  }
  if (tables.Coach?.remove.length) return "A coach profile can't be removed by sync.";
  return null;
}
