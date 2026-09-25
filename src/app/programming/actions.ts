"use server";

import { assertCoach } from "@/lib/role";
import { revalidatePath } from "next/cache";
import type { IntensityType, ProgField, ProgOp, Tier } from "@prisma/client";
import { loadSettings } from "@/lib/coach-settings";
import { t } from "@/lib/i18n";
import { phaseName } from "@/lib/settings";
import { snapStart, weekdayOfDay } from "@/lib/dates";
import { isRestName, templateDays, trainingDayName } from "@/lib/days";
import { prisma } from "@/lib/prisma";
import {
  ATTEMPT_PATTERN,
  ATTEMPT_ROWS,
  attemptExercise,
  LIFT_LABEL,
  maxFor,
  planned,
} from "@/lib/competition";
import { maxesOf } from "@/lib/intensity";
import { parseProgramFile } from "@/lib/program-file";
import { project, type Rule } from "@/lib/progression";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** These all show up on more than one screen. */
function revalidateAll() {
  revalidatePath("/programming");
  revalidatePath("/tracking");
  revalidatePath("/overview");
  revalidatePath("/athletes");
}

export type CellPatch = {
  sets?: number | null;
  reps?: number | null;
  intensityType?: IntensityType;
  intensity?: number | null;
  intensityMax?: number | null;
  coachNotes?: string | null;
  tempo?: string | null;
  restTime?: string | null;
  videoUrl?: string | null;
  actualWeight?: number | null;
  performedRpe?: number | null;
  athleteNotes?: string | null;
};

/** A row is one exercise in one week, so its prescription is just its own columns. */
export async function updateCell(rowId: string, patch: CellPatch) {
  assertCoach();
  await prisma.exerciseRow.update({ where: { id: rowId }, data: patch });
  // Logging what was lifted is this week's business; changing the plan is every week's.
  if (Object.keys(patch).some((k) => (PLAN_FIELDS as readonly string[]).includes(k))) await syncFromRow(rowId);
  revalidatePath("/programming");
}

export async function updateRow(
  rowId: string,
  patch: { exercise?: string; target?: string; tier?: Tier },
) {
  assertCoach();
  await prisma.exerciseRow.update({ where: { id: rowId }, data: patch });
  await syncFromRow(rowId);
  revalidatePath("/programming");
}

export async function addRow(
  dayId: string,
  init: { id?: string; exercise?: string; target?: string; tier?: Tier } = {},
) {
  assertCoach();
  const last = await prisma.exerciseRow.findFirst({
    where: { dayId },
    orderBy: { order: "desc" },
  });
  const blank = await blankRow();

  await prisma.exerciseRow.create({
    data: {
      id: init.id,
      dayId,
      order: (last?.order ?? -1) + 1,
      ...blank,
      ...definedOf(init),
      exercise: init.exercise ?? "New exercise",
    },
  });
  await syncFromDay(dayId);
  revalidatePath("/programming");
}

/** One row's whole prescription, as the grid copies and pastes it. */
export type RowTemplate = {
  tier: Tier;
  target: string;
  exercise: string;
  rules: {
    order: number;
    field: ProgField;
    op: ProgOp;
    amount: number;
    everyWeeks: number;
    startWeek: number;
    endWeek: number | null;
    enabled: boolean;
  }[];
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
};

/** A new row as the coach set it up in Settings: tier, target and prescription. */
async function blankRow() {
  const { newRow } = await loadSettings();
  return { ...newRow };
}

function definedOf<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Frees the slot right after `afterOrder`. Rows move one at a time and from the
 * bottom up, so the slot each one lands in is always free under (dayId, order).
 */
async function openSlot(
  tx: Tx,
  dayId: string,
  afterOrder: number,
) {
  const later = await tx.exerciseRow.findMany({
    where: { dayId, order: { gt: afterOrder } },
    orderBy: { order: "desc" },
    select: { id: true, order: true },
  });
  for (const row of later) {
    await tx.exerciseRow.update({ where: { id: row.id }, data: { order: row.order + 1 } });
  }
}

/** Adds a row directly below `afterOrder` rather than at the end of the day. */
export async function insertRow(
  dayId: string,
  afterOrder: number,
  init: { id?: string; exercise?: string; target?: string; tier?: Tier } = {},
) {
  assertCoach();
  const blank = await blankRow();
  await prisma.$transaction(async (tx) => {
    await openSlot(tx, dayId, afterOrder);
    await tx.exerciseRow.create({
      data: {
        id: init.id,
        dayId,
        order: afterOrder + 1,
        ...blank,
        ...definedOf(init),
        exercise: init.exercise ?? "",
      },
    });
  });
  await syncFromDay(dayId);
  revalidatePath("/programming");
}

/** Copies a row, prescription and rules included, onto the line below it. */
export async function duplicateRow(rowId: string, id?: string) {
  assertCoach();
  const row = await prisma.exerciseRow.findUniqueOrThrow({
    where: { id: rowId },
    include: { rules: { orderBy: { order: "asc" } } },
  });

  await prisma.$transaction(async (tx) => {
    await openSlot(tx, row.dayId, row.order);
    await tx.exerciseRow.create({
      data: {
        id,
        dayId: row.dayId,
        order: row.order + 1,
        tier: row.tier,
        target: row.target,
        exercise: row.exercise,
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
      },
    });
  });
  await syncFromDay(row.dayId);
  revalidatePath("/programming");
}

