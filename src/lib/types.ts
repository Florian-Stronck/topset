import type { IntensityType, Tier, Unit } from "@prisma/client";
import type { Rule } from "@/lib/progression";
import type { SetLogData } from "@/lib/setlog";

/** What one exercise prescribes on one day of one week, plus what was done against it. */
export type Prescription = {
  sets: number | null;
  reps: number | null;
  intensityType: IntensityType;
  intensity: number | null;
  intensityMax: number | null;
  rampStep: number | null;
  coachNotes: string | null;
  tempo: string | null;
  restTime: string | null;
  videoUrl: string | null;
  actualWeight: number | null;
  performedRpe: number | null;
  athleteNotes: string | null;
};

export type RowData = Prescription & {
  id: string;
  order: number;
  rules: Rule[];
  tier: Tier;
  target: string;
  exercise: string;
  /** The same exercise in the week before, which progressions walk forward from. */
  fromId: string | null;
  /** Sets the athlete checked off in the athlete app. Absent on rows made on screen. */
  logs?: SetLogData[];
};

export type DayData = {
  id: string;
  index: number;
  label: string;
  rest: boolean;
  /** When the coach last marked the session reviewed in Tracking, ISO. */
  reviewedAt?: string | null;
  rows: RowData[];
};

/** A week owns its days outright — two weeks of a phase need not look alike. */
export type WeekData = {
  id: string;
  /** 1-based week number within the phase. */
  order: number;
  /** Locked weeks keep whatever's in them — progression rules skip past them. */
  locked: boolean;
  days: DayData[];
};

/** One phase of a program, with its grid. */
export type BlockData = {
  id: string;
  /** The phase's own name. The program's name lives on `program`. */
  phase: string;
  program: { id: string; name: string };
  order: number;
  startDate: string;
  /** The 1RMs this program is calculated from — see `maxesOf`. */
  squat1RM: number | null;
  bench1RM: number | null;
  dead1RM: number | null;
  weeks: WeekData[];
};

export type AthleteData = {
  id: string;
  name: string;
  unit: Unit;
  squat1RM: number | null;
  bench1RM: number | null;
  dead1RM: number | null;
};

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const INTENSITY_TYPES: { value: IntensityType; label: string }[] = [
  { value: "RPE", label: "RPE" },
  { value: "RIR", label: "RIR" },
  { value: "PERCENT", label: "% 1RM" },
  { value: "WEIGHT", label: "Weight" },
  { value: "RANGE", label: "Range" },
  { value: "BACKOFF", label: "Backoff % off top" },
];
