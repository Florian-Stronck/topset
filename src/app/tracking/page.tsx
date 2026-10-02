import Link from "next/link";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { ProgressView } from "@/components/tracking/ProgressView";
import { ReviewView } from "@/components/tracking/ReviewView";
import { ScheduleView } from "@/components/tracking/ScheduleView";
import { TrackingShell, type TrackingView } from "@/components/tracking/TrackingShell";
import { InjuryPanel } from "@/components/InjuryPanel";
import { deleteCoachInjury, saveCoachInjury } from "@/app/tracking/actions";
import { WellnessView } from "@/components/tracking/WellnessView";
import { weightToMake } from "@/lib/bodyweight";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { blockWindow, startOfDay } from "@/lib/overview";
import { liftProgress } from "@/lib/progress";
import { exerciseHistory } from "@/lib/exercise-history";
import {
  getAllPhasesForAthlete,
  getBodyweights,
  getCoach,
  getCheckins,
  getMeetings,
  getMessages,
  getMoves,
  getNextMeets,
  getNutrition,
  getTargetSpans,
  getWorkspace,
  scheduleNews,
  injuriesFor,
  toBlockData,
} from "@/lib/queries";
import { addDays, sessionsOf } from "@/lib/schedule";
import type { CalendarSession } from "@/components/tracking/ScheduleCalendar";
import { previousLogs, REVIEW_FILTERS, sessionDrift, unreviewedDays, type ReviewFilter } from "@/lib/tracking";
import type { BlockData } from "@/lib/types";
import { loadSettings } from "@/lib/coach-settings";
import { videoLists } from "@/lib/videos";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** The longest stretch the Wellness charts look back over. */
const WELLNESS_DAYS = 56;