/** Swaps a row with its neighbour inside the day. */
export async function moveRow(rowId: string, direction: "up" | "down") {
  assertCoach();
  const row = await prisma.exerciseRow.findUniqueOrThrow({
    where: { id: rowId },
    select: { id: true, dayId: true, order: true },
  });
  const neighbour = await prisma.exerciseRow.findFirst({
    where: {
      dayId: row.dayId,
      order: direction === "up" ? { lt: row.order } : { gt: row.order },
    },
    orderBy: { order: direction === "up" ? "desc" : "asc" },
    select: { id: true, order: true },
  });
  if (!neighbour) return;

  await prisma.$transaction(async (tx) => {
    // Park the row below every real slot first: (dayId, order) is unique.
    await tx.exerciseRow.update({ where: { id: row.id }, data: { order: -1 } });
    await tx.exerciseRow.update({ where: { id: neighbour.id }, data: { order: row.order } });
    await tx.exerciseRow.update({ where: { id: row.id }, data: { order: neighbour.order } });
  });
  await syncFromDay(row.dayId);
  revalidatePath("/programming");
}

/** Puts a copied prescription on a row, its progression rules included. */
async function writeTemplate(tx: Tx, rowId: string, template: RowTemplate) {
  const { rules, ...prescription } = template;
  await tx.exerciseRow.update({ where: { id: rowId }, data: prescription });
  await tx.progressionRule.deleteMany({ where: { rowId } });
  if (rules.length > 0) {
    await tx.progressionRule.createMany({ data: rules.map((rule) => ({ ...rule, rowId })) });
  }
}

/**
 * Pastes copied rows the way a spreadsheet does, as one write: `update` rows take a
 * copy where they stand, `create` rows are added at the end of `dayId` in the order
 * given, and `remove` rows go again — which is how a paste is taken back.
 */
