import { Roster, type RosterEntry } from "@/components/Roster";
import { Sidebar } from "@/components/Sidebar";
import { getRoster } from "@/lib/queries";
import { questionData } from "@/lib/checkins";
import { loadSettings } from "@/lib/coach-settings";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** `?new=1` opens the add-athlete form straight away — the palette's "New athlete…". */
export default async function AthletesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; link?: string; n?: string }>;
}) {
  await loadSettings();
  const params = await searchParams;
  const { coach, athletes } = await getRoster();
  // The teams this coach is on, as sync last brought them: none until a gym sets them up.
  const teams = await prisma.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  const entries: RosterEntry[] = athletes.map((a) => ({
    id: a.id,
    name: a.name,
    unit: a.unit,
    squat1RM: a.squat1RM,
    bench1RM: a.bench1RM,
    dead1RM: a.dead1RM,
    hasLink: a.accessToken !== null,
    hasViewLink: a.viewToken !== null,
    teamId: a.teamId,
    team: a.team?.name ?? null,
    theirs: a.coachId !== coach.id,
    questions: a.questions.map(questionData),
    programs: a.programs.map((p) => ({
      id: p.id,
      name: p.name,
      firstPhaseId: p.phases[0]?.id ?? null,
      phases: p.phases.length,
      weeks: p.phases.reduce((n, phase) => n + phase._count.weeks, 0),
    })),
  }));

  return (
    <div className="flex h-screen">
      <Sidebar athletes={athletes} coachUsername={coach.username} coachName={coach.name} section="athletes" />
      <main className="min-w-0 flex-1 overflow-auto">
        <Roster athletes={entries} teams={teams} openNew={params.new === "1"} openLink={params.link} nonce={params.n} />
      </main>
    </div>
  );
}
