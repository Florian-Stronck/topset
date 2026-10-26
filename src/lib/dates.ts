import { activeSettings } from "@/lib/settings";
import { t } from "@/lib/i18n";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ProgramOverlap = {
  /** The program that started first, and the one that started inside it. */
  earlier: string;
  later: string;
  /** Negative, like an overlap in `phaseGaps`: days from `earlier`'s end back to `later`'s start — how far `later` moves to start when `earlier` ends. */
  days: number;
  /** Negative too: the days both run, for saying how long the overlap is. */
  shared: number;
};

/**
 * Pairs of programs with phases running on the same days, from `today` on — an overlap
 * that is over no longer decides anything. A phase's `weeks` is a count.
 */
export function programOverlaps(
  programs: { id: string; phases: { startDate: Date | string; weeks: number }[] }[],
  today: Date,
): ProgramOverlap[] {
  const spans = programs
    .filter((p) => p.phases.length > 0)
    .map((p) => ({
      id: p.id,
      phases: p.phases.map((x) => {
        const start = new Date(x.startDate).getTime();
        return [start, start + x.weeks * 7 * DAY_MS] as const;
      }),
    }))
    .map((p) => ({ ...p, start: Math.min(...p.phases.map((x) => x[0])), end: Math.max(...p.phases.map((x) => x[1])) }))
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));

  const from = today.getTime();
  const out: ProgramOverlap[] = [];
  for (const [i, a] of spans.entries()) {
    for (const b of spans.slice(i + 1)) {
      const shared = a.phases.some(([as, ae]) =>
        b.phases.some(([bs, be]) => Math.max(as, bs) < Math.min(ae, be) && Math.min(ae, be) > from),
      );
      if (shared) {
        const both = Math.min(a.end, b.end) - Math.max(a.start, b.start);
        out.push({ earlier: a.id, later: b.id, days: Math.round((b.start - a.end) / DAY_MS), shared: -Math.round(both / DAY_MS) });
      }
    }
  }
  return out;
}

/** `programOverlaps` from a flat list of phases tagged with their program. */
export function phaseOverlaps(
  phases: { programId: string; startDate: Date | string; weeks: number }[],
  today: Date,
): ProgramOverlap[] {
  const byProgram = new Map<string, { startDate: Date | string; weeks: number }[]>();
  for (const p of phases) byProgram.set(p.programId, [...(byProgram.get(p.programId) ?? []), p]);
  return programOverlaps([...byProgram].map(([id, list]) => ({ id, phases: list })), today);
}

/**
 * Of the programs that overlap, the one trained while they do: the picked one, else the
 * one that started last — the same rule `programOn` applies date by date.
 */
export function overlapWinner(
  programs: { id: string; phases: { startDate: Date | string }[] }[],
  overlapping: Set<string>,
  picked: string | null | undefined,
): string | null {
  if (picked && overlapping.has(picked)) return picked;
  let winner: string | null = null;
  let latest = "";
  for (const p of programs) {
    if (!overlapping.has(p.id) || p.phases.length === 0) continue;
    const start = p.phases.map((x) => ymdOf(x.startDate)).sort()[0];
    if (start > latest) [winner, latest] = [p.id, start];
  }
  return winner;
}

export type ProgramStatus = "upcoming" | "active" | "paused" | "done";

/**
 * Where a program is on `today` (`YYYY-MM-DD`). Running, it is paused when another program
 * owns today (`owner`, from `programOn`); not started yet, when it loses its overlap.
 */
export function programStatus(
  program: { id: string; phases: { startDate: Date | string; weeks: number }[] },
  today: string,
  overlapping: Set<string>,
  winner: string | null,
  owner: string | undefined,
): ProgramStatus | null {
  if (program.phases.length === 0) return null;
  const start = program.phases.map((x) => ymdOf(x.startDate)).sort()[0];
  const end = program.phases
    .map((x) => new Date(Date.parse(`${ymdOf(x.startDate)}T00:00:00Z`) + x.weeks * 7 * DAY_MS).toISOString().slice(0, 10))
    .sort()
    .at(-1)!;
  if (today >= end) return "done";
  if (today >= start) return owner === undefined || owner === program.id ? "active" : "paused";
  return overlapping.has(program.id) && program.id !== winner ? "paused" : "upcoming";
}

