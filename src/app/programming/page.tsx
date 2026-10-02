import { redirect } from "next/navigation";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { isActive, sortInjuries } from "@/lib/injuries";
import { HistoryProvider } from "@/components/history";
import { ProgrammingWorkspace } from "@/components/ProgrammingWorkspace";
import { Sidebar } from "@/components/Sidebar";
import { NewProgramButton } from "@/components/Topbar";
import type { MeetSummary } from "@/lib/competition";
import {
  getCoach,
  getExerciseHistory,
  getMeetsForAthlete,
  injuriesFor,
  getProgramBlocks,
  getWorkspace,
} from "@/lib/queries";
import type { BlockData } from "@/lib/types";
import { toBlockData } from "@/lib/queries";
import { loadSettings } from "@/lib/coach-settings";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ProgrammingPage({
  searchParams,
}: {
  searchParams: Promise<{ athlete?: string; program?: string; phase?: string; week?: string }>;
}) {
  await loadSettings();
  const params = await searchParams;
  const coach = await getCoach();
  if (coach.athletes.length === 0) redirect("/athletes");

  const athlete = coach.athletes.find((a) => a.id === params.athlete) ?? coach.athletes[0];

  const { programs, program, phase } = await getWorkspace(athlete.id, params.program, params.phase);

  const [exerciseHistory, meets, programBlocks, injuries] = await Promise.all([
    getExerciseHistory(coach.id),
    getMeetsForAthlete(athlete.id),
    program ? getProgramBlocks(program.id) : Promise.resolve([]),
    injuriesFor(athlete.id),
  ]);
  const today = ymdOf(calendarToday());

  const meetData: MeetSummary[] = meets.map((meet) => ({
    id: meet.id,
    name: meet.name,
    date: meet.date.toISOString().slice(0, 10),
    attempts: meet.attempts.map((a) => ({ lift: a.lift, number: a.number, weight: a.weight })),
  }));

  const phaseData: BlockData | null = phase && toBlockData(phase);
  const wholeProgram: BlockData[] = programBlocks.map(toBlockData);
  const roster = coach.athletes.map((a) => ({ id: a.id, name: a.name }));

  return (
    <div className="flex h-screen">
      <Sidebar
        athletes={coach.athletes}
        activeAthleteId={athlete.id}
        coachUsername={coach.username} coachName={coach.name}
        section="programming"
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {phaseData && program ? (
          <HistoryProvider resetKey={phaseData.program.id}>
            <ProgrammingWorkspace
              phase={phaseData}
              initialWeek={Math.max(1, Math.trunc(Number(params.week)) || 1)}
              program={program}
              programs={programs}
              wholeProgram={wholeProgram}
              athlete={athlete}
              roster={roster}
              exerciseHistory={exerciseHistory}
              meets={meetData}
              injuries={sortInjuries(injuries.filter((i) => isActive(i, today)), today)}
            />
          </HistoryProvider>
        ) : (
          <EmptyState athleteId={athlete.id} athleteName={athlete.name} />
        )}
      </main>
    </div>
  );
}

function EmptyState({ athleteId, athleteName }: { athleteId: string; athleteName: string }) {
  return (
    <div className="grid flex-1 place-items-center">
      <div className="text-center">
        <div className="text-[14px] text-foreground">No programs yet for {athleteName}.</div>
        <div className="mt-1 text-[12px] text-muted">
          {t("Create one to start programming for them.")}
        </div>
        <div className="mt-4 flex justify-center gap-2">
          <NewProgramButton athleteId={athleteId} />
        </div>
      </div>
    </div>
  );
}
