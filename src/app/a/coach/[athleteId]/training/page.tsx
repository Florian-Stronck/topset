import { athletePage } from "@/app/a/coach/[athleteId]/athlete";
import { PhoneActions } from "@/app/a/coach/PhoneActions";
import { PhonePlan } from "@/app/a/coach/PhonePlan";
import { PhoneReview } from "@/app/a/coach/PhoneReview";
import { Locked, PhaseChips, Segmented } from "@/app/a/coach/parts";
import { clipsFor } from "@/lib/athlete-queries";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { exerciseHistory } from "@/lib/exercise-history";
import { t } from "@/lib/i18n";
import { blockWindow } from "@/lib/overview";
import { getAllPhasesForAthlete, getCheckins, getMessages, getMoveMap, getWorkspace, toBlockData } from "@/lib/queries";
import { sessionsOf } from "@/lib/schedule";
import { previousLogs } from "@/lib/tracking";

export const dynamic = "force-dynamic";

/** Training: what the athlete did (Review) and what's planned (Plan), one phase at a time. */
export default async function TrainingPage({
  params,
  searchParams,
}: {
  params: Promise<{ athleteId: string }>;
  searchParams: Promise<{ view?: string; block?: string; week?: string }>;
}) {
  const page = await athletePage((await params).athleteId);
  if (!page) return null;
  const { athlete } = page;
  const query = await searchParams;
  const plan = query.view === "plan";

  const now = new Date();
  const today = ymdOf(calendarToday());
  const [{ programs, phase }, phases, checkinMap, moveMap] = await Promise.all([
    getWorkspace(athlete.id, undefined, query.block),
    getAllPhasesForAthlete(athlete.id),
    getCheckins([athlete.id]),
    getMoveMap([athlete.id]),
  ]);
  const blockData = phase && toBlockData(phase);
  const base = `/a/coach/${athlete.id}/training`;
  const href = (next: { view?: string; block?: string }) => {
    const p = new URLSearchParams();
    if ((next.view ?? (plan ? "plan" : "review")) === "plan") p.set("view", "plan");
    const block = next.block ?? query.block;
    if (block) p.set("block", block);
    return `${base}${p.size ? `?${p}` : ""}`;
  };
  const asked = Number(query.week);
  const window = phase ? blockWindow({ startDate: phase.startDate, weeks: phase.weeks.length }, now) : null;
  const initialWeek = Number.isInteger(asked) && asked >= 1 ? asked : window?.status === "active" ? window.week : 1;

  let body: React.ReactNode;
  let clips = {};
  if (!blockData) {
    body = <p className="mt-16 text-center text-[14px] text-muted">{t("No program for {name} yet. Write one in the desktop app.", { name: athlete.name })}</p>;
  } else if (plan) {
    body = (
      <Locked role={athlete.share.role} need="edit">
        <PhonePlan key={blockData.id} athleteId={athlete.id} block={blockData} unit={athlete.unit} initialWeek={initialWeek} />
      </Locked>
    );
  } else {
    const moved = Object.fromEntries(moveMap);
    const checkins = checkinMap.get(athlete.id) ?? { questions: [], answers: [], photos: [] };
    const rowIds = blockData.weeks.flatMap((w) => w.days.flatMap((d) => d.rows.map((r) => r.id)));
    const [messages, rowClips] = await Promise.all([getMessages(athlete.id), clipsFor(athlete.id, rowIds)]);
    clips = rowClips;
    // As on the desktop: sessions another program's dates took, with nothing logged, read as rest days.
    const scheduled = new Set(sessionsOf(phases, moveMap, athlete.activeProgramId).map((s) => s.day.id));
    const paused = new Set(
      blockData.weeks
        .flatMap((w) => w.days)
        .filter((d) => !d.rest && !scheduled.has(d.id) && !d.rows.some((r) => r.actualWeight !== null || (r.logs?.length ?? 0) > 0))
        .map((d) => d.id),
    );
    const trained = { ...blockData, weeks: blockData.weeks.map((w) => ({ ...w, days: w.days.map((d) => (paused.has(d.id) ? { ...d, rest: true } : d)) })) };
    body = (
      <Locked role={athlete.share.role} need="review">
        <PhoneReview
          key={blockData.id}
          block={trained}
          athlete={athlete}
          initialWeek={initialWeek}
          today={today}
          checkins={checkins}
          messages={messages}
          moves={moved}
          previous={previousLogs(blockData, exerciseHistory(phases, athlete, moveMap), moveMap)}
        />
      </Locked>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <Segmented
        label={t("Training view")}
        options={[
          { href: href({ view: "review" }), label: t("Review"), on: !plan },
          { href: href({ view: "plan" }), label: t("Plan"), on: plan },
        ]}
      />
      <PhaseChips programs={programs} current={phase?.id} href={(id) => href({ block: id })} />
      <PhoneActions clips={clips}>{body}</PhoneActions>
    </div>
  );
}
