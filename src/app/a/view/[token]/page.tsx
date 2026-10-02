import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SettingsProvider } from "@/components/SettingsProvider";
import { ProgressView } from "@/components/tracking/ProgressView";
import { ReviewView } from "@/components/tracking/ReviewView";
import { InjuryPanel } from "@/components/InjuryPanel";
import { WellnessView } from "@/components/tracking/WellnessView";
import { getAthleteByViewToken } from "@/lib/athlete-queries";
import { weightToMake } from "@/lib/bodyweight";
import { loadSettings } from "@/lib/coach-settings";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { exerciseHistory } from "@/lib/exercise-history";
import { t } from "@/lib/i18n";
import { SHELL_MAX_WIDTH } from "@/lib/layout";
import { blockWindow, startOfDay } from "@/lib/overview";
import { liftProgress } from "@/lib/progress";
import { getAllPhasesForAthlete, getBodyweights, getCheckins, getMoveMap, getNextMeets, getNutrition, getTargetSpans, getWorkspace, injuriesFor, toBlockData } from "@/lib/queries";
import { addDays } from "@/lib/schedule";
import { forAthlete } from "@/lib/settings";
import { previousLogs, sessionDrift } from "@/lib/tracking";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Topset Tracking",
  robots: { index: false, follow: false },
};

/** The longest stretch the Wellness charts look back over. */
const WELLNESS_DAYS = 56;

const VIEWS = [
  { id: "review", label: "Review" },
  { id: "progress", label: "Progress" },
  { id: "wellness", label: "Wellness" },
] as const;

/**
 * The viewer link: an athlete's Tracking for a second coach, read-only. The same three
 * views the coach has, without review marks, notes to the athlete, or anything that writes.
 */
export default async function ViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ block?: string; week?: string; view?: string }>;
}) {
  const { token } = await params;
  const athlete = await getAthleteByViewToken(token);
  if (!athlete) notFound();
  const settings = await loadSettings(athlete.coachId);
  const query = await searchParams;

  const view = query.view === "progress" || query.view === "wellness" ? query.view : "review";
  const now = new Date();
  const today = ymdOf(calendarToday());
  const [{ programs, program, phase }, phases, checkinMap, moveMap] = await Promise.all([
    getWorkspace(athlete.id, undefined, query.block),
    getAllPhasesForAthlete(athlete.id),
    getCheckins([athlete.id]),
    getMoveMap([athlete.id]),
  ]);
  const moved = Object.fromEntries(moveMap);
  const checkins = checkinMap.get(athlete.id) ?? { questions: [], answers: [], photos: [] };
  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const blockData = phase && toBlockData(phase);

  const href = (next: { view?: string; block?: string }) => {
    const p = new URLSearchParams();
    const v = next.view ?? view;
    const b = next.block ?? query.block;
    if (v !== "review") p.set("view", v);
    if (b) p.set("block", b);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };

  let body: React.ReactNode;
  if (view === "wellness") {
    const [weights, nutrition, targets, meets, injuries] = await Promise.all([
      getBodyweights([athlete.id]),
      getNutrition([athlete.id], addDays(today, -(WELLNESS_DAYS - 1))),
      getTargetSpans(athlete.id),
      getNextMeets([athlete.id], startOfDay(now)),
      injuriesFor(athlete.id),
    ]);
    const meet = meets.get(athlete.id);
    body = (
      <>
      <div className="mt-5">
        <InjuryPanel initial={injuries} today={today} />
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
        readOnly
      />
      </>
    );
  } else if (!blockData) {
    body = <div className="mt-16 text-center text-[14px] text-muted">{t("Nothing to track for {name} yet.", { name: athlete.name })}</div>;
  } else if (view === "progress") {
    body = (
      <ProgressView
        block={blockData}
        athlete={athlete}
        today={today}
        series={{ prescribed: liftProgress(phases, athlete, "prescribed"), estimated: liftProgress(phases, athlete, "estimated") }}
        history={exerciseHistory(phases, athlete, moveMap)}
        moves={moved}
        readOnly
      />
    );
  } else {
    const window = blockWindow({ startDate: phase!.startDate, weeks: blockData.weeks.length }, now);
    const asked = Number(query.week);
    const initialWeek = Number.isInteger(asked) && asked >= 1 ? asked : window.status === "active" ? window.week : 1;
    body = (
      <ReviewView
        block={blockData}
        athlete={athlete}
        initialWeek={initialWeek}
        today={today}
        videos={{}}
        checkins={checkins}
        messages={[]}
        moves={moved}
        previous={previousLogs(blockData, exerciseHistory(phases, athlete, moveMap), moveMap)}
        show={null}
        hasLink
        readOnly
      />
    );
  }

  return (
    <SettingsProvider settings={forAthlete(settings)}>
      <main style={{ maxWidth: SHELL_MAX_WIDTH }} className="mx-auto w-full px-4 py-7 sm:px-6">
        <h1 className="text-[22px] font-semibold tracking-tight">{athlete.name}</h1>
        <div className="mt-1 text-[12px] text-muted">{t("Read-only Tracking, shared by their coach.")}</div>

        {programs.some((p) => p.phases.length > 0) && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {programs.flatMap((p) =>
              p.phases.map((ph) => {
                const on = ph.id === phase?.id;
                return (
                  <Link
                    key={ph.id}
                    href={href({ block: ph.id })}
                    scroll={false}
                    className={`rounded-full border px-3 py-1 text-[12px] ${on ? "border-accent text-accent" : "border-border text-muted hover:text-foreground"}`}
                  >
                    {programs.length > 1 ? `${p.name} · ${ph.phase}` : ph.phase}
                  </Link>
                );
              }),
            )}
          </div>
        )}

        <nav role="tablist" aria-label={t("Tracking view")} className="mt-5 flex gap-1 border-b border-border">
          {VIEWS.map((v) => (
            <Link
              key={v.id}
              role="tab"
              aria-selected={v.id === view}
              href={href({ view: v.id })}
              scroll={false}
              className={`-mb-px border-b-2 px-3 pb-2 pt-1 text-[13px] ${
                v.id === view ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {t(v.label)}
            </Link>
          ))}
          {program && <span className="ml-auto self-center pb-1 text-[11px] text-muted-2">{program.name}</span>}
        </nav>

        {body}
      </main>
    </SettingsProvider>
  );
}
