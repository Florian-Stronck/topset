import { prisma } from "@/lib/prisma";
import { openersSet } from "@/lib/competition";

export type CompetitionRow = {
  id: string;
  name: string;
  venue: string | null;
  federation: string | null;
  /** ISO. */
  date: string;
  athletes: { id: string; name: string }[];
  /** Entries whose three openers are all set. */
  ready: number;
  entered: number;
};

/** The coach's competitions, soonest first, with who is entered and how many have their openers in. */
export async function listCompetitions(coachId: string, athletes: { id: string; name: string }[]): Promise<CompetitionRow[]> {
  const rows = await prisma.competition.findMany({
    where: { coachId },
    orderBy: { date: "asc" },
    include: {
      meets: { select: { athleteId: true, attempts: { where: { number: 1 }, select: { lift: true, number: true, weight: true } } } },
    },
  });
  const byId = new Map(athletes.map((a) => [a.id, a]));
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    venue: c.venue,
    federation: c.federation,
    date: c.date.toISOString(),
    // An entry whose athlete isn't on this roster (not shared with this coach) still counts, without a face.
    athletes: c.meets.flatMap((m) => byId.get(m.athleteId) ?? []),
    ready: c.meets.filter((m) => openersSet(m.attempts) === 3).length,
    entered: c.meets.length,
  }));
}
