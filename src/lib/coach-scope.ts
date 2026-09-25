/**
 * Which coach a row belongs to, worked out from the chain of parents it hangs off. The
 * Topset server holds every coach's data in one database, so everything a desktop app sends
 * up or asks for is checked against this before it touches the database.
 */

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
 * coach's id — a chain of `IN (SELECT …)` up to the Coach row.
 */
export function ownedIdsSql(table: string): string {
  const entry = SCOPE.find((s) => s.table === table);
  if (!entry) throw new Error(`No ownership rule for ${table}.`);
  if (entry.parents.length === 0) return `SELECT "id" FROM ${quote(table)} WHERE "id" = ?`;
  const [parent] = entry.parents;
  return `SELECT "id" FROM ${quote(table)} WHERE ${quote(parent.column)} IN (${ownedIdsSql(parent.table)})`;
}

export type PushTables = Record<string, { upsert: Row[]; remove: string[] }>;

/**
 * Whether one coach may make these changes: every row it sends is new or already theirs,
 * and hangs off a parent that is theirs or arrives in the same push; every row it removes
 * is theirs. `owned` is what the coach has now; `taken` holds ids that exist but belong
 * to someone else. Returns the first problem, or null.
 */
export function checkPush(coachId: string, tables: PushTables, owned: Map<string, Set<string>>, taken: Set<string>): string | null {
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
      for (const p of parents) {
        const value = row[p.column];
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
    }
  }
  if (tables.Coach?.remove.length) return "A coach profile can't be removed by sync.";
  return null;
}
