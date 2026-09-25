import { activeSettings } from "@/lib/settings";
import { t } from "@/lib/i18n";

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** A date in the coach's chosen format: "21 Sept", "21/09" or "09/21", optionally with the year. */
export function formatDate(date: Date | string, withYear = false): string {
  const d = calendarDay(date);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getUTCDate();
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (activeSettings().dateFormat) {
    case "dd/mm":
      return `${pad(day)}/${pad(month + 1)}${withYear ? `/${year}` : ""}`;
    case "mm/dd":
      return `${pad(month + 1)}/${pad(day)}${withYear ? `/${year}` : ""}`;
    default:
      return `${day} ${t(MONTHS_SHORT[month])}${withYear ? ` ${year}` : ""}`;
  }
}
