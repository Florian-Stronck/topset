import { redirect } from "next/navigation";
import { canEdit } from "@/lib/share";
import { MeetPlanner } from "@/components/MeetPlanner";
import { Sidebar } from "@/components/Sidebar";
import type { MeetData } from "@/lib/competition";
import { getBodyweights, getMeetsForAthlete, getCoach } from "@/lib/queries";
import { weightToMake } from "@/lib/bodyweight";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { loadSettings } from "@/lib/coach-settings";

export const dynamic = "force-dynamic";

export default async function CompetitionPage({
  searchParams,
}: {
  searchParams: Promise<{ athlete?: string; meet?: string }>;
}) {
  await loadSettings();
  const params = await searchParams;
  const coach = await getCoach();
  if (coach.athletes.length === 0) redirect("/athletes");

  const athlete = coach.athletes.find((a) => a.id === params.athlete) ?? coach.athletes[0];
  const [meets, weights] = await Promise.all([
    getMeetsForAthlete(athlete.id),
    getBodyweights([athlete.id]),
  ]);

  const data: MeetData[] = meets.map((meet) => ({
    id: meet.id,
    name: meet.name,
    federation: meet.federation,
    weightClass: meet.weightClass,
    bodyweight: meet.bodyweight,
    date: meet.date.toISOString(),
    attempts: meet.attempts.map((a) => ({
      id: a.id,
      lift: a.lift,
      number: a.number,
      weight: a.weight,
      result: a.result,
    })),
  }));

  return (
    <div className="flex h-screen">
      <Sidebar
        athletes={coach.athletes}
        activeAthleteId={athlete.id}
        coachUsername={coach.username} coachName={coach.name}
        section="competition"
      />
      <MeetPlanner
        athlete={athlete}
        meets={data}
        activeMeetId={params.meet ?? null}
        today={new Date().toISOString()}
        calendarDay={ymdOf(calendarToday())}
        bodyweights={weights.get(athlete.id) ?? []}
        limits={Object.fromEntries(meets.map((m) => [m.id, weightToMake(m)]))}
        readOnly={!canEdit(athlete.share)}
      />
    </div>
  );
}
