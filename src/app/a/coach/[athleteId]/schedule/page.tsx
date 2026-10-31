import { athletePage } from "@/app/a/coach/[athleteId]/athlete";
import { PhoneActions } from "@/app/a/coach/PhoneActions";
import { Locked } from "@/app/a/coach/parts";
import type { CalendarSession } from "@/components/tracking/ScheduleCalendar";
import { ScheduleView } from "@/components/tracking/ScheduleView";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { getAllPhasesForAthlete, getMeetings, getMoveMap, getMoves } from "@/lib/queries";
import { sessionsOf } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/** Schedule: sessions the athlete moved, and meetings either way. */
export default async function SchedulePage({ params }: { params: Promise<{ athleteId: string }> }) {
  const page = await athletePage((await params).athleteId);
  if (!page) return null;
  const { athlete } = page;
  const today = ymdOf(calendarToday());
  const [phases, moveMap, moves, meetings] = await Promise.all([
    getAllPhasesForAthlete(athlete.id),
    getMoveMap([athlete.id]),
    getMoves(athlete.id),
    getMeetings(athlete.id),
  ]);
  // As the Overview's Schedule has it: every session with something in it, where it now falls.
  type Phase = (typeof phases)[number];
  const calendar: CalendarSession[] = sessionsOf<Phase["weeks"][number]["days"][number], Phase>(phases, moveMap, athlete.activeProgramId)
    .filter((s) => s.day.rows.some((r) => r.exercise.trim() !== ""))
    .map((s) => ({
      ymd: s.ymd,
      label: s.day.label,
      movedFrom: s.movedFrom ?? null,
      status: s.day.rows.some((r) => r.actualWeight !== null) ? "done" : s.ymd < today ? "missed" : "plan",
    }));

  return (
    <PhoneActions clips={{}}>
      <Locked role={athlete.share.role} need="edit">
        <ScheduleView athlete={{ id: athlete.id, name: athlete.name }} today={today} moves={moves} meetings={meetings} calendar={calendar} />
      </Locked>
    </PhoneActions>
  );
}