/** Whether every overlap has a winner: the active program is one of each pair. */
export function overlapsSettled(pairs: ProgramOverlap[], active: string | null | undefined): boolean {
  return pairs.every((o) => o.earlier === active || o.later === active);
}

/**
 * Days between one phase ending and the next starting, keyed by the later phase's id.
 * Positive is a break (rest, vacation), negative an overlap; back-to-back phases are left
 * out. Phases are taken in the order given.
 */
export function phaseGaps(
  phases: { id: string; startDate: Date | string; weeks: unknown[] }[],
): Map<string, number> {
  const gaps = new Map<string, number>();
  for (let i = 1; i < phases.length; i++) {
    const prev = phases[i - 1];
    const end = new Date(prev.startDate).getTime() + prev.weeks.length * 7 * DAY_MS;
    const days = Math.round((new Date(phases[i].startDate).getTime() - end) / DAY_MS);
    if (days !== 0) gaps.set(phases[i].id, days);
  }
  return gaps;
}

/** "2 wk break", "3 day overlap" — the gap before a phase, in words. */
export function describeGap(days: number): string {
  const n = Math.abs(days);
  const amount = n % 7 === 0 ? t("{n} wk", { n: n / 7 }) : t("{n} day", { n });
  return days > 0 ? t("{amount} break", { amount }) : t("{amount} overlap", { amount });
}

/** The Monday of the week a `YYYY-MM-DD` date falls in, as `YYYY-MM-DD`. */
export function mondayOf(ymd: string): string {
  return weekStartOf(ymd, 0);
}

/** The first day (0 = Monday … 6 = Sunday) of the week a `YYYY-MM-DD` date falls in. */
export function weekStartOf(ymd: string, weekStart: number): string {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  const back = (weekdayOf(d) - weekStart + 7) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/**
 * Where a program or phase starts given the date picked: the coach's first day of the
 * week on or before it, or the date itself when they switched snapping off.
 */
export function snapStart(ymd: string): string {
  const { snapStart: snap, weekStart } = activeSettings();
  return snap ? weekStartOf(ymd, weekStart) : ymd.slice(0, 10);
}

/**
 * A stored date as the calendar day it means. Start dates were saved both as UTC
 * midnight and as local midnight (22:00Z the day before, here), so reading the UTC day
 * half a day later lands on the intended day either way.
 */
function calendarDay(date: Date | string): Date {
  return new Date(new Date(date).getTime() + 12 * 60 * 60 * 1000);
}

/** A stored date as `YYYY-MM-DD`, read the same way as everywhere else. */
export function ymdOf(date: Date | string): string {
  return calendarDay(date).toISOString().slice(0, 10);
}

/** Today on this computer's calendar, as a date that reads back as the same day. */
export function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(date: Date | string): number {
  return (calendarDay(date).getUTCDay() + 6) % 7;
}

/** The weekday a phase's day falls on — from its real date, so any first day of the week reads right. */
export function weekdayOfDay(startDate: Date | string, dayIndex: number): number {
  return (weekdayOf(startDate) + dayIndex) % 7;
}

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

/**
 * A timestamp — when something happened, not a day of the plan — in the coach's format,
 * on this computer's calendar, with the time when asked for.
 */
export function formatMoment(at: Date | string, withTime = false): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const day = formatDate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), true);
  return withTime ? `${day} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : day;
}

/** A date in the coach's chosen format: "21/09/2026" (always with its year), "21 Sept", "21/09" or "09/21". */
export function formatDate(date: Date | string, withYear = false): string {
  const d = calendarDay(date);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getUTCDate();
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (activeSettings().dateFormat) {
    case "dd/mm/yyyy":
      return `${pad(day)}/${pad(month + 1)}/${year}`;
    case "dd/mm":
      return `${pad(day)}/${pad(month + 1)}${withYear ? `/${year}` : ""}`;
    case "mm/dd":
      return `${pad(month + 1)}/${pad(day)}${withYear ? `/${year}` : ""}`;
    default:
      return `${day} ${t(MONTHS_SHORT[month])}${withYear ? ` ${year}` : ""}`;
  }
}
