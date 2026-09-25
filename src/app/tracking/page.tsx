import Link from "next/link";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { ProgressView } from "@/components/tracking/ProgressView";
import { ReviewView } from "@/components/tracking/ReviewView";
import { TrackingShell, type TrackingView } from "@/components/tracking/TrackingShell";
import { WellnessView } from "@/components/tracking/WellnessView";
import { classLimit } from "@/lib/bodyweight";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { blockWindow, startOfDay } from "@/lib/overview";
import { liftProgress } from "@/lib/progress";
import { exerciseHistory } from "@/lib/exercise-history";
import {
  getAllPhasesForAthlete,
  getBodyweights,
  getCoach,
  getCheckins,
  getMessages,
  getNextMeets,
  getWorkspace,
  toBlockData,
} from "@/lib/queries";
import { addDays } from "@/lib/schedule";
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

  const view: TrackingView = params.view === "progress" || params.view === "wellness" ? params.view : "review";
  const show = REVIEW_FILTERS.includes(params.show as ReviewFilter) ? (params.show as ReviewFilter) : null;

  const athlete = coach.athletes.find((a) => a.id === params.athlete) ?? coach.athletes[0];
  const at = coach.athletes.indexOf(athlete);
  const neighbour = (i: number) => {
    const a = coach.athletes[(i + coach.athletes.length) % coach.athletes.length];
    return a.id === athlete.id ? null : { id: a.id, name: a.name };
  };
  const now = new Date();
  const today = ymdOf(calendarToday());
  const [{ programs, program, phase }, phases, checkinMap] = await Promise.all([
    getWorkspace(athlete.id, undefined, params.block),
    getAllPhasesForAthlete(athlete.id),
    getCheckins([athlete.id]),
  ]);
  const checkins = checkinMap.get(athlete.id) ?? { questions: [], answers: [] };
  const unit = athlete.unit === "LB" ? "lb" : "kg";

  // The week asked for, else the one the phase is in today, else its first.
  const window = phase ? blockWindow({ startDate: phase.startDate, weeks: phase.weeks.length }, now) : null;
  const asked = Number(params.week);
  const initialWeek = Number.isInteger(asked) && asked >= 1 ? asked : window?.status === "active" ? window.week : 1;

  const blockData: BlockData | null = phase && toBlockData(phase);
  const unreviewed = blockData ? unreviewedDays(blockData, checkins.answers).size : 0;

  async function wellness() {
    const [weights, meets] = await Promise.all([getBodyweights([athlete.id]), getNextMeets([athlete.id], startOfDay(now))]);
    const meet = meets.get(athlete.id);
    return (
      <WellnessView
        athleteId={athlete.id}
        unit={unit}
        today={today}
        checkins={checkins}
        drift={sessionDrift(phases, addDays(today, -(WELLNESS_DAYS - 1)), today)}
        bodyweight={weights.get(athlete.id) ?? []}
        meet={meet ? { name: meet.name, day: ymdOf(meet.date), weightClass: meet.weightClass, limit: classLimit(meet.weightClass) } : null}
      />
    );
  }

  let body: React.ReactNode;
  if (view === "wellness") {
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
        history={exerciseHistory(phases, athlete)}
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
        previous={previousLogs(blockData, exerciseHistory(phases, athlete))}
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
      >
        {body}
      </TrackingShell>
    </div>
  );
}
