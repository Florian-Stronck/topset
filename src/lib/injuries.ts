import { t } from "@/lib/i18n";

/**
 * Injuries, as the athlete reports them from the app or the coach notes them down: where,
 * which side, how bad (1 a niggle, 5 can't train it), since when, and — once it clears up —
 * until when. The areas are a fixed list so the body map and the history agree.
 */

export type Side = "L" | "R";

/** The body map's regions (react-muscle-highlighter's slugs). */
export type Region =
  | "head" | "neck" | "trapezius" | "deltoids" | "chest" | "obliques" | "abs" | "upper-back" | "lower-back"
  | "biceps" | "triceps" | "forearm" | "hands" | "gluteal" | "adductors" | "quadriceps" | "hamstring"
  | "knees" | "tibialis" | "calves" | "ankles" | "feet";

/**
 * Where it can hurt, each drawn on one region of the map. A region can hold more than one
 * area — the forearm is an elbow or a forearm — and the form asks which. Ids stay put once
 * injuries are filed under them; labels can change.
 */
export const AREAS = [
  { id: "head", label: "Head", sided: false, region: "head" },
  { id: "neck", label: "Neck", sided: false, region: "neck" },
  { id: "trapezius", label: "Trapezius", sided: true, region: "trapezius" },
  { id: "shoulder", label: "Shoulder", sided: true, region: "deltoids" },
  { id: "chest", label: "Chest", sided: false, region: "chest" },
  { id: "ribs", label: "Ribs & obliques", sided: true, region: "obliques" },
  { id: "abdomen", label: "Abdomen", sided: false, region: "abs" },
  { id: "upper-back", label: "Upper back", sided: false, region: "upper-back" },
  { id: "low-back", label: "Lower back", sided: false, region: "lower-back" },
  { id: "biceps", label: "Biceps", sided: true, region: "biceps" },
  { id: "triceps", label: "Triceps", sided: true, region: "triceps" },
  { id: "elbow", label: "Elbow", sided: true, region: "forearm" },
  { id: "forearm", label: "Forearm", sided: true, region: "forearm" },
  { id: "wrist", label: "Wrist", sided: true, region: "hands" },
  { id: "hand", label: "Hand & fingers", sided: true, region: "hands" },
  { id: "hip", label: "Hip & glute", sided: true, region: "gluteal" },
  { id: "groin", label: "Groin", sided: true, region: "adductors" },
  { id: "quad", label: "Quad", sided: true, region: "quadriceps" },
  { id: "hamstring", label: "Hamstring", sided: true, region: "hamstring" },
  { id: "knee", label: "Knee", sided: true, region: "knees" },
  { id: "shin", label: "Shin", sided: true, region: "tibialis" },
  { id: "calf", label: "Calf", sided: true, region: "calves" },
  { id: "achilles", label: "Achilles", sided: true, region: "calves" },
  { id: "ankle", label: "Ankle", sided: true, region: "ankles" },
  { id: "foot", label: "Foot & toes", sided: true, region: "feet" },
] as const satisfies readonly { id: string; label: string; sided: boolean; region: Region }[];

export type AreaId = (typeof AREAS)[number]["id"];
export type Area = (typeof AREAS)[number];

const byId = new Map<string, Area>(AREAS.map((a) => [a.id, a]));

export function areaOf(id: string): Area | undefined {
  return byId.get(id);
}

/** The areas a region holds, in the order the form offers them. */
export function areasIn(region: string): Area[] {
  return AREAS.filter((a) => a.region === region);
}

export type InjuryData = {
  id: string;
  area: string;
  side: Side | null;
  /** `YYYY-MM-DD` it started. */
  day: string;
  /** `YYYY-MM-DD` it cleared up; null while it's still there. */
  endDay: string | null;
  severity: number;
  note: string | null;
  source: "athlete" | "coach";
};

export type InjuryInput = Omit<InjuryData, "id" | "source"> & { id?: string };

export function injuryData(row: {
  id: string;
  area: string;
  side: string | null;
  day: string;
  endDay: string | null;
  severity: number;
  note: string | null;
  source: string;
}): InjuryData {
  return {
    id: row.id,
    area: row.area,
    side: row.side === "L" || row.side === "R" ? row.side : null,
    day: row.day,
    endDay: row.endDay,
    severity: row.severity,
    note: row.note,
    source: row.source === "coach" ? "coach" : "athlete",
  };
}

/** "Knee (L)", "Lower back", in the coach's language. */
export function injuryLabel(injury: { area: string; side: Side | null }): string {
  const name = t(byId.get(injury.area)?.label ?? injury.area);
  return injury.side ? `${name} (${injury.side === "L" ? t("left") : t("right")})` : name;
}

/** Still there on a day: started by then, and not yet cleared up — the day it clears up, it's gone. */
export function isActive(injury: Pick<InjuryData, "day" | "endDay">, today: string): boolean {
  return injury.day <= today && (injury.endDay === null || injury.endDay > today);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** An injury as a form sent it, checked; throws with what's wrong. */
export function cleanInjury(input: InjuryInput): Omit<InjuryInput, "id"> {
  const area = byId.get(input.area);
  if (!area) throw new Error("Pick where it hurts.");
  if (!YMD.test(input.day) || Number.isNaN(Date.parse(input.day))) throw new Error("That day isn't a date.");
  if (input.endDay !== null && (!YMD.test(input.endDay) || input.endDay < input.day)) throw new Error("It can't clear up before it started.");
  const side = area.sided && (input.side === "L" || input.side === "R") ? input.side : null;
  if (area.sided && side === null) throw new Error("Which side?");
  const severity = Math.round(Number(input.severity));
  if (!Number.isFinite(severity) || severity < 1 || severity > 5) throw new Error("How bad, from 1 to 5?");
  return { area: area.id, side, day: input.day, endDay: input.endDay, severity, note: input.note?.trim().slice(0, 500) || null };
}

/** Active first (worst on top), then the ones cleared up, latest first. */
export function sortInjuries(list: InjuryData[], today: string): InjuryData[] {
  return [...list].sort((a, b) => {
    const on = Number(isActive(b, today)) - Number(isActive(a, today));
    if (on !== 0) return on;
    if (isActive(a, today)) return b.severity - a.severity || b.day.localeCompare(a.day);
    return (b.endDay ?? "").localeCompare(a.endDay ?? "") || b.day.localeCompare(a.day);
  });
}

/**
 * What the map colours: per region, the worst severity, and the side when only one side of
 * it hurts (null means both, or a region down the middle).
 */
export function regionMarks(marks: { area: string; side: Side | null; severity: number }[]): { region: Region; side: Side | null; severity: number }[] {
  const out = new Map<Region, { sides: Set<Side | null>; severity: number }>();
  for (const m of marks) {
    const area = byId.get(m.area);
    if (!area) continue;
    const held = out.get(area.region) ?? { sides: new Set<Side | null>(), severity: 0 };
    held.sides.add(m.side);
    held.severity = Math.max(held.severity, m.severity);
    out.set(area.region, held);
  }
  return [...out].map(([region, { sides, severity }]) => ({
    region,
    side: sides.size === 1 && !sides.has(null) ? [...sides][0] : null,
    severity,
  }));
}
