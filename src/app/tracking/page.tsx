import Link from "next/link";
import { redirect } from "next/navigation";
import { BodyweightPanel } from "@/components/BodyweightPanel";
import { Sidebar } from "@/components/Sidebar";
import { TrackingSheet } from "@/components/TrackingSheet";
import { classLimit } from "@/lib/bodyweight";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { blockWindow, startOfDay } from "@/lib/overview";
import { liftProgress } from "@/lib/progress";
import { exerciseHistory } from "@/lib/exercise-history";
import { getAllPhasesForAthlete, getBodyweights, getCoach, getCheckins, getNextMeets, getWorkspace, toBlockData } from "@/lib/queries";
import type { BlockData } from "@/lib/types";
import { loadSettings } from "@/lib/coach-settings";
import { videoLists } from "@/lib/videos";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function TrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ athlete?: string; block?: string; week?: string }>;
}) {
  await loadSettings();
  const params = await searchParams;
  const coach = await getCoach();
  if (coach.athletes.length === 0) redirect("/athletes");

  const athlete = coach.athletes.find((a) => a.id === params.athlete) ?? coach.athletes[0];
  const at = coach.athletes.indexOf(athlete);
  const neighbour = (i: number) => {
    const a = coach.athletes[(i + coach.athletes.length) % coach.athletes.length];
    return a.id === athlete.id ? null : { id: a.id, name: a.name };
  };
  const now = new Date();
  const [{ programs, program, phase }, phases, weights, meets, checkins] = await Promise.all([
    getWorkspace(athlete.id, undefined, params.block),
    getAllPhasesForAthlete(athlete.id),
    getBodyweights([athlete.id]),
    getNextMeets([athlete.id], startOfDay(now)),
    getCheckins([athlete.id]),
  ]);
  const meet = meets.get(athlete.id);

  // The week asked for, else the one the phase is in today, else its first.
  const window = phase ? blockWindow({ startDate: phase.startDate, weeks: phase.weeks.length }, now) : null;
  const asked = Number(params.week);
  const initialWeek = Number.isInteger(asked) && asked >= 1 ? asked : window?.status === "active" ? window.week : 1;

  const series = {
    prescribed: liftProgress(phases, athlete, "prescribed"),
    estimated: liftProgress(phases, athlete, "estimated"),
  };

  const blockData: BlockData | null = phase && toBlockData(phase);
  const videos = blockData
    ? videoLists(blockData.weeks.flatMap((w) => w.days.flatMap((d) => d.rows.map((r) => r.id))))
    : {};

  return (
    <div className="flex h-screen">
      <Sidebar
        athletes={coach.athletes}
        activeAthleteId={athlete.id}
        coachUsername={coach.username} coachName={coach.name}
        section="tracking"
      />

      {blockData ? (
        <TrackingSheet
          block={blockData}
          phases={(program?.phases ?? []).map((p) => ({ id: p.id, phase: p.phase }))}
          programs={programs.map((p) => ({
            id: p.id,
            name: p.name,
            firstPhaseId: p.phases[0]?.id ?? null,
          }))}
          programName={program?.name ?? ""}
          athlete={athlete}
          hasLink={athlete.accessToken !== null}
          neighbours={{ prev: neighbour(at - 1), next: neighbour(at + 1) }}
          initialWeek={initialWeek}
          today={ymdOf(calendarToday())}
          series={series}
          videos={videos}
          bodyweight={weights.get(athlete.id) ?? []}
          checkins={checkins.get(athlete.id) ?? { questions: [], answers: [] }}
          history={exerciseHistory(phases, athlete)}
          meet={meet ? { name: meet.name, day: ymdOf(meet.date), weightClass: meet.weightClass, limit: classLimit(meet.weightClass) } : null}
        />
      ) : (
        <main className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto mt-24 max-w-[720px] px-6 text-center">
            <div className="text-[14px]">{t("Nothing to track for {name} yet.", { name: athlete.name })}</div>
            <div className="mt-1 text-[12px] text-muted">
              {t("Logged weights come from a program, so write one first.")}
            </div>
            <Link
              href={`/programming?athlete=${athlete.id}`}
              className="mt-4 inline-block rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
            >
              {t("Open programming")}
            </Link>
          </div>
          <div className="mx-auto mt-10 max-w-[720px] px-6">
            <BodyweightPanel
              athleteId={athlete.id}
              unit={athlete.unit === "LB" ? "lb" : "kg"}
              today={ymdOf(calendarToday())}
              entries={weights.get(athlete.id) ?? []}
              meet={meet ? { name: meet.name, day: ymdOf(meet.date), weightClass: meet.weightClass, limit: classLimit(meet.weightClass) } : null}
            />
          </div>
        </main>
      )}
    </div>
  );
}
