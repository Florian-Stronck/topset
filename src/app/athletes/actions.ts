"use server";

import { assertCoach } from "@/lib/role";
import { revalidatePath } from "next/cache";
import type { IntensityType, Tier, Unit } from "@prisma/client";
import { applyAllProgressions } from "@/app/programming/actions";
import { loadSettings } from "@/lib/coach-settings";
import { snapStart } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { formatDays, parseDays } from "@/lib/readiness";

function revalidateAll() {
  revalidatePath("/athletes");
  revalidatePath("/programming");
}

export async function createAthlete(input: {
  name: string;
  unit: Unit;
  squat1RM?: number | null;
  bench1RM?: number | null;
  dead1RM?: number | null;
}) {
  assertCoach();
  const coach = await prisma.coach.findFirst({ select: { id: true } });
  if (!coach) throw new Error("No coach found — run `npm run db:seed`.");

  const athlete = await prisma.athlete.create({
    data: {
      coachId: coach.id,
      name: input.name.trim() || "New athlete",
      unit: input.unit,
      squat1RM: input.squat1RM ?? null,
      bench1RM: input.bench1RM ?? null,
      dead1RM: input.dead1RM ?? null,
    },
  });

  revalidateAll();
  return athlete.id;
}

type ExampleRow = {
  tier: Tier;
  target: string;
  exercise: string;
  sets: number;
  reps: number;
  intensityType: IntensityType;
  intensity: number;
  coachNotes?: string;
  /** Progression on the first week's row; the later weeks are written from it. */
  rule?: { field: "REPS" | "SETS" | "INTENSITY"; amount: number };
};

const EXAMPLE_DAYS: { index: number; label: string; rows: ExampleRow[] }[] = [
  {
    index: 0,
    label: "Squat day",
    rows: [
      { tier: "PRIMARY", target: "Squat", exercise: "Back Squat", sets: 1, reps: 4, intensityType: "RPE", intensity: 7, coachNotes: "Top set, then the backoffs below.", rule: { field: "INTENSITY", amount: 0.5 } },
      { tier: "BACKOFF", target: "Squat", exercise: "Backoff", sets: 3, reps: 4, intensityType: "BACKOFF", intensity: 10 },
      { tier: "ACCESSORY", target: "Quadriceps", exercise: "Leg Press", sets: 3, reps: 10, intensityType: "RPE", intensity: 7 },
    ],
  },
  {
    index: 2,
    label: "Bench day",
    rows: [
      { tier: "PRIMARY", target: "Bench", exercise: "Bench Press", sets: 4, reps: 5, intensityType: "PERCENT", intensity: 72.5, coachNotes: "Pause every rep.", rule: { field: "INTENSITY", amount: 2.5 } },
      { tier: "VARIATION", target: "Bench", exercise: "Close Grip Bench", sets: 3, reps: 6, intensityType: "RPE", intensity: 7 },
      { tier: "ACCESSORY", target: "Back", exercise: "Barbell Row", sets: 3, reps: 10, intensityType: "RPE", intensity: 8, rule: { field: "REPS", amount: 1 } },
    ],
  },
  {
    index: 4,
    label: "Deadlift day",
    rows: [
      { tier: "PRIMARY", target: "Deadlift", exercise: "Deadlift", sets: 3, reps: 3, intensityType: "PERCENT", intensity: 75, rule: { field: "INTENSITY", amount: 2.5 } },
      { tier: "ACCESSORY", target: "Hamstrings", exercise: "Romanian Deadlift", sets: 3, reps: 8, intensityType: "RPE", intensity: 7 },
    ],
  },
];

/**
 * A made-up athlete with a four-week program already written, so someone new has
 * something real to click through in the tutorial. Deleted like any other athlete.
 */
export async function createExampleAthlete(): Promise<string> {
  assertCoach();
  await loadSettings();
  const coach = await prisma.coach.findFirst({ select: { id: true } });
  if (!coach) throw new Error("No coach found.");

  const athlete = await prisma.athlete.create({
    data: {
      coachId: coach.id,
      name: "Example Athlete",
      unit: "KG",
      squat1RM: 180,
      bench1RM: 120,
      dead1RM: 220,
    },
  });

  const program = await prisma.program.create({
    data: { athleteId: athlete.id, name: "Example Program" },
  });

  const block = await prisma.block.create({
    data: {
      athleteId: athlete.id,
      programId: program.id,
      order: 0,
      phase: "Volume",
      startDate: new Date(snapStart(new Date().toISOString())),
      squat1RM: athlete.squat1RM,
      bench1RM: athlete.bench1RM,
      dead1RM: athlete.dead1RM,
    },
  });

  // Same exercise week to week is chained through fromId — that's what progressions follow.
  let previous = new Map<string, string>();
  for (let w = 1; w <= 4; w++) {
    const week = await prisma.week.create({ data: { blockId: block.id, order: w } });
    const next = new Map<string, string>();

    for (let index = 0; index < 7; index++) {
      const plan = EXAMPLE_DAYS.find((d) => d.index === index);
      const day = await prisma.day.create({
        data: { weekId: week.id, index, label: plan?.label ?? "Rest", rest: !plan },
      });

      for (const [order, row] of (plan?.rows ?? []).entries()) {
        const key = `${index}:${order}`;
        const made = await prisma.exerciseRow.create({
          data: {
            dayId: day.id,
            order,
            tier: row.tier,
            target: row.target,
            exercise: row.exercise,
            sets: row.sets,
            reps: row.reps,
            intensityType: row.intensityType,
            intensity: row.intensity,
            coachNotes: w === 1 ? (row.coachNotes ?? null) : null,
            fromId: previous.get(key) ?? null,
            rules:
              w === 1 && row.rule
                ? {
                    create: {
                      order: 0,
                      field: row.rule.field,
                      op: "ADD",
                      amount: row.rule.amount,
                      everyWeeks: 1,
                      startWeek: 2,
                      endWeek: null,
                    },
                  }
                : undefined,
          },
        });
        next.set(key, made.id);
      }
    }
    previous = next;
  }

  await applyAllProgressions(block.id);
  revalidateAll();
  return athlete.id;
}

