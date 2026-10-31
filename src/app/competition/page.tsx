import { redirect } from "next/navigation";
import { canEdit } from "@/lib/share";
import { MeetPlanner } from "@/components/MeetPlanner";
import { Sidebar } from "@/components/Sidebar";
import { plannerData } from "@/app/competition/data";
import { COMPETITION_TABS, type CompetitionTab } from "@/lib/competition";
import { getCoach } from "@/lib/queries";
import { loadSettings } from "@/lib/coach-settings";

export const dynamic = "force-dynamic";

/** One athlete's meets, in tabs: the attempts, the road to the meet, and every meet so far. */
export default async function CompetitionPage({
  searchParams,
}: {
  searchParams: Promise<{ athlete?: string; meet?: string; tab?: string }>;
}) {
  await loadSettings();
  const params = await searchParams;
  const coach = await getCoach();
  if (coach.athletes.length === 0) redirect("/athletes");

  const athlete = coach.athletes.find((a) => a.id === params.athlete) ?? coach.athletes[0];
  const tab: CompetitionTab = COMPETITION_TABS.includes(params.tab as CompetitionTab) ? (params.tab as CompetitionTab) : "attempts";
  const planner = await plannerData(athlete, params.meet, tab);

  return (
    <div className="flex h-screen">
      <Sidebar
        athletes={coach.athletes}
        activeAthleteId={athlete.id}
        coachUsername={coach.username} coachName={coach.name}
        section="competition"
      />
      <MeetPlanner athlete={athlete} {...planner} readOnly={!canEdit(athlete.share)} />
    </div>
  );
}