export async function pasteRows(
  dayId: string,
  write: {
    update?: { id: string; template: RowTemplate }[];
    create?: { id: string; template: RowTemplate }[];
    remove?: string[];
  },
) {
  assertCoach();
  await prisma.$transaction(async (tx) => {
    for (const id of write.remove ?? []) await removeRow(tx, id);
    for (const { id, template } of write.update ?? []) await writeTemplate(tx, id, template);

    const create = write.create ?? [];
    if (create.length === 0) return;
    const last = await tx.exerciseRow.findFirst({
      where: { dayId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    let order = (last?.order ?? -1) + 1;
    for (const { id, template } of create) {
      const { rules, ...prescription } = template;
      await tx.exerciseRow.create({ data: { id, dayId, order: order++, ...prescription, rules: { create: rules } } });
    }
  });
  await syncFromDay(dayId);
  revalidatePath("/programming");
}

/**
 * Writes the meet day: nine attempt rows, one single each, at the weights planned on the
 * meet — or, where an attempt is still blank, at what the program's 1RMs suggest. Running
 * it again replaces those rows rather than stacking a second set on top, and anything else
 * already written on that day is left where it is.
 */
export async function fillMeetDay(dayId: string, meetId: string) {
  assertCoach();
  const [day, meet] = await Promise.all([
    prisma.day.findUniqueOrThrow({
      where: { id: dayId },
      include: {
        week: { include: { block: { include: { athlete: true, weeks: true } } } },
        rows: true,
      },
    }),
    prisma.meet.findUniqueOrThrow({ where: { id: meetId }, include: { attempts: true } }),
  ]);

  const block = day.week.block;
  const start = Date.UTC(
    block.startDate.getUTCFullYear(),
    block.startDate.getUTCMonth(),
    block.startDate.getUTCDate(),
  );
  const target = Date.UTC(
    meet.date.getUTCFullYear(),
    meet.date.getUTCMonth(),
    meet.date.getUTCDate(),
  );

  // Which week of the block this day is the meet in. Anything else means the caller is
  // pointing at a day the meet does not land on.
  const offset = (target - start) / (24 * 60 * 60 * 1000) - day.index;
  const week = offset / 7 + 1;
  if (!Number.isInteger(week) || week !== day.week.order || week > block.weeks.length) {
    return { ok: false as const, error: "That day is not the meet day." };
  }

  const maxes = maxesOf(block, block.athlete);
  const keep = day.rows.filter((row) => !ATTEMPT_PATTERN.test(row.exercise));
  const base = keep.reduce((max, row) => Math.max(max, row.order), -1);

  await prisma.$transaction(async (tx) => {
    await tx.exerciseRow.deleteMany({
      where: { id: { in: day.rows.filter((r) => !keep.includes(r)).map((r) => r.id) } },
    });
    if (day.rest) await tx.day.update({ where: { id: dayId }, data: { rest: false } });

    for (const [i, attempt] of ATTEMPT_ROWS.entries()) {
      const planned_ = maxFor(attempt.lift, maxes);
      const weight =
        meet.attempts.find((a) => a.lift === attempt.lift && a.number === attempt.number)
          ?.weight ?? planned(planned_, attempt.number, block.athlete.unit);

      // The day belongs to the meet's week alone, so these rows are singles outright.
      await tx.exerciseRow.create({
        data: {
          dayId,
          order: base + 1 + i,
          tier: "PRIMARY",
          target: LIFT_LABEL[attempt.lift],
          exercise: attemptExercise(attempt.lift, attempt.number),
          sets: 1,
          reps: 1,
          intensityType: "WEIGHT",
          intensity: weight,
        },
      });
    }
  });

  revalidatePath("/programming");
  return { ok: true as const, week };
}

/**
 * Puts a deleted row back exactly where it was, id included, so an undo can be redone
 * and the two stacks keep pointing at the same row.
 */
export async function restoreRow(
  row: RowTemplate & { id: string; dayId: string; order: number; fromId: string | null },
) {
  assertCoach();
  await prisma.$transaction(async (tx) => {
    // The slot is usually still free — deleting a row leaves the others where they are.
    const clash = await tx.exerciseRow.findFirst({
      where: { dayId: row.dayId, order: row.order },
      select: { id: true },
    });
    if (clash) await openSlot(tx, row.dayId, row.order - 1);

    const { id, dayId, order, fromId, rules, ...prescription } = row;

    // Whatever `deleteRow` joined to this row's predecessor is its successor again. A
    // row that had no predecessor leaves nothing to look it up by, so the row sitting in
    // the same place a week later, still unlinked, is the one to rejoin.
    const day = await tx.day.findUniqueOrThrow({
      where: { id: dayId },
      select: { index: true, week: { select: { blockId: true, order: true } } },
    });

    const successor = fromId
      ? await tx.exerciseRow.findFirst({ where: { fromId }, select: { id: true } })
      : await tx.exerciseRow.findFirst({
          where: {
            fromId: null,
            order,
            day: {
              index: day.index,
              week: { blockId: day.week.blockId, order: day.week.order + 1 },
            },
          },
          select: { id: true },
        });

    if (successor) {
      await tx.exerciseRow.update({ where: { id: successor.id }, data: { fromId: null } });
    }

    await tx.exerciseRow.create({
      data: { id, dayId, order, fromId, ...prescription, rules: { create: rules } },
    });

    if (successor) {
      await tx.exerciseRow.update({ where: { id: successor.id }, data: { fromId: id } });
    }
  });
  await syncFromDay(row.dayId);
  revalidatePath("/programming");
}

/**
 * Deleting an exercise from one week closes the gap it leaves: the week after it joins
 * the week before it, so a progression written once still reaches the end of the phase.
 */
export async function deleteRow(rowId: string) {
  assertCoach();
  const gone = await prisma.exerciseRow.findUnique({ where: { id: rowId }, select: { dayId: true } });
  if (!gone) return;
  await prisma.$transaction((tx) => removeRow(tx, rowId));
  await syncFromDay(gone.dayId);
  revalidatePath("/programming");
}

/** Deletes a row and joins the week after it to the week before, as `deleteRow` says. */
async function removeRow(tx: Tx, rowId: string) {
  const row = await tx.exerciseRow.findUnique({ where: { id: rowId }, select: { fromId: true } });
  if (!row) return;
  const next = await tx.exerciseRow.findFirst({ where: { fromId: rowId }, select: { id: true } });

  // The delete frees the link first — `fromId` is unique, so it cannot be handed on
  // while the row that holds it is still there.
  await tx.exerciseRow.delete({ where: { id: rowId } });
  if (next) {
    await tx.exerciseRow.update({ where: { id: next.id }, data: { fromId: row.fromId } });
  }
}

export async function updateDay(dayId: string, patch: { label?: string; rest?: boolean }) {
  assertCoach();
  const data = { ...patch };
  // A day that was only ever called "Rest" needs a real name once it's trained on; it
  // takes the next session number in its week.
  if (patch.rest === false && patch.label === undefined) {
    await loadSettings();
    const day = await prisma.day.findUniqueOrThrow({
      where: { id: dayId },
      include: { week: { select: { block: { select: { startDate: true } } } } },
    });
    if (isRestName(day.label)) {
      const before = await prisma.day.count({
        where: { weekId: day.weekId, rest: false, index: { lt: day.index } },
      });
      data.label = trainingDayName(before + 1, weekdayOfDay(day.week.block.startDate, day.index));
    }
  }
  await prisma.day.update({ where: { id: dayId }, data });
  await syncFromDay(dayId);
  revalidatePath("/programming");
}

/**
 * The next week of a phase, as a copy of the one before it: same days, same exercises,
 * same prescription. Each new row points back at the row it came from, so a rule written
 * once keeps driving the weeks that follow. From there the week is the coach's to change
 * — dropping an exercise or resting a day touches that week alone.
 */
export async function addWeek(blockId: string) {
  assertCoach();
  const newest = await prisma.week.findFirst({
    where: { blockId },
    orderBy: { order: "desc" },
    include: { days: { select: { index: true, rows: { select: { id: true, order: true } } } } },
  });
  // The chain runs week to week, so the new rows hang off the newest week's rows in the
  // same slot even when their content comes from an earlier, unlocked week.
  const slot = (dayIndex: number, order: number) => `${dayIndex}:${order}`;
  const newestRows = new Map(
    (newest?.days ?? []).flatMap((d) => d.rows.map((r) => [slot(d.index, r.order), r.id])),
  );
  // A locked week is usually a one-off (deload, taper), so the copy comes from the last
  // regular week — falling back to the newest if every week is locked.
  const last =
    (await prisma.week.findFirst({
      where: { blockId, locked: false },
      orderBy: { order: "desc" },
      include: { days: { orderBy: { index: "asc" }, include: { rows: { orderBy: { order: "asc" } } } } },
    })) ??
    (await prisma.week.findFirst({
      where: { blockId },
      orderBy: { order: "desc" },
      include: { days: { orderBy: { index: "asc" }, include: { rows: { orderBy: { order: "asc" } } } } },
    }));

  const order = (newest?.order ?? 0) + 1;
  await loadSettings();
  const block = await prisma.block.findUniqueOrThrow({ where: { id: blockId }, select: { startDate: true } });
  const blankDays = templateDays(block.startDate).map((d) => ({ ...d, rows: [] }));

  await prisma.$transaction(async (tx) => {
    const week = await tx.week.create({ data: { blockId, order } });

    // A phase with no weeks yet starts from a blank one rather than a copy.
    const source = last?.days ?? blankDays;

    for (const day of source) {
      const created = await tx.day.create({
        data: { weekId: week.id, index: day.index, label: day.label, rest: day.rest },
      });

      for (const row of day.rows) {
        await tx.exerciseRow.create({
          data: {
            dayId: created.id,
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
            fromId: newestRows.get(slot(day.index, row.order)) ?? null,
          },
        });
      }
    }
  });

  await applyAllProgressions(blockId);
  revalidatePath("/programming");
}

/**
 * The writes that bring every chain in a phase up to date with the rules on its head —
 * or only the chains starting at `headIds`. The phase is read in one go and the chains
 * walked in memory, since a chain is only ever as long as the phase has weeks.
 */
async function progressionWrites(blockId: string, headIds?: string[]) {
  const block = await prisma.block.findUniqueOrThrow({
    where: { id: blockId },
    select: {
      athlete: { select: { unit: true } },
      weeks: {
        select: {
          order: true,
          locked: true,
          days: { select: { rows: { include: { rules: true } } } },
        },
      },
    },
  });

  const unit = block.athlete.unit;
  const rows = block.weeks.flatMap((week) =>
    week.days.flatMap((day) => day.rows.map((row) => ({ ...row, week: week.order, locked: week.locked }))),
  );
  const byFrom = new Map(rows.filter((r) => r.fromId !== null).map((r) => [r.fromId!, r]));
  const heads = headIds
    ? rows.filter((r) => headIds.includes(r.id))
    : rows.filter((r) => r.rules.length > 0);

  const writes = [];
  for (const head of heads) {
    if (head.rules.length === 0) continue;
    // Everything the head says about *how* the set is written — the intensity type and
    // the ramp step — travels with the projected numbers. Without it a later week keeps
    // its own ramp (usually none), and an RPE projected into a week still typed as a
    // weight is read as kilos.
    const shape = { intensityType: head.intensityType, rampStep: head.rampStep };
    const seen = new Set([head.id]);

    for (let next = byFrom.get(head.id); next && !seen.has(next.id); next = byFrom.get(next.id)) {
      seen.add(next.id);
      // A locked week keeps whatever's in it — skip the write, but keep walking the
      // chain so weeks after it still project from the head as if it weren't there.
      if (next.locked) continue;
      // Rules count weeks from the head's own week, so a chain starting in week 2 still
      // fires on its second link.
      const data = { ...shape, ...project(head, head.rules, next.week - head.week + 1, unit) };
      // A week already holding what the rules say needs no write.
      const row = next as unknown as Record<string, unknown>;
      if (Object.entries(data).every(([k, v]) => row[k] === v)) continue;
      writes.push(prisma.exerciseRow.update({ where: { id: next.id }, data }));
    }
  }
  return writes;
}

/** Rewrites the weeks after this row from its rules. The row itself is the source. */
export async function applyProgression(rowId: string) {
  assertCoach();
  const row = await prisma.exerciseRow.findUnique({
    where: { id: rowId },
    select: { day: { select: { week: { select: { blockId: true } } } } },
  });
  if (!row) return;
  const writes = await progressionWrites(row.day.week.blockId, [rowId]);
  if (writes.length > 0) await prisma.$transaction(writes);
  revalidatePath("/programming");
}

export async function applyAllProgressions(blockId: string) {
  assertCoach();
  // Only chain heads carry rules; a row copied into a later week inherits by its link.
  const writes = await progressionWrites(blockId);
  if (writes.length > 0) await prisma.$transaction(writes);
  revalidatePath("/programming");
}

export async function addRule(rowId: string, rule: Omit<Rule, "id" | "order" | "enabled">) {
  assertCoach();
  const last = await prisma.progressionRule.findFirst({
    where: { rowId },
    orderBy: { order: "desc" },
  });

  await prisma.progressionRule.create({
    data: { rowId, order: (last?.order ?? -1) + 1, ...rule },
  });
  await applyProgression(rowId);
}

export async function updateRule(
  ruleId: string,
  patch: Partial<Pick<Rule, "amount" | "everyWeeks" | "startWeek" | "endWeek" | "enabled" | "field" | "op">>,
) {
  assertCoach();
  const rule = await prisma.progressionRule.update({ where: { id: ruleId }, data: patch });
  await applyProgression(rule.rowId);
}

export async function deleteRule(ruleId: string) {
  assertCoach();
  const rule = await prisma.progressionRule.delete({ where: { id: ruleId } });
  await applyProgression(rule.rowId);
}

/** A phase's weeks, each starting as the same set of days. */
function weeksOf(count: number, days: { index: number; label: string; rest: boolean }[]) {
  return {
    create: Array.from({ length: count }, (_, i) => ({
      order: i + 1,
      days: { create: days },
    })),
  };
}

async function athleteMaxes(athleteId: string) {
  return prisma.athlete.findUniqueOrThrow({
    where: { id: athleteId },
    select: { squat1RM: true, bench1RM: true, dead1RM: true },
  });
}

/** A program is a name; it is created with its first phase already in it. */
export async function createProgram(input: {
  athleteId: string;
  name: string;
  phase: string;
  startDate: string;
  weeks: number;
}) {
  assertCoach();
  await loadSettings();
  const weeks = Math.min(52, Math.max(1, Math.round(input.weeks)));
  // A phase starts from the athlete's current maxes and then keeps its own copy.
  const maxes = await athleteMaxes(input.athleteId);
  const startDate = new Date(snapStart(input.startDate));

  const program = await prisma.program.create({
    data: {
      athleteId: input.athleteId,
      name: input.name.trim() || "New program",
      phases: {
        create: {
          athleteId: input.athleteId,
          order: 0,
          phase: input.phase.trim() || phaseName(0),
          startDate,
          ...maxes,
          weeks: weeksOf(weeks, templateDays(startDate)),
        },
      },
    },
    include: { phases: true },
  });

  revalidateAll();
  return { programId: program.id, phaseId: program.phases[0].id };
}

/**
 * The next phase of a program. It starts the day after the one before it ends and takes
 * the athlete's current maxes — which is the point of phases having their own: the block
 * already written keeps the numbers it was written against.
 */
export async function addPhase(programId: string, input: { phase?: string; weeks?: number } = {}) {
  assertCoach();
  const program = await prisma.program.findUniqueOrThrow({
    where: { id: programId },
    include: { phases: { orderBy: { order: "asc" }, include: { weeks: true } } },
  });

  const last = program.phases[program.phases.length - 1];
  const start = last
    ? new Date(last.startDate.getTime() + last.weeks.length * 7 * 24 * 60 * 60 * 1000)
    : new Date();

  const settings = await loadSettings();
  const maxes = await athleteMaxes(program.athleteId);
  const weeks = Math.min(52, Math.max(1, Math.round(input.weeks ?? settings.phaseWeeks)));
  const nth = program.phases.length;

  const phase = await prisma.block.create({
    data: {
      athleteId: program.athleteId,
      programId,
      order: (last?.order ?? -1) + 1,
      phase: input.phase?.trim() || phaseName(nth),
      startDate: start,
      ...maxes,
      weeks: weeksOf(weeks, templateDays(start)),
    },
  });

  revalidateAll();
  return phase.id;
}

export async function updateProgram(programId: string, patch: { name?: string }) {
  assertCoach();
  await prisma.program.update({
    where: { id: programId },
    data: patch.name === undefined ? {} : { name: patch.name.trim() || "Untitled program" },
  });
  revalidateAll();
}

export async function deleteProgram(programId: string) {
  assertCoach();
  await prisma.program.delete({ where: { id: programId } });
  revalidateAll();
}

/** A phase's own settings: what it is called and when it runs. */
export async function updateBlock(blockId: string, patch: { phase?: string; startDate?: string }) {
  assertCoach();
  const { startDate, phase } = patch;
  await loadSettings();
  await prisma.block.update({
    where: { id: blockId },
    data: {
      ...(phase !== undefined ? { phase: phase.trim() || "Phase" } : {}),
      ...(startDate ? { startDate: new Date(snapStart(startDate)) } : {}),
    },
  });
  revalidateAll();
}

/**
 * Reads a `.topset.json` file into a new program for this athlete, phases and all. The file
 * is parsed and checked by `parseProgramFile` first — it came from outside, so nothing in
 * it is taken on trust — and it only ever creates, never touches an existing program.
 */
export async function importProgram(
  athleteId: string,
  contents: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  assertCoach();
  // Returned rather than thrown: a thrown message is redacted in production, and the
  // whole point of the check is telling the coach what is wrong with their file.
  let file;
  try {
    file = parseProgramFile(contents);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Unreadable file." };
  }
  if (file.phases.length === 0) return { ok: false, error: "That file has no phases in it." };

  // Every week comes with its own days and rows, and keeps its lock.
  const program = await prisma.program.create({
    data: {
      athleteId,
      name: file.name.trim() || "Imported program",
      phases: {
        create: file.phases.map((phase, order) => ({
          athleteId,
          order,
          phase: phase.phase,
          startDate: new Date(phase.startDate),
          squat1RM: phase.squat1RM,
          bench1RM: phase.bench1RM,
          dead1RM: phase.dead1RM,
          weeks: {
            create: phase.weeks.map((week) => ({
              order: week.week,
              locked: week.locked,
              days: {
                create: week.days.map((day) => ({
                  index: day.index,
                  label: day.label,
                  rest: day.rest,
                  rows: {
                    create: day.rows.map(({ rules, ...row }) => ({
                      ...row,
                      rules: rules.length > 0 ? { create: rules } : undefined,
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

  // Nested creates cannot point rows at each other, so the chain is linked afterwards.
  for (const phase of program.phases) await relinkChain(phase.id);

  revalidateAll();
  return { ok: true, id: program.phases[0].id };
}

/**
 * Re-points every row at the matching row in the week before it, matching on the day and
 * the position in it. Used wherever weeks are built or renumbered in bulk.
 */
async function relinkChain(blockId: string) {
  const weeks = await prisma.week.findMany({
    where: { blockId },
    orderBy: { order: "asc" },
    include: { days: { include: { rows: true } } },
  });

  const slot = (dayIndex: number, order: number) => `${dayIndex}:${order}`;

  const changes = weeks.slice(1).flatMap((week, i) => {
    const before = new Map(
      weeks[i].days.flatMap((d) => d.rows.map((r) => [slot(d.index, r.order), r.id])),
    );
    return week.days.flatMap((day) =>
      day.rows
        .map((row) => ({ id: row.id, was: row.fromId, fromId: before.get(slot(day.index, row.order)) ?? null }))
        .filter((c) => c.was !== c.fromId),
    );
  });
  if (changes.length === 0) return;

  // fromId is unique, so every changed link is let go before any is set. One transaction
  // rather than one commit per row: an imported program can have hundreds of them.
  await prisma.$transaction([
    ...changes
      .filter((c) => c.was !== null)
      .map((c) => prisma.exerciseRow.update({ where: { id: c.id }, data: { fromId: null } })),
    ...changes
      .filter((c) => c.fromId !== null)
      .map((c) => prisma.exerciseRow.update({ where: { id: c.id }, data: { fromId: c.fromId } })),
  ]);
}

/** Deletes one phase. The program stays, even when that was its last phase. */
export async function deleteBlock(blockId: string) {
  assertCoach();
  await prisma.block.delete({ where: { id: blockId } });
  revalidateAll();
}

/** Drops a week and slides every later week down, keeping week numbers contiguous. */
export async function deleteWeek(blockId: string, week: number) {
  assertCoach();
  const weeks = await prisma.week.findMany({
    where: { blockId },
    orderBy: { order: "asc" },
    include: { days: { select: { rows: { select: { id: true } } } } },
  });
  if (weeks.length <= 1) return;

  const doomed = weeks.find((w) => w.order === week);
  if (!doomed) return;

  const rowIds = weeks.flatMap((w) => w.days.flatMap((d) => d.rows.map((r) => r.id)));

  await prisma.$transaction(async (tx) => {
    // Its days and rows go with it, and the rows that pointed at them are unlinked by
    // the schema; relinkChain below joins the two sides back up.
    await tx.week.delete({ where: { id: doomed.id } });

    // Park them out of the way first: (blockId, order) is unique.
    for (const later of weeks.filter((w) => w.order > week)) {
      await tx.week.update({ where: { id: later.id }, data: { order: -later.order } });
    }
    for (const later of weeks.filter((w) => w.order > week)) {
      await tx.week.update({ where: { id: later.id }, data: { order: later.order - 1 } });
    }

    await tx.progressionRule.updateMany({
      where: { rowId: { in: rowIds }, startWeek: { gt: week } },
      data: { startWeek: { decrement: 1 } },
    });
    await tx.progressionRule.updateMany({
      where: { rowId: { in: rowIds }, endWeek: { gt: week } },
      data: { endWeek: { decrement: 1 } },
    });
    await tx.progressionRule.updateMany({
      where: { rowId: { in: rowIds }, startWeek: { lt: 2 } },
      data: { startWeek: 2 },
    });
  });

  await relinkChain(blockId);
  revalidatePath("/programming");
}

/**
 * Locks or unlocks a week. A locked week is left alone by progression rules. Unlocking
 * it re-applies progressions, so it catches back up with whatever it missed.
 */
export async function setWeekLock(weekId: string, locked: boolean) {
  assertCoach();
  const week = await prisma.week.update({ where: { id: weekId }, data: { locked } });
  if (!locked) await applyAllProgressions(week.blockId);
  revalidatePath("/programming");
}

export async function updateAthlete(
  athleteId: string,
  patch: { squat1RM?: number | null; bench1RM?: number | null; dead1RM?: number | null },
) {
  assertCoach();
  await prisma.athlete.update({ where: { id: athleteId }, data: patch });
  revalidatePath("/programming");
  revalidatePath("/athletes");
  revalidatePath("/overview");
}

/**
 * The maxes one program is written against. Editing them rewrites that program's target
 * weights and nothing else — the athlete's own 1RMs, and every other block, stay put.
 */
/**
 * Starts a phase the day the one before it ends, closing a break or undoing an overlap.
 * Every later phase moves by the same amount, so the spacing after it is kept.
 */
export async function closePhaseGap(phaseId: string) {
  assertCoach();
  const phase = await prisma.block.findUniqueOrThrow({ where: { id: phaseId } });
  const phases = await prisma.block.findMany({
    where: { programId: phase.programId },
    orderBy: { order: "asc" },
    include: { _count: { select: { weeks: true } } },
  });

  const i = phases.findIndex((p) => p.id === phaseId);
  const prev = phases[i - 1];
  if (!prev) return;

  const end = prev.startDate.getTime() + prev._count.weeks * 7 * 24 * 60 * 60 * 1000;
  const shift = end - phase.startDate.getTime();
  if (shift === 0) return;

  await prisma.$transaction(
    phases.slice(i).map((p) =>
      prisma.block.update({
        where: { id: p.id },
        data: { startDate: new Date(p.startDate.getTime() + shift) },
      }),
    ),
  );
  revalidateAll();
}

export async function updateBlockMaxes(
  blockId: string,
  patch: { squat1RM?: number | null; bench1RM?: number | null; dead1RM?: number | null },
) {
  assertCoach();
  await prisma.block.update({ where: { id: blockId }, data: patch });
  revalidatePath("/programming");
  revalidatePath("/tracking");
}

const DAY = 24 * 60 * 60 * 1000;

const PHASE_TREE = {
  weeks: {
    orderBy: { order: "asc" as const },
    include: {
      days: {
        orderBy: { index: "asc" as const },
        include: { rows: { orderBy: { order: "asc" as const }, include: { rules: { orderBy: { order: "asc" as const } } } } },
      },
    },
  },
};

/**
 * Pastes a copy of a phase into a program — the same program or any other athlete's —
 * right after `afterPhaseId`, or at the end. It starts the day the phase before it ends,
 * and the phases after it move back by its length so nothing overlaps. Pasted for the
 * same athlete it keeps the maxes it was written against; for another athlete it takes
 * theirs. Rows stay chained week to week, so progressions carry on working.
 */
export async function pastePhase(sourcePhaseId: string, targetProgramId: string, afterPhaseId?: string) {
  assertCoach();
  await loadSettings();
  const source = await prisma.block.findUniqueOrThrow({ where: { id: sourcePhaseId }, include: PHASE_TREE });
  const program = await prisma.program.findUniqueOrThrow({
    where: { id: targetProgramId },
    include: { athlete: true, phases: { orderBy: { order: "asc" }, include: { _count: { select: { weeks: true } } } } },
  });

  const phases = program.phases;
  const at = afterPhaseId ? phases.findIndex((p) => p.id === afterPhaseId) + 1 : phases.length;
  const before = phases[at - 1];
  const start = before
    ? new Date(before.startDate.getTime() + before._count.weeks * 7 * DAY)
    : new Date(snapStart(new Date().toISOString()));
  const length = source.weeks.length * 7 * DAY;
  const sameAthlete = source.athleteId === program.athleteId;
  const maxes = sameAthlete
    ? { squat1RM: source.squat1RM, bench1RM: source.bench1RM, dead1RM: source.dead1RM }
    : { squat1RM: program.athlete.squat1RM, bench1RM: program.athlete.bench1RM, dead1RM: program.athlete.dead1RM };
  const name =
    source.programId === targetProgramId ? t("{name} (copy)", { name: source.phase }) : source.phase;

  const id = await prisma.$transaction(async (tx) => {
    // Everything from the paste point on moves one place and one phase-length later.
    for (const later of phases.slice(at).reverse()) {
      await tx.block.update({
        where: { id: later.id },
        data: { order: later.order + 1, startDate: new Date(later.startDate.getTime() + length) },
      });
    }
    const phase = await tx.block.create({
      data: {
        athleteId: program.athleteId,
        programId: targetProgramId,
        order: before ? before.order + 1 : 0,
        phase: name,
        startDate: start,
        ...maxes,
      },
    });
    let previous = new Map<string, string>();
    for (const week of source.weeks) {
      previous = await copyWeekInto(tx, week, phase.id, week.order, previous, true);
    }
    return phase.id;
  });

  revalidateAll();
  return id;
}

type WeekTree = Awaited<ReturnType<typeof loadWeek>>;

function loadWeek(weekId: string) {
  return prisma.week.findUniqueOrThrow({ where: { id: weekId }, include: PHASE_TREE.weeks.include });
}

/**
 * Writes a copy of `week` into `blockId` as week `order`. Each row hangs off the row in
 * the same slot of `previous` (day index : row order → row id), and the map of the new
 * rows is returned for the week after it.
 */
async function copyWeekInto(
  tx: Tx,
  week: WeekTree,
  blockId: string,
  order: number,
  previous: Map<string, string>,
  withRules: boolean,
) {
  const created = await tx.week.create({ data: { blockId, order, locked: week.locked } });
  const next = new Map<string, string>();
  for (const day of week.days) {
    const newDay = await tx.day.create({
      data: { weekId: created.id, index: day.index, label: day.label, rest: day.rest },
    });
    for (const row of day.rows) {
      const slot = `${day.index}:${row.order}`;
      const made = await tx.exerciseRow.create({
        data: {
          dayId: newDay.id,
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
          fromId: previous.get(slot) ?? null,
          rules:
            withRules && row.rules.length > 0
              ? {
                  create: row.rules.map((r) => ({
                    order: r.order,
                    field: r.field,
                    op: r.op,
                    amount: r.amount,
                    everyWeeks: r.everyWeeks,
                    startWeek: r.startWeek,
                    endWeek: r.endWeek,
                    enabled: r.enabled,
                  })),
                }
              : undefined,
        },
      });
      next.set(slot, made.id);
    }
  }
  return next;
}

/**
 * Pastes a copy of a week into a phase right after week `afterOrder` (or at the end),
 * moving the weeks behind it up by one. Its rows join the chain between the weeks
 * either side, like a week added with "+ add week". Rules stay with the rows they were
 * written on, as they do for an added week.
 */
export async function pasteWeek(sourceWeekId: string, targetBlockId: string, afterOrder?: number) {
  assertCoach();
  const source = await loadWeek(sourceWeekId);
  const weeks = await prisma.week.findMany({
    where: { blockId: targetBlockId },
    orderBy: { order: "asc" },
    include: { days: { select: { index: true, rows: { select: { id: true, order: true } } } } },
  });
  const at = afterOrder ?? weeks.length;
  const slots = (w: (typeof weeks)[number] | undefined) =>
    new Map<string, string>((w?.days ?? []).flatMap((d) => d.rows.map((r) => [`${d.index}:${r.order}`, r.id] as [string, string])));
  const before = slots(weeks.find((w) => w.order === at));
  const after = weeks.find((w) => w.order === at + 1);

  await prisma.$transaction(async (tx) => {
    // The week behind the gap lets go of its links first: fromId is unique.
    const afterRows = after ? after.days.flatMap((d) => d.rows.map((r) => ({ id: r.id, slot: `${d.index}:${r.order}` }))) : [];
    for (const r of afterRows) await tx.exerciseRow.update({ where: { id: r.id }, data: { fromId: null } });

    for (const w of weeks.filter((w) => w.order > at).reverse()) {
      await tx.week.update({ where: { id: w.id }, data: { order: w.order + 1 } });
    }
    const made = await copyWeekInto(tx, source, targetBlockId, at + 1, before, false);

    // Rows behind the gap follow the pasted week where it has the same slot, and keep
    // following the week before it where it doesn't.
    for (const r of afterRows) {
      const from = made.get(r.slot) ?? before.get(r.slot);
      if (from) await tx.exerciseRow.update({ where: { id: r.id }, data: { fromId: from } });
    }
  });

  revalidatePath("/programming");
  return at + 1;
}

/**
 * Takes a pasted phase back out: deletes it and pulls the phases after it forward by
 * its length, undoing the room `pastePhase` made. Undo for a paste or a duplicate.
 */
export async function unpastePhase(phaseId: string) {
  assertCoach();
  const phase = await prisma.block.findUnique({
    where: { id: phaseId },
    include: { _count: { select: { weeks: true } } },
  });
  if (!phase) return;
  const length = phase._count.weeks * 7 * DAY;
  const later = await prisma.block.findMany({
    where: { programId: phase.programId, order: { gt: phase.order } },
    orderBy: { order: "asc" },
  });
  await prisma.$transaction([
    prisma.block.delete({ where: { id: phaseId } }),
    ...later.map((p) =>
      prisma.block.update({
        where: { id: p.id },
        data: { order: p.order - 1, startDate: new Date(p.startDate.getTime() - length) },
      }),
    ),
  ]);
  revalidateAll();
}

/** What "the same week" means: everything the coach wrote, nothing the athlete logged. */
const PLAN_FIELDS = [
  "tier",
  "target",
  "exercise",
  "sets",
  "reps",
  "intensityType",
  "intensity",
  "intensityMax",
  "rampStep",
  "coachNotes",
  "tempo",
  "restTime",
  "videoUrl",
] as const;

/** Fields a progression rule on that field writes — those keep coming from the rule. */
const RULED: Record<ProgField, readonly (typeof PLAN_FIELDS)[number][]> = {
  SETS: ["sets"],
  REPS: ["reps"],
  INTENSITY: ["intensityType", "intensity", "intensityMax", "rampStep"],
};

/**
 * Makes every other unlocked week of the phase the same as this one — before it and
 * after it: day names and rest days, the rows in each day, and everything written on
 * them. Locked weeks keep their own, and an edit inside a locked week stays there.
 * Fields a progression rule drives are left to the rule, which runs again at the end,
 * and meet-attempt rows stay on the day of their meet. Logged results are never touched.
 */
async function syncWeeks(weekId: string) {
  const settings = await loadSettings();
  if (!settings.syncWeeks) return;
  const source = await prisma.week.findUnique({
    where: { id: weekId },
    include: { days: { include: { rows: { orderBy: { order: "asc" } } } } },
  });
  if (!source || source.locked) return;

  const weeks = await prisma.week.findMany({
    where: { blockId: source.blockId, locked: false, id: { not: source.id } },
    include: { days: { include: { rows: { include: { rules: true } } } } },
  });
  if (weeks.length === 0) return;

  // Per slot (day : row order), the fields any rule in that chain governs.
  const slot = (dayIndex: number, order: number) => `${dayIndex}:${order}`;
  const ruled = new Map<string, Set<string>>();
  const allRows = await prisma.exerciseRow.findMany({
    where: { day: { week: { blockId: source.blockId } }, rules: { some: { enabled: true } } },
    include: { rules: true, day: { select: { index: true } } },
  });
  for (const row of allRows) {
    const set = ruled.get(slot(row.day.index, row.order)) ?? new Set<string>();
    for (const rule of row.rules) if (rule.enabled) RULED[rule.field].forEach((f) => set.add(f));
    ruled.set(slot(row.day.index, row.order), set);
  }

  const isAttempt = (exercise: string) => ATTEMPT_PATTERN.test(exercise);

  await prisma.$transaction(async (tx) => {
    for (const week of weeks) {
      for (const sDay of source.days) {
        let tDay = week.days.find((d) => d.index === sDay.index);
        if (!tDay) {
          const made = await tx.day.create({
            data: { weekId: week.id, index: sDay.index, label: sDay.label, rest: sDay.rest },
          });
          tDay = { ...made, rows: [] };
        } else if (tDay.label !== sDay.label || tDay.rest !== sDay.rest) {
          await tx.day.update({ where: { id: tDay.id }, data: { label: sDay.label, rest: sDay.rest } });
        }

        const sources = sDay.rows.filter((r) => !isAttempt(r.exercise));
        const keep = new Set(sources.map((r) => r.order));
        const targets = tDay.rows.filter((r) => !isAttempt(r.exercise));

        // Rows this week has and the source doesn't go first, so their slots are free.
        for (const r of targets) {
          if (!keep.has(r.order)) await tx.exerciseRow.delete({ where: { id: r.id } });
        }
        const bySlot = new Map(targets.filter((r) => keep.has(r.order)).map((r) => [r.order, r]));
        const taken = new Set(tDay.rows.filter((r) => isAttempt(r.exercise)).map((r) => r.order));

        for (const s of sources) {
          if (taken.has(s.order)) continue;
          const skip = ruled.get(slot(sDay.index, s.order)) ?? new Set<string>();
          const t = bySlot.get(s.order);
          const data: Record<string, unknown> = {};
          for (const f of PLAN_FIELDS) {
            if (t && skip.has(f)) continue;
            if (!t || t[f] !== s[f]) data[f] = s[f];
          }
          if (t) {
            if (Object.keys(data).length > 0) await tx.exerciseRow.update({ where: { id: t.id }, data });
          } else {
            await tx.exerciseRow.create({
              data: { ...(data as object), dayId: tDay.id, order: s.order } as Parameters<typeof tx.exerciseRow.create>[0]["data"],
            });
          }
        }
      }
    }
  });

  await relinkChain(source.blockId);
  // Rule-driven fields were left alone above; this writes them from the rules again.
  const writes = await progressionWrites(source.blockId);
  if (writes.length > 0) await prisma.$transaction(writes);
}

async function syncFromRow(rowId: string) {
  const row = await prisma.exerciseRow.findUnique({ where: { id: rowId }, select: { day: { select: { weekId: true } } } });
  if (row) await syncWeeks(row.day.weekId);
}

async function syncFromDay(dayId: string) {
  const day = await prisma.day.findUnique({ where: { id: dayId }, select: { weekId: true } });
  if (day) await syncWeeks(day.weekId);
}
