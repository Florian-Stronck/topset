import { redirect } from "next/navigation";
import { canEdit } from "@/lib/share";
import { MeetPlanner } from "@/components/MeetPlanner";
import { Sidebar } from "@/components/Sidebar";
import { plannerData } from "@/app/competition/data";
import { COMPETITION_TABS, type CompetitionTab } from "@/lib/competition";
import { CompetitionList } from "@/components/competition/CompetitionList";
import { CompetitionDetail } from "@/components/competition/CompetitionDetail";
import { competitionDetail } from "@/app/competition/detail-data";
import { listCompetitions } from "@/app/competition/list-data";
import { getCoach } from "@/lib/queries";
import { loadSettings } from "@/lib/coach-settings";

export const dynamic = "force-dynamic";

/** One athlete's meets, in tabs: the attempts, the road to the meet, and every meet so far. */
export default async function CompetitionPage({
  searchParams,
}: {
  searchParams: Promise<{ athlete?: string; meet?: string; tab?: string; comp?: string; view?: string }>;
}) {
  await loadSettings();
  const params = await searchParams;
  const coach = await getCoach();
  if (coach.athletes.length === 0) redirect("/athletes");

  if (!params.athlete && !params.meet) {
    const shell = (children: React.ReactNode) => (
      <div className="flex h-screen">
        <Sidebar
          athletes={coach.athletes}
          activeAthleteId={undefined}
          coachUsername={coach.username} coachName={coach.name}
          section="competition"
        />
        {children}
      </div>
    );
    if (params.comp) {
      const detail = await competitionDetail(params.comp, coach);
      if (!detail) redirect("/competition");
      return shell(<CompetitionDetail {...detail} />);
    }
    const rows = await listCompetitions(coach.id, coach.athletes);
    return shell(<CompetitionList rows={rows} view={params.view} today={new Date().toISOString()} />);
  }

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
