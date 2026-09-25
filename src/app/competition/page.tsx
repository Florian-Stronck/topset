import { redirect } from "next/navigation";
import { MeetPlanner } from "@/components/MeetPlanner";
import { Sidebar } from "@/components/Sidebar";
import type { MeetData } from "@/lib/competition";
import { getMeetsForAthlete, getCoach } from "@/lib/queries";
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
  const meets = await getMeetsForAthlete(athlete.id);

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
      />
    </div>
  );
}
