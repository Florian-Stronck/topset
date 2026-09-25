import { weekdayOf } from "@/lib/dates";
import { activeSettings } from "@/lib/settings";
import { WEEKDAYS } from "@/lib/types";
import { t } from "@/lib/i18n";

/**
 * A rest day is shown under the coach's rest name everywhere, while its own name is kept
 * underneath — so turning it back into a training day brings the name it had before.
 */
export function dayName(day: { label: string; rest: boolean }): string {
  return day.rest ? restName() : day.label;
}

/** What rest days are called: the coach's own word, or "Rest" in their language. */
export function restName(): string {
  const own = activeSettings().restName.trim();
  return !own || own === "Rest" ? t("Rest") : own;
}

/** A name that only says "rest" — nothing worth bringing back for a training day. */
export function isRestName(label: string): boolean {
  const own = activeSettings().restName.trim().toLowerCase();
  const text = label.trim().toLowerCase();
  return text === "" || text === own || text === t("Rest").toLowerCase() || /^rest( day)?$/.test(text);
}

/**
 * What a training day is called when Topset names it: the n-th session of the week, the
 * n-th day, or its weekday — whichever the coach picked.
 */
export function trainingDayName(nth: number, weekday: number): string {
  switch (activeSettings().dayNaming) {
    case "day":
      return t("Day {n}", { n: nth });
    case "weekday":
      return t(WEEKDAYS[weekday]);
    default:
      return t("Session {n}", { n: nth });
  }
}

/**
 * A week's seven days for a phase starting on `startDate`: the coach's training weekdays
 * named in order, everything else rest.
 */
export function templateDays(startDate: Date | string) {
  const { trainingDays } = activeSettings();
  const first = weekdayOf(startDate);
  let nth = 0;
  return Array.from({ length: 7 }, (_, index) => {
    const weekday = (first + index) % 7;
    const trains = trainingDays.includes(weekday);
    return {
      index,
      rest: !trains,
      label: trains ? trainingDayName(++nth, weekday) : restName(),
    };
  });
}