export async function updateAthleteProfile(
  athleteId: string,
  patch: {
    name?: string;
    unit?: Unit;
    squat1RM?: number | null;
    bench1RM?: number | null;
    dead1RM?: number | null;
    /** Weekdays the readiness check-in is asked, "0,3" (0 = Monday). */
    readinessDays?: string;
  },
) {
  assertCoach();
  const data = { ...patch };
  if (data.readinessDays !== undefined) data.readinessDays = formatDays(parseDays(data.readinessDays));
  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) delete data.name;
    else data.name = name;
  }

  await prisma.athlete.update({ where: { id: athleteId }, data });
  revalidateAll();
}

export async function deleteAthlete(athleteId: string) {
  assertCoach();
  await prisma.athlete.delete({ where: { id: athleteId } });
  revalidateAll();
}

/**
 * Copies a whole program — every phase, with its days, rows, rules and week cells — onto
 * an athlete, the source's own athlete included, which is how a plan gets reused. Logged
 * work (actual weight, performed RPE, athlete notes) is left behind: the copy is a
 * prescription, not someone else's history.
 *
 * `shift` moves every phase by the same number of days, so the phases keep their spacing.
 */
export async function copyProgram(
  programId: string,
  target: { athleteId: string; name?: string; startDate?: string },
) {
  assertCoach();
  await loadSettings();
  const source = await prisma.program.findUniqueOrThrow({
    where: { id: programId },
    include: {
      phases: {
        orderBy: { order: "asc" },
        include: {
          weeks: {
            orderBy: { order: "asc" },
            include: {
              days: {
                orderBy: { index: "asc" },
                include: {
                  rows: {
                    orderBy: { order: "asc" },
                    include: { rules: { orderBy: { order: "asc" } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const first = source.phases[0];
  const shift =
    target.startDate && first
      ? new Date(snapStart(target.startDate)).getTime() - first.startDate.getTime()
      : 0;

  const copy = await prisma.program.create({
    data: {
      athleteId: target.athleteId,
      name: target.name?.trim() || source.name,
      phases: {
        create: source.phases.map((phase) => ({
          athleteId: target.athleteId,
          order: phase.order,
          phase: phase.phase,
          startDate: new Date(phase.startDate.getTime() + shift),
          // The copy is calculated from the same maxes the original was written against.
          squat1RM: phase.squat1RM,
          bench1RM: phase.bench1RM,
          dead1RM: phase.dead1RM,
          weeks: {
            create: phase.weeks.map((week) => ({
              order: week.order,
              locked: week.locked,
              days: {
                create: week.days.map((day) => ({
                  index: day.index,
                  label: day.label,
                  rest: day.rest,
                  rows: {
                    create: day.rows.map((row) => ({
                      order: row.order,
                      tier: row.tier,
                      target: row.target,
                      exercise: row.exercise,
                      sets: row.sets,
                      reps: row.reps,
                      intensityType: row.intensityType,
                      intensity: row.intensity,
                      intensityMax: row.intensityMax,
                      rampStep: row.rampStep,
                      coachNotes: row.coachNotes,
                      tempo: row.tempo,
                      restTime: row.restTime,
                      videoUrl: row.videoUrl,
                      rules: {
                        create: row.rules.map((rule) => ({
                          order: rule.order,
                          field: rule.field,
                          op: rule.op,
                          amount: rule.amount,
                          everyWeeks: rule.everyWeeks,
                          startWeek: rule.startWeek,
                          endWeek: rule.endWeek,
                          enabled: rule.enabled,
                        })),
                      },
                    })),
                  },
                })),
              },
            })),
          },
        })),
      },
    },
    include: { phases: { orderBy: { order: "asc" } } },
  });

  revalidateAll();
  return { programId: copy.id, phaseId: copy.phases[0]?.id ?? null };
}
