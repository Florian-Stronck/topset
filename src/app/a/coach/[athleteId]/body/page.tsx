import { athletePage } from "@/app/a/coach/[athleteId]/athlete";
import { deleteCoachInjury, saveCoachInjury } from "@/app/a/coach/actions";
import { PhoneActions } from "@/app/a/coach/PhoneActions";
import { Locked, PhaseChips, Segmented } from "@/app/a/coach/parts";
import { InjuryPanel } from "@/components/InjuryPanel";
import { ProgressView } from "@/components/tracking/ProgressView";
import { WellnessView } from "@/components/tracking/WellnessView";
import { weightToMake } from "@/lib/bodyweight";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { exerciseHistory } from "@/lib/exercise-history";
import { t } from "@/lib/i18n";
import { startOfDay } from "@/lib/overview";
import { liftProgress } from "@/lib/progress";
import { getAllPhasesForAthlete, getBodyweights, getCheckins, getMoveMap, getNextMeets, getNutrition, getTargetSpans, getWorkspace, injuriesFor, toBlockData } from "@/lib/queries";
import { addDays } from "@/lib/schedule";
import { sessionDrift } from "@/lib/tracking";

export const dynamic = "force-dynamic";

/** The longest stretch the Wellness charts look back over. */
const WELLNESS_DAYS = 56;

/** Body: strength over time (the desktop's Progress) and how the athlete is doing (Wellness). */
export default async function BodyPage({
  params,
  searchParams,
}: {
  params: Promise<{ athleteId: string }>;
  searchParams: Promise<{ view?: string; block?: string }>;
}) {
  const page = await athletePage((await params).athleteId);
  if (!page) return null;
  const { athlete, unit } = page;
  const query = await searchParams;
  const wellness = query.view === "wellness";
  const base = `/a/coach/${athlete.id}/body`;
  const today = ymdOf(calendarToday());
  const [phases, moveMap] = await Promise.all([getAllPhasesForAthlete(athlete.id), getMoveMap([athlete.id])]);

  let body: React.ReactNode;
  let chips: React.ReactNode = null;
  if (wellness) {
    const [weights, nutrition, targets, meets, injuries, checkinMap] = await Promise.all([
      getBodyweights([athlete.id]),
      getNutrition([athlete.id], addDays(today, -(WELLNESS_DAYS - 1))),
      getTargetSpans(athlete.id),
      getNextMeets([athlete.id], startOfDay(new Date())),
      injuriesFor(athlete.id),
      getCheckins([athlete.id]),
    ]);
    const meet = meets.get(athlete.id);
    body = (
      <Locked role={athlete.share.role} need="edit">
        <InjuryPanel initial={injuries} today={today} save={saveCoachInjury.bind(null, athlete.id)} remove={deleteCoachInjury} phone />
        <WellnessView
          athleteId={athlete.id}
          unit={unit}
          today={today}
          checkins={checkinMap.get(athlete.id) ?? { questions: [], answers: [], photos: [] }}
          drift={sessionDrift(phases, addDays(today, -(WELLNESS_DAYS - 1)), today, moveMap)}
          bodyweight={weights.get(athlete.id) ?? []}
          nutrition={nutrition.get(athlete.id) ?? []}
          targets={targets}
          meet={meet ? { name: meet.name, weightClass: meet.weightClass, ...weightToMake(meet) } : null}
        />
      </Locked>
    );
  } else {
    const { programs, phase } = await getWorkspace(athlete.id, undefined, query.block);
    const blockData = phase && toBlockData(phase);
    chips = <PhaseChips programs={programs} current={phase?.id} href={(id) => `${base}?block=${id}`} />;
    body = blockData ? (
      <Locked role={athlete.share.role} need="edit">
        <ProgressView
          block={blockData}
          athlete={athlete}
          today={today}
          series={{ prescribed: liftProgress(phases, athlete, "prescribed"), estimated: liftProgress(phases, athlete, "estimated") }}
          history={exerciseHistory(phases, athlete, moveMap)}
          moves={Object.fromEntries(moveMap)}
        />
      </Locked>
    ) : (
      <p className="mt-16 text-center text-[14px] text-muted">{t("Nothing to track for {name} yet.", { name: athlete.name })}</p>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <Segmented
        label={t("Body view")}
        options={[
          { href: base, label: t("Strength"), on: !wellness },
          { href: `${base}?view=wellness`, label: t("Wellness"), on: wellness },
        ]}
      />
      {chips}
      <PhoneActions clips={{}}>{body}</PhoneActions>
    </div>
  );
}