export default async function TrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ athlete?: string; block?: string; week?: string; view?: string; show?: string }>;
}) {
  await loadSettings();
  const params = await searchParams;
  const coach = await getCoach();
  if (coach.athletes.length === 0) redirect("/athletes");

  const view: TrackingView =
    params.view === "progress" || params.view === "wellness" || params.view === "schedule" ? params.view : "review";
  const show = REVIEW_FILTERS.includes(params.show as ReviewFilter) ? (params.show as ReviewFilter) : null;

  const athlete = coach.athletes.find((a) => a.id === params.athlete) ?? coach.athletes[0];
  const at = coach.athletes.indexOf(athlete);
  const neighbour = (i: number) => {
    const a = coach.athletes[(i + coach.athletes.length) % coach.athletes.length];
    return a.id === athlete.id ? null : { id: a.id, name: a.name };
  };
  const now = new Date();
  const today = ymdOf(calendarToday());
  const [{ programs, program, phase }, phases, checkinMap, news, moves] = await Promise.all([
    getWorkspace(athlete.id, undefined, params.block),
    getAllPhasesForAthlete(athlete.id),
    getCheckins([athlete.id]),
    scheduleNews(athlete.id, today),
    getMoves(athlete.id),
  ]);
  const checkins = checkinMap.get(athlete.id) ?? { questions: [], answers: [], photos: [] };
  const unit = athlete.unit === "LB" ? "lb" : "kg";

  // The week asked for, else the one the phase is in today, else its first.
  const window = phase ? blockWindow({ startDate: phase.startDate, weeks: phase.weeks.length }, now) : null;
  const asked = Number(params.week);
  const initialWeek = Number.isInteger(asked) && asked >= 1 ? asked : window?.status === "active" ? window.week : 1;

  const blockData: BlockData | null = phase && toBlockData(phase);
  // Sessions the athlete moved, so logs and reviews fall on the day they were done.
  const moved = Object.fromEntries(moves.map((m) => [m.dayId, m.day]));
  const moveMap = new Map(Object.entries(moved));
  const unreviewed = blockData ? unreviewedDays(blockData, checkins.answers, moveMap).size : 0;

  async function wellness() {
    const [weights, nutrition, targets, meets, injuries] = await Promise.all([
      getBodyweights([athlete.id]),
      getNutrition([athlete.id], addDays(today, -(WELLNESS_DAYS - 1))),
      getTargetSpans(athlete.id),
      getNextMeets([athlete.id], startOfDay(now)),
      injuriesFor(athlete.id),
    ]);
    const meet = meets.get(athlete.id);
    return (
      <>
      <div className="mt-5">
        <InjuryPanel initial={injuries} today={today} save={saveCoachInjury.bind(null, athlete.id)} remove={deleteCoachInjury} />
      </div>
      <WellnessView
        athleteId={athlete.id}
        unit={unit}
        today={today}
        checkins={checkins}
        drift={sessionDrift(phases, addDays(today, -(WELLNESS_DAYS - 1)), today, moveMap)}
        bodyweight={weights.get(athlete.id) ?? []}
        nutrition={nutrition.get(athlete.id) ?? []}
        targets={targets}
        meet={meet ? { name: meet.name, weightClass: meet.weightClass, ...weightToMake(meet) } : null}
      />
      </>
    );
  }

  let body: React.ReactNode;
  if (view === "schedule") {
    // Every session with something in it, where it now falls, and whether it was done.
    type Phase = (typeof phases)[number];
    const calendar: CalendarSession[] = sessionsOf<Phase["weeks"][number]["days"][number], Phase>(phases, moveMap)
      .filter((s) => s.day.rows.some((r) => r.exercise.trim() !== ""))
      .map((s) => ({
        ymd: s.ymd,
        label: s.day.label,
        movedFrom: s.movedFrom ?? null,
        status: s.day.rows.some((r) => r.actualWeight !== null) ? "done" : s.ymd < today ? "missed" : "plan",
      }));
    body = (
      <ScheduleView
        athlete={{ id: athlete.id, name: athlete.name }}
        today={today}
        moves={moves}
        meetings={await getMeetings(athlete.id)}
        calendar={calendar}
      />
    );
  } else if (view === "wellness") {
    body = await wellness();
  } else if (!blockData) {
    body = (
      <div className="mx-auto mt-16 max-w-[720px] text-center">
        <div className="text-[14px]">{t("Nothing to track for {name} yet.", { name: athlete.name })}</div>
        <div className="mt-1 text-[12px] text-muted">{t("Logged weights come from a program, so write one first.")}</div>
        <Link
          href={`/programming?athlete=${athlete.id}`}
          className="mt-4 inline-block rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
        >
          {t("Open programming")}
        </Link>
      </div>
    );
  } else if (view === "progress") {
    body = (
      <ProgressView
        block={blockData}
        athlete={athlete}
        today={today}
        series={{
          prescribed: liftProgress(phases, athlete, "prescribed"),
          estimated: liftProgress(phases, athlete, "estimated"),
        }}
        history={exerciseHistory(phases, athlete, moveMap)}
        moves={moved}
      />
    );
  } else {
    const messages = await getMessages(athlete.id);
    const rowIds = blockData.weeks.flatMap((w) => w.days.flatMap((d) => d.rows.map((r) => r.id)));
    body = (
      <ReviewView
        block={blockData}
        athlete={athlete}
        initialWeek={initialWeek}
        today={today}
        videos={videoLists(rowIds)}
        checkins={checkins}
        messages={messages}
        moves={moved}
        previous={previousLogs(blockData, exerciseHistory(phases, athlete, moveMap), moveMap)}
        show={show}
        hasLink={athlete.accessToken !== null}
      />
    );
  }

  return (
    <div className="flex h-screen">
      <Sidebar athletes={coach.athletes} activeAthleteId={athlete.id} coachUsername={coach.username} coachName={coach.name} section="tracking" keep={view === "review" ? undefined : `view=${view}`} />
      <TrackingShell
        view={view}
        athlete={{ id: athlete.id, name: athlete.name }}
        neighbours={{ prev: neighbour(at - 1), next: neighbour(at + 1) }}
        programs={programs.map((p) => ({ id: p.id, name: p.name, firstPhaseId: p.phases[0]?.id ?? null }))}
        phases={(program?.phases ?? []).map((p) => ({ id: p.id, phase: p.phase }))}
        block={blockData ? { id: blockData.id, programId: blockData.program.id } : null}
        programName={program?.name ?? ""}
        hasLink={athlete.accessToken !== null}
        unreviewed={unreviewed}
        scheduleNews={news}
      >
        {body}
      </TrackingShell>
    </div>
  );
}
