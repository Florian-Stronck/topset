import type { MeetLift } from "@prisma/client";
import { MEET_LIFTS } from "@/lib/competition";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { injuryData, injuryLabel, isActive } from "@/lib/injuries";
import { parseReminders, REMINDER_KINDS } from "@/lib/meet-reminders";
import { prisma } from "@/lib/prisma";
import { getBodyweights, type getCoach } from "@/lib/queries";
import { addDays } from "@/lib/schedule";
import { canEdit } from "@/lib/share";

/** Why an athlete may or may not belong in this competition, for the Add dialog; the client words it. */
export type CandidateHint = { kind: "injury" | "meet" | "block" | "last"; name: string } | null;

export type Entry = {
  meetId: string;
  athlete: { id: string; name: string; unit: "KG" | "LB" };
  weightClass: string | null;
  session: string | null;
  /** The first attempt of each lift; null where none is planned. */
  openers: Record<MeetLift, number | null>;
  goal: number | null;
  bodyweight: number | null;
  tasksDone: number;
  tasksTotal: number;
};

export type Candidate = {
  id: string;
  name: string;
  entered: boolean;
  /** Shared to look at only: can't be entered. */
  editable: boolean;
  weightClass: string | null;
  hint: CandidateHint;
};

export type CompetitionDetailData = {
  competition: {
    id: string;
    name: string;
    date: string;
    venue: string | null;
    federation: string | null;
    weighInDay: string | null;
    weighInTime: string | null;
    startTime: string | null;
    rackBrand: string | null;
    remindersOn: number;
    shared: boolean;
  };
  entries: Entry[];
  candidates: Candidate[];
  /** Weight classes used across the coach's meets, for the Add dialog's suggestions. */
  classes: string[];
  today: string;
};

export async function competitionDetail(id: string, coach: Awaited<ReturnType<typeof getCoach>>): Promise<CompetitionDetailData | null> {
  const comp = await prisma.competition.findFirst({
    where: { id, coachId: coach.id },
    include: { meets: { include: { attempts: { where: { number: 1 }, select: { lift: true, weight: true } } } } },
  });
  if (!comp) return null;

  const mine = coach.athletes.filter((a) => a.coachId === coach.id || comp.meets.some((m) => m.athleteId === a.id));
  const ids = mine.map((a) => a.id);
  const day = ymdOf(calendarToday());
  const [tasks, weights, allMeets, injuries, blocks] = await Promise.all([
    prisma.meetTask.groupBy({ by: ["meetId", "done"], where: { meetId: { in: comp.meets.map((m) => m.id) }, deletedAt: null }, _count: true }),
    getBodyweights(comp.meets.map((m) => m.athleteId)),
    prisma.meet.findMany({
      where: { athleteId: { in: ids } },
      orderBy: { date: "asc" },
      select: { athleteId: true, competitionId: true, name: true, date: true, weightClass: true },
    }),
    prisma.injury.findMany({ where: { athleteId: { in: ids }, OR: [{ endDay: null }, { endDay: { gt: day } }], day: { lte: day } } }),
    prisma.block.findMany({
      where: { athleteId: { in: ids }, startDate: { lte: new Date() } },
      select: { athleteId: true, phase: true, startDate: true, program: { select: { name: true } }, _count: { select: { weeks: true } } },
    }),
  ]);

  const entries: Entry[] = comp.meets.map((m) => {
    const athlete = coach.athletes.find((a) => a.id === m.athleteId);
    const mine = tasks.filter((t) => t.meetId === m.id);
    const count = (done?: boolean) => mine.filter((t) => done === undefined || t.done === done).reduce((n, t) => n + t._count, 0);
    const weighIn = m.weighInDay ?? ymdOf(m.date);
    return {
      meetId: m.id,
      athlete: { id: m.athleteId, name: athlete?.name ?? "", unit: athlete?.unit ?? "KG" },
      weightClass: m.weightClass,
      session: m.session,
      openers: Object.fromEntries(MEET_LIFTS.map((l) => [l, m.attempts.find((a) => a.lift === l)?.weight ?? null])) as Entry["openers"],
      goal: m.goal,
      // Weighed in on the phone: the last weigh-in that day counts until the coach writes one.
      bodyweight: m.bodyweight ?? (weights.get(m.athleteId) ?? []).findLast((e) => e.day === weighIn)?.weight ?? null,
      tasksDone: count(true),
      tasksTotal: count(),
    };
  });

  const entered = new Set(comp.meets.map((m) => m.athleteId));
  const candidates: Candidate[] = mine.map((a) => {
    const meets = allMeets.filter((m) => m.athleteId === a.id);
    const injury = injuries.map(injuryData).find((i, n) => injuries[n].athleteId === a.id && isActive(i, day));
    const other = meets.find((m) => m.competitionId !== comp.id && ymdOf(m.date) >= day);
    const block = blocks.find((b) => b.athleteId === a.id && day < addDays(ymdOf(b.startDate), b._count.weeks * 7));
    const last = meets.findLast((m) => ymdOf(m.date) < day);
    const hint: CandidateHint = injury
      ? { kind: "injury", name: injuryLabel(injury) }
      : other
        ? { kind: "meet", name: other.name }
        : block
          ? { kind: "block", name: `${block.program.name} · ${block.phase}` }
          : last
            ? { kind: "last", name: last.name }
            : null;
    return { id: a.id, name: a.name, entered: entered.has(a.id), editable: canEdit(a.share), weightClass: meets.findLast((m) => m.weightClass)?.weightClass ?? null, hint };
  });

  return {
    competition: {
      id: comp.id,
      name: comp.name,
      date: comp.date.toISOString(),
      venue: comp.venue,
      federation: comp.federation,
      weighInDay: comp.weighInDay,
      weighInTime: comp.weighInTime,
      startTime: comp.startTime,
      rackBrand: comp.rackBrand,
      remindersOn: REMINDER_KINDS.filter((k) => parseReminders(comp.reminders).on[k]).length,
      shared: comp.shared,
    },
    entries,
    candidates,
    classes: [...new Set(allMeets.map((m) => m.weightClass).filter((c): c is string => Boolean(c)))],
    today: new Date().toISOString(),
  };
}
