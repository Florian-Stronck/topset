import { MONTHS_SHORT, weekdayOf } from "@/lib/dates";
import { LOCALE, t, weekdayShort as weekdayName } from "@/lib/i18n";
import { activeSettings } from "@/lib/settings";

/** "Thursday, 24 September" in the coach's language, for a `YYYY-MM-DD`. */
export function longDate(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString(LOCALE[activeSettings().language], {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/**
 * "Thu 24 Sept" — short enough for a list row. Built from Topset's own day and month names
 * rather than the browser's date formatting, so the phone and the server spell it the
 * same way and a card rendered on both never disagrees with itself.
 */
export function shortDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${weekdayName(weekdayOf(d))} ${d.getUTCDate()} ${t(MONTHS_SHORT[d.getUTCMonth()])}`;
}

/** "M", "T", "W" — one letter for the week strip. */
export function weekdayLetter(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString(LOCALE[activeSettings().language], {
    weekday: "narrow",
    timeZone: "UTC",
  });
}

/** "Sun" — the day in a day's heading. */
export function weekdayShort(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString(LOCALE[activeSettings().language], {
    weekday: "short",
    timeZone: "UTC",
  });
}
