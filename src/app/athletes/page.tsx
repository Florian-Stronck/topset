import { Roster, type RosterEntry } from "@/components/Roster";
import { Sidebar } from "@/components/Sidebar";
import { getActiveInjuries, getNextMeets, getRoster } from "@/lib/queries";
import { formatDate, today as calendarToday, ymdOf } from "@/lib/dates";
import { addDays, daysBetween } from "@/lib/schedule";
import { injuryLabel } from "@/lib/injuries";
import { questionData } from "@/lib/checkins";
import { loadSettings } from "@/lib/coach-settings";
import { prisma } from "@/lib/prisma";
import { checkinStatus } from "@/lib/overview";
import { syncEnabled } from "@/lib/sync";

export const dynamic = "force-dynamic";

/** `?new=1` opens the add-athlete form straight away — the palette's "New athlete…". */
export default async function AthletesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; link?: string; n?: string; athlete?: string }>;
}) {
  await loadSettings();
  const params = await searchParams;
  const { coach, athletes, lastCheckin } = await getRoster();
  // Links only reach a phone once sync is set up; the Overview asks the same.
  const linksOn = syncEnabled();
  // The teams this coach is on, as sync last brought them: none until a gym sets them up.
  const teams = await prisma.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const today = ymdOf(calendarToday());
  const ids = athletes.map((a) => a.id);
  const [meets, injuries] = await Promise.all([getNextMeets(ids, new Date(`${today}T00:00:00`)), getActiveInjuries(ids, today)]);

  const entries: RosterEntry[] = athletes.map((a) => ({
    id: a.id,
    name: a.name,
    unit: a.unit,
    squat1RM: a.squat1RM,
    bench1RM: a.bench1RM,
    dead1RM: a.dead1RM,
    variationPct: a.variationPct,
    variationPcts: a.variationPcts,
    hasLink: a.accessToken !== null,
    hasViewLink: a.viewToken !== null,
    checkin: checkinStatus(lastCheckin.get(a.id) ?? null, { hasLink: a.accessToken !== null, linksOn }),
    teamId: a.teamId,
    team: a.team?.name ?? null,
    theirs: a.coachId !== coach.id,
    questions: a.questions.map(questionData),
    notes: a.notes,
    nextMeet: (() => {
      const m = meets.get(a.id);
      return m ? { name: m.name, date: formatDate(m.date), days: daysBetween(today, ymdOf(m.date)), weightClass: m.weightClass } : null;
    })(),
    injuries: (injuries.get(a.id) ?? []).map((i) => ({ label: injuryLabel(i), severity: i.severity, since: formatDate(i.day) })),
    programs: a.programs.map((p) => {
      const first = p.phases[0];
      const last = p.phases[p.phases.length - 1];
      const start = first ? ymdOf(first.startDate) : null;
      // The day after the last phase's last week.
      const end = last ? addDays(ymdOf(last.startDate), last._count.weeks * 7) : null;
      return {
        id: p.id,
        name: p.name,
        firstPhaseId: first?.id ?? null,
        phases: p.phases.length,
        weeks: p.phases.reduce((n, phase) => n + phase._count.weeks, 0),
        dates: start && end ? `${formatDate(start)} – ${formatDate(addDays(end, -1))}` : null,
        status: !start || !end ? null : today < start ? "upcoming" : today < end ? "active" : "done",
      } as const;
    }),
  }));

  return (
    <div className="flex h-screen">
      <Sidebar athletes={athletes} coachUsername={coach.username} coachName={coach.name} section="athletes" activeAthleteId={params.athlete ?? params.link ?? athletes[0]?.id} />
      <main className="min-w-0 flex-1 overflow-auto">
        <Roster athletes={entries} teams={teams} picked={params.athlete ?? params.link} openNew={params.new === "1"} openLink={params.link} nonce={params.n} />
      </main>
    </div>
  );
}
